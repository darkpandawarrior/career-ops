// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { recentLogs } from "./logbuf";

// logbuf is a tiny client-side ring buffer of recent ERRORS for the in-app bug
// reporter. On import (under jsdom: window present, not yet installed) it wraps
// console.error and registers window 'error' / 'unhandledrejection' listeners.
// The push() that fills the buffer is NOT exported — the only way to drive it is
// through those installed sinks. The buffer (BUF) and the install flag are
// module-level singletons, so state accumulates across tests in this file; the
// tests below are written to be robust to that (unique markers + full-cycle
// overflow), never assuming an empty buffer.

const MAX = 20; // mirrors the private MAX in logbuf.ts

// Silence the real console output the wrapper still forwards to (orig(...args)),
// so test logs stay clean. We spy AFTER import so the wrapper has already captured
// the original bound console.error.
let errSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterAll(() => {
  errSpy?.mockRestore();
});

describe("install side-effects (on import under jsdom)", () => {
  it("marks the window as installed so a second import is a no-op", () => {
    expect(window.__coLogBufInstalled).toBe(true);
  });

  it("recentLogs returns an array", () => {
    expect(Array.isArray(recentLogs())).toBe(true);
  });

  it("recentLogs returns a COPY, not the live buffer (mutating it is harmless)", () => {
    const a = recentLogs();
    const b = recentLogs();
    expect(a).not.toBe(b); // different array instances
    const before = recentLogs().length;
    a.push("tampering");
    expect(recentLogs().length).toBe(before); // internal buffer untouched
  });
});

describe("console.error capture + formatting", () => {
  it("records a console.error call with the [error] prefix", () => {
    const marker = "MARK_BASIC_" + Math.random().toString(36).slice(2);
    console.error("boom", marker);
    const hit = recentLogs().find((l) => l.includes(marker));
    expect(hit).toBeDefined();
    expect(hit!.startsWith("[error] ")).toBe(true);
    expect(hit).toContain("boom");
  });

  it("uses Error.message (not the full stack) when an Error is logged", () => {
    const marker = "MARK_ERR_" + Math.random().toString(36).slice(2);
    const err = new Error("kaboom " + marker);
    console.error(err);
    const hit = recentLogs().find((l) => l.includes(marker));
    expect(hit).toBeDefined();
    expect(hit).toContain("kaboom");
    // The stack (which would contain "at " frames / file paths) is NOT included;
    // only the message is mapped for Error args.
    expect(hit).not.toMatch(/\bat\s+\w/);
  });

  it("joins multiple args with single spaces and stringifies non-strings", () => {
    const marker = "MARK_MULTI_" + Math.random().toString(36).slice(2);
    console.error(marker, 42, { a: 1 }, null, undefined);
    const hit = recentLogs().find((l) => l.includes(marker));
    expect(hit).toBeDefined();
    expect(hit).toContain("42");
    expect(hit).toContain("[object Object]"); // String({a:1})
    expect(hit).toContain("null");
    expect(hit).toContain("undefined");
  });

  it("collapses ALL runs of whitespace (newlines/tabs/multi-space) to one space", () => {
    const marker = "MARK_WS_" + Math.random().toString(36).slice(2);
    console.error(marker + "\n\nline2\t\ttabbed   spaced");
    const hit = recentLogs().find((l) => l.includes(marker));
    expect(hit).toBeDefined();
    expect(hit).not.toMatch(/[\n\t]/); // no raw newlines or tabs survive
    expect(hit).not.toMatch(/ {2,}/); // no double spaces survive
    expect(hit).toContain("line2 tabbed spaced");
  });

  it("truncates each entry to 300 chars (after whitespace normalization)", () => {
    const marker = "MARK_LONG_" + Math.random().toString(36).slice(2);
    // 1000 non-space chars so whitespace collapse doesn't shorten it.
    console.error(marker + "x".repeat(1000));
    const hit = recentLogs().find((l) => l.includes(marker));
    expect(hit).toBeDefined();
    expect(hit!.length).toBe(300);
  });

  it("never throws even if an arg's String() coercion blows up", () => {
    const marker = "MARK_THROW_" + Math.random().toString(36).slice(2);
    const hostile = {
      toString() {
        throw new Error("cannot stringify");
      },
    };
    // The push() body is wrapped in try/catch, so a throwing arg must not bubble.
    expect(() => console.error(marker, hostile)).not.toThrow();
    // Because mapping threw, this particular entry is dropped (not partially added).
    expect(recentLogs().some((l) => l.includes(marker))).toBe(false);
  });

  it("records the entry AND completes without throwing (wrapper also forwards to orig)", () => {
    // The wrapper pushes then calls orig(...args). We can't reliably intercept the
    // bound original captured at import, so we assert the observable contract: the
    // call returns normally (output is forwarded, not swallowed/erroring) and the
    // entry lands in the buffer.
    const marker = "MARK_FWD_" + Math.random().toString(36).slice(2);
    expect(() => console.error("forwarded-line", marker)).not.toThrow();
    expect(recentLogs().some((l) => l.includes(marker))).toBe(true);
  });
});

describe("window error event capture", () => {
  it("captures a window 'error' event with the [onerror] prefix and metadata", () => {
    const marker = "MARK_ONERR_" + Math.random().toString(36).slice(2);
    const evt = new ErrorEvent("error", {
      message: marker + " went wrong",
      filename: "app.js",
      lineno: 123,
    });
    window.dispatchEvent(evt);
    const hit = recentLogs().find((l) => l.includes(marker));
    expect(hit).toBeDefined();
    expect(hit!.startsWith("[onerror] ")).toBe(true);
    expect(hit).toContain("app.js");
    expect(hit).toContain("123");
  });

  it("captures an 'unhandledrejection' with the [rejection] prefix", () => {
    const marker = "MARK_REJECT_" + Math.random().toString(36).slice(2);
    // jsdom doesn't always construct PromiseRejectionEvent; synthesize a plain
    // event with the fields the handler reads (reason).
    const evt = new Event("unhandledrejection") as Event & { reason?: unknown };
    evt.reason = "rejected: " + marker;
    window.dispatchEvent(evt);
    const hit = recentLogs().find((l) => l.includes(marker));
    expect(hit).toBeDefined();
    expect(hit!.startsWith("[rejection] ")).toBe(true);
  });
});

describe("ring buffer cap + order + overflow", () => {
  it("caps at MAX (20) entries and keeps only the most recent in order", () => {
    // Push a fully unique, fully filling batch. After this, the entire buffer is
    // determined by these pushes regardless of prior accumulated state.
    const run = "RING_" + Math.random().toString(36).slice(2) + "_";
    const total = MAX + 12; // overflow well past the cap
    for (let i = 0; i < total; i++) {
      console.error(run + String(i).padStart(3, "0"));
    }

    const logs = recentLogs();
    // Cap holds: never more than MAX entries total.
    expect(logs.length).toBe(MAX);

    // FIFO eviction: the oldest (run_000 .. run_011) are gone; the last MAX
    // survive, in insertion order.
    const expected = Array.from(
      { length: MAX },
      (_, k) => `[error] ${run}${String(total - MAX + k).padStart(3, "0")}`,
    );
    expect(logs).toEqual(expected);

    // Sanity: the very first pushed entry was evicted, the very last is present.
    expect(logs.some((l) => l.endsWith(run + "000"))).toBe(false);
    expect(logs.some((l) => l.endsWith(run + String(total - 1).padStart(3, "0")))).toBe(true);
  });

  it("evicts strictly from the front (shift), one per overflow push", () => {
    // Fill to exactly MAX with a known run, then push one more and confirm the
    // window slid by exactly one.
    const run = "SLIDE_" + Math.random().toString(36).slice(2) + "_";
    for (let i = 0; i < MAX; i++) console.error(run + String(i).padStart(3, "0"));
    const filled = recentLogs();
    expect(filled.length).toBe(MAX);
    const firstBefore = filled[0];

    console.error(run + "NEXT");
    const after = recentLogs();
    expect(after.length).toBe(MAX); // still capped
    expect(after[0]).not.toBe(firstBefore); // the old head was shifted out
    expect(after[after.length - 1]).toBe(`[error] ${run}NEXT`); // newest at tail
  });
});
