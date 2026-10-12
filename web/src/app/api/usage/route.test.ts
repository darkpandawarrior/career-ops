import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * usage/route.ts sums Claude Code per-message token usage from
 * ~/.claude/projects/ ** /*.jsonl into a rolling 5h / 7d window. The only
 * external surface is os.homedir() (the projects root) and Date.now() (the
 * window cutoffs). We mock os.homedir() to a throwaway HOME and drive
 * Date.now() with vitest fake timers so the windows are deterministic.
 *
 * The route caches the computed result for 60s in a module-level variable.
 * Because the module is imported once, that cache LIVES ACROSS TESTS. We
 * defeat it by advancing the fake clock > 60s between every test (and the
 * mtime cutoff is relative to that same clock, so the fixtures stay in range).
 */

// A throwaway HOME whose .claude/projects we fill with .jsonl fixtures.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "co-usage-home-"));
const PROJECTS = path.join(HOME, ".claude", "projects");

// Mock os.homedir() to our tmp HOME; keep the rest of node:os real (the route
// and this test both use os.tmpdir()/Buffer etc.).
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, homedir: () => HOME }, homedir: () => HOME };
});

import { GET } from "./route";

// Anchor "now" to a fixed wall-clock instant so window math is reproducible.
// Each test bumps the clock forward to dodge the 60s cache.
const BASE = Date.UTC(2026, 5, 30, 12, 0, 0); // 2026-06-30T12:00:00Z
let clock = BASE;

function iso(msAgo: number): string {
  return new Date(clock - msAgo).toISOString();
}

// Write one project's transcript file with the given JSONL lines, then bump its
// mtime to "clock" so it passes the route's `mtimeMs >= w7 - 1h` cutoff.
function writeTranscript(project: string, file: string, lines: string[]) {
  const dir = path.join(PROJECTS, project);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, file);
  fs.writeFileSync(p, lines.join("\n"), "utf8");
  const t = new Date(clock);
  fs.utimesSync(p, t, t);
}

// A usage record line at `msAgo` before the current clock.
function usageLine(msAgo: number, u: Record<string, number>): string {
  return JSON.stringify({ timestamp: iso(msAgo), message: { usage: u } });
}

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function resetProjects() {
  fs.rmSync(PROJECTS, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS, { recursive: true });
}

beforeEach(() => {
  // Advance the clock well past the 60s cache TTL so each test computes fresh.
  clock += 5 * 60 * 1000;
  vi.useFakeTimers();
  vi.setSystemTime(clock);
  resetProjects();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => fs.rmSync(HOME, { recursive: true, force: true }));

describe("GET /api/usage", () => {
  it("returns zeroed windows when there are no project files at all", async () => {
    fs.rmSync(PROJECTS, { recursive: true, force: true }); // dir missing entirely
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.window5h).toEqual({ tokens: 0, messages: 0 });
    expect(body.window7d).toEqual({ tokens: 0, messages: 0 });
    expect(body.computedAt).toBe(clock);
  });

  it("sums input + output + cache_creation tokens for a record inside both windows", async () => {
    writeTranscript("proj-a", "session.jsonl", [
      usageLine(HOUR, { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 25 }),
    ]);
    const res = await GET();
    const body = await res.json();
    // 1h ago is inside both the 5h and 7d windows.
    expect(body.window5h).toEqual({ tokens: 175, messages: 1 });
    expect(body.window7d).toEqual({ tokens: 175, messages: 1 });
  });

  it("counts cache_read tokens too (input+output+cache_creation+cache_read)", async () => {
    writeTranscript("proj-a", "s.jsonl", [
      usageLine(HOUR, { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 9999 }),
    ]);
    const body = await (await GET()).json();
    expect(body.window7d.tokens).toBe(10009);
  });

  it("treats missing token fields as 0", async () => {
    writeTranscript("proj-a", "s.jsonl", [usageLine(HOUR, { output_tokens: 7 })]);
    const body = await (await GET()).json();
    expect(body.window7d).toEqual({ tokens: 7, messages: 1 });
  });

  it("counts a 7d-but-not-5h record in window7d only", async () => {
    // 10h ago: outside the 5h window, inside the 7d window.
    writeTranscript("proj-a", "s.jsonl", [usageLine(10 * HOUR, { input_tokens: 40 })]);
    const body = await (await GET()).json();
    expect(body.window5h).toEqual({ tokens: 0, messages: 0 });
    expect(body.window7d).toEqual({ tokens: 40, messages: 1 });
  });

  it("excludes records older than 7d (ts < w7) even when the file mtime is fresh", async () => {
    // 8 days ago is before w7; the line is read (mtime fresh) but skipped by ts<w7.
    writeTranscript("proj-a", "s.jsonl", [usageLine(8 * DAY, { input_tokens: 1000 })]);
    const body = await (await GET()).json();
    expect(body.window7d).toEqual({ tokens: 0, messages: 0 });
  });

  it("aggregates multiple records across the windows", async () => {
    writeTranscript("proj-a", "s.jsonl", [
      usageLine(HOUR, { input_tokens: 10, output_tokens: 5 }), // both
      usageLine(2 * HOUR, { input_tokens: 20 }), // both
      usageLine(20 * HOUR, { input_tokens: 100 }), // 7d only
    ]);
    const body = await (await GET()).json();
    expect(body.window5h).toEqual({ tokens: 35, messages: 2 });
    expect(body.window7d).toEqual({ tokens: 135, messages: 3 });
  });

  it("walks nested project subdirectories recursively", async () => {
    const nested = path.join(PROJECTS, "outer", "inner");
    fs.mkdirSync(nested, { recursive: true });
    const p = path.join(nested, "deep.jsonl");
    fs.writeFileSync(p, usageLine(HOUR, { input_tokens: 42 }), "utf8");
    const t = new Date(clock);
    fs.utimesSync(p, t, t);
    const body = await (await GET()).json();
    expect(body.window7d).toEqual({ tokens: 42, messages: 1 });
  });

  it("only reads .jsonl files (ignores .json/.txt siblings)", async () => {
    const dir = path.join(PROJECTS, "proj-a");
    fs.mkdirSync(dir, { recursive: true });
    const t = new Date(clock);
    for (const name of ["a.json", "b.txt", "c.log"]) {
      const p = path.join(dir, name);
      fs.writeFileSync(p, usageLine(HOUR, { input_tokens: 500 }), "utf8");
      fs.utimesSync(p, t, t);
    }
    // A real .jsonl with a small amount, to prove only it is counted.
    writeTranscript("proj-a", "real.jsonl", [usageLine(HOUR, { input_tokens: 3 })]);
    const body = await (await GET()).json();
    expect(body.window7d).toEqual({ tokens: 3, messages: 1 });
  });

  it("skips lines that do not contain a \"usage\" substring without parsing them", async () => {
    writeTranscript("proj-a", "s.jsonl", [
      JSON.stringify({ timestamp: iso(HOUR), type: "summary" }), // no "usage"
      "this is not json at all",
      usageLine(HOUR, { input_tokens: 8 }),
    ]);
    const body = await (await GET()).json();
    expect(body.window7d).toEqual({ tokens: 8, messages: 1 });
  });

  it("skips a line that contains \"usage\" but is malformed JSON (parse throws → continue)", async () => {
    writeTranscript("proj-a", "s.jsonl", [
      '{ "usage": broken, not json',
      usageLine(HOUR, { input_tokens: 6 }),
    ]);
    const body = await (await GET()).json();
    // The broken line is skipped; only the valid record counts.
    expect(body.window7d).toEqual({ tokens: 6, messages: 1 });
  });

  it("skips a record with the \"usage\" substring but no message.usage object", async () => {
    writeTranscript("proj-a", "s.jsonl", [
      // contains the literal "usage" (in a string) but no message.usage
      JSON.stringify({ timestamp: iso(HOUR), note: "about usage limits" }),
      usageLine(HOUR, { input_tokens: 5 }),
    ]);
    const body = await (await GET()).json();
    expect(body.window7d).toEqual({ tokens: 5, messages: 1 });
  });

  it("skips a usage record with an unparseable timestamp (NaN ts → continue)", async () => {
    writeTranscript("proj-a", "s.jsonl", [
      JSON.stringify({ timestamp: "not-a-date", message: { usage: { input_tokens: 99 } } }),
      usageLine(HOUR, { input_tokens: 4 }),
    ]);
    const body = await (await GET()).json();
    expect(body.window7d).toEqual({ tokens: 4, messages: 1 });
  });

  it("skips a whole file whose mtime is older than the 7d-minus-1h cutoff", async () => {
    // The record's timestamp would be in-window, but the FILE mtime is stale, so
    // the route never opens it (`st.mtimeMs < cutoffMtime` → continue).
    const dir = path.join(PROJECTS, "stale");
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, "old.jsonl");
    fs.writeFileSync(p, usageLine(HOUR, { input_tokens: 777 }), "utf8");
    const old = new Date(clock - 9 * DAY); // well before cutoffMtime (w7 - 1h)
    fs.utimesSync(p, old, old);
    const body = await (await GET()).json();
    expect(body.window7d).toEqual({ tokens: 0, messages: 0 });
  });

  it("serves a cached result within the 60s TTL (does NOT see new files)", async () => {
    writeTranscript("proj-a", "s.jsonl", [usageLine(HOUR, { input_tokens: 11 })]);
    const first = await (await GET()).json();
    expect(first.window7d.tokens).toBe(11);

    // Add more usage but advance the clock only 30s (< 60s TTL) — the cached
    // value must be returned unchanged, including the original computedAt.
    writeTranscript("proj-a", "s2.jsonl", [usageLine(HOUR, { input_tokens: 999 })]);
    clock += 30_000;
    vi.setSystemTime(clock);
    const second = await (await GET()).json();
    expect(second.window7d.tokens).toBe(11);
    expect(second.computedAt).toBe(first.computedAt);
  });

  it("recomputes after the 60s cache TTL expires", async () => {
    writeTranscript("proj-a", "s.jsonl", [usageLine(HOUR, { input_tokens: 11 })]);
    const first = await (await GET()).json();
    expect(first.window7d.tokens).toBe(11);

    writeTranscript("proj-a", "s2.jsonl", [usageLine(HOUR, { input_tokens: 22 })]);
    clock += 61_000; // past TTL
    vi.setSystemTime(clock);
    const second = await (await GET()).json();
    expect(second.window7d.tokens).toBe(33);
    expect(second.computedAt).toBe(clock);
  });

  it("counts records right at the window boundary (ts === w5 / ts === w7 are inclusive)", async () => {
    // ts >= w5 and ts >= w7 use >=, so exactly-on-the-edge records count.
    writeTranscript("proj-a", "s.jsonl", [
      usageLine(5 * HOUR, { input_tokens: 1 }), // exactly 5h ago === w5 → in 5h
      usageLine(7 * DAY, { input_tokens: 2 }), // exactly 7d ago === w7 → in 7d
    ]);
    const body = await (await GET()).json();
    expect(body.window5h.messages).toBe(1);
    expect(body.window7d.messages).toBe(2);
    expect(body.window7d.tokens).toBe(3);
  });
});
