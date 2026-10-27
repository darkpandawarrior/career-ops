import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { DiscoveredOffer } from "./scan";

/**
 * `addOffersToPipeline(offers, root)` filters invalid offers, guards on the
 * presence of scan.mjs (data-only checkouts have no writer), then spawns a
 * short-lived node child that calls the core's canonical writers and reports
 * back `{ added }` on stdout. We exercise every branch with a FAKE child
 * process (spawn mocked), a controllable `fs.existsSync`, and a mocked
 * `@/lib/career-ops` so nothing touches the user's real engine/data.
 */

// A controllable fake ChildProcess. stdin captures what the SUT writes; stdout/
// stderr are EventEmitters; the child itself is an EventEmitter for
// "error"/"close".
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = {
    written: "",
    ended: false,
    write(s: string) {
      (this as { written: string }).written += s;
    },
    end() {
      (this as { ended: boolean }).ended = true;
    },
  };
}

// Shared mutable state in a hoisted holder so the (hoisted) vi.mock factories
// can reference it without a TDZ error.
const h = vi.hoisted(() => ({
  lastChild: null as InstanceType<typeof FakeChild> | null,
  lastSpawnArgs: null as { cmd: string; args: string[]; opts: Record<string, unknown> } | null,
  spawnMock: vi.fn(),
  existsSyncMock: vi.fn(),
}));

h.spawnMock.mockImplementation((cmd: string, args: string[], opts: Record<string, unknown>) => {
  h.lastChild = new FakeChild();
  h.lastSpawnArgs = { cmd, args, opts };
  return h.lastChild as unknown as ReturnType<typeof import("node:child_process").spawn>;
});

vi.mock("node:child_process", () => ({ spawn: h.spawnMock }));

// Only existsSync is consulted by the SUT; provide a controllable default.
vi.mock("node:fs", () => ({
  default: { existsSync: (p: string) => h.existsSyncMock(p) },
  existsSync: (p: string) => h.existsSyncMock(p),
}));

vi.mock("@/lib/career-ops", () => ({
  careerOpsRoot: () => "/fake/engine/root",
  rootScript: (name: string) => `/fake/engine/root/${name}.mjs`,
}));

import { addOffersToPipeline } from "./pipeline";

function offer(over: Partial<DiscoveredOffer> = {}): DiscoveredOffer {
  return {
    url: "https://boards.greenhouse.io/acme/jobs/1",
    company: "Acme",
    title: "Senior Android Engineer",
    location: "Pune",
    postedAt: "2026-06-01",
    ats: "greenhouse",
    source: "greenhouse-full",
    ...over,
  };
}

/**
 * Drives addOffersToPipeline against the fake child: starts the promise, lets
 * the synchronous body register handlers + write stdin, then feeds canned
 * stdout/stderr and emits "close" (or "error"). Resolves the AddResult.
 */
async function driveClose(
  offers: DiscoveredOffer[],
  stdout: string,
  stderr = "",
): Promise<{ result: Awaited<ReturnType<typeof addOffersToPipeline>>; child: InstanceType<typeof FakeChild> }> {
  const promise = addOffersToPipeline(offers, "/fake/data/root");
  const child = h.lastChild!;
  if (stdout) child.stdout.emit("data", Buffer.from(stdout));
  if (stderr) child.stderr.emit("data", Buffer.from(stderr));
  child.emit("close");
  const result = await promise;
  return { result, child };
}

beforeEach(() => {
  h.lastChild = null;
  h.lastSpawnArgs = null;
  h.spawnMock.mockClear();
  h.existsSyncMock.mockReset();
  // Default: scan.mjs exists so the writer path is reachable.
  h.existsSyncMock.mockReturnValue(true);
});

// ── input filtering / early-out (no spawn) ──────────────────────────────────
describe("addOffersToPipeline input filtering", () => {
  it("returns { added: 0 } and never spawns when given no offers", async () => {
    const result = await addOffersToPipeline([], "/fake/data/root");
    expect(result).toEqual({ added: 0 });
    expect(h.spawnMock).not.toHaveBeenCalled();
  });

  it("returns { added: 0 } when every offer is filtered out (no spawn)", async () => {
    const result = await addOffersToPipeline(
      [
        offer({ url: "not-a-url" }),
        offer({ url: "ftp://x.test/1" }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        null as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { company: "NoUrl" } as any,
      ],
      "/fake/data/root",
    );
    expect(result).toEqual({ added: 0 });
    expect(h.spawnMock).not.toHaveBeenCalled();
  });

  it("keeps only http(s) offers and forwards the cleaned set to the child's stdin", async () => {
    const promise = addOffersToPipeline(
      [
        offer({ url: "https://x.test/keep-1", company: "Keep1" }),
        offer({ url: "HTTP://x.test/keep-2", company: "Keep2" }), // scheme is case-insensitive
        offer({ url: "javascript:alert(1)", company: "Drop" }),
        offer({ url: "://broken", company: "Drop2" }),
      ],
      "/fake/data/root",
    );
    const child = h.lastChild!;
    child.stdout.emit("data", Buffer.from('{"added":2}'));
    child.emit("close");
    const result = await promise;

    expect(result).toEqual({ added: 2 });
    const sent = JSON.parse(child.stdin.written) as Array<{ url: string; company: string }>;
    expect(sent.map((o) => o.company)).toEqual(["Keep1", "Keep2"]);
    expect(child.stdin.ended).toBe(true);
  });

  it("normalizes optional string fields and derives source from ats when source is absent", async () => {
    const promise = addOffersToPipeline(
      [
        {
          url: "https://x.test/norm",
          // company/title/location omitted → coalesced to ""
          // source omitted but ats present → source falls back to ats
          ats: "lever",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
      "/fake/data/root",
    );
    const child = h.lastChild!;
    child.stdout.emit("data", Buffer.from('{"added":1}'));
    child.emit("close");
    await promise;

    const sent = JSON.parse(child.stdin.written) as Array<Record<string, string>>;
    expect(sent[0]).toEqual({
      url: "https://x.test/norm",
      company: "",
      title: "",
      location: "",
      source: "lever",
      note: "",
    });
  });

  it("defaults source to 'explorer' when neither source nor ats is present", async () => {
    const promise = addOffersToPipeline(
      [
        {
          url: "https://x.test/explorer",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
      "/fake/data/root",
    );
    const child = h.lastChild!;
    child.stdout.emit("data", Buffer.from('{"added":1}'));
    child.emit("close");
    await promise;

    const sent = JSON.parse(child.stdin.written) as Array<Record<string, string>>;
    expect(sent[0].source).toBe("explorer");
  });
});

// ── data-only checkout guard (no scan.mjs) ──────────────────────────────────
describe("addOffersToPipeline data-only guard", () => {
  it("returns an actionable error and never spawns when scan.mjs is missing", async () => {
    h.existsSyncMock.mockReturnValue(false);
    const result = await addOffersToPipeline([offer()], "/fake/data/root");
    expect(result.added).toBe(0);
    expect(result.error).toBe(
      "This checkout is data-only — the pipeline writer (scan.mjs) isn't available.",
    );
    expect(h.spawnMock).not.toHaveBeenCalled();
  });

  it("checks existence of the resolved scan.mjs path", async () => {
    h.existsSyncMock.mockReturnValue(false);
    await addOffersToPipeline([offer()], "/fake/data/root");
    expect(h.existsSyncMock).toHaveBeenCalledWith("/fake/engine/root/scan.mjs");
  });
});

// ── spawn wiring (cwd, env, argv) ───────────────────────────────────────────
describe("addOffersToPipeline spawn wiring", () => {
  it("spawns node with --input-type=module and an inline -e script", async () => {
    const promise = addOffersToPipeline([offer()], "/fake/data/root");
    const child = h.lastChild!;
    child.stdout.emit("data", Buffer.from('{"added":1}'));
    child.emit("close");
    await promise;

    const { cmd, args } = h.lastSpawnArgs!;
    expect(cmd).toBe(process.execPath);
    expect(args[0]).toBe("--input-type=module");
    expect(args[1]).toBe("-e");
    // The inline script imports the canonical writers from scan.mjs (as a file URL).
    expect(args[2]).toContain("appendToPipeline");
    expect(args[2]).toContain("appendToScanHistory");
    expect(args[2]).toContain("scan.mjs");
  });

  it("runs the child with cwd = engine root and env CAREER_OPS_ROOT = the passed data root", async () => {
    const promise = addOffersToPipeline([offer()], "/some/active/profile");
    const child = h.lastChild!;
    child.stdout.emit("data", Buffer.from('{"added":1}'));
    child.emit("close");
    await promise;

    const opts = h.lastSpawnArgs!.opts;
    expect(opts.cwd).toBe("/fake/engine/root");
    const env = opts.env as Record<string, string>;
    expect(env.CAREER_OPS_ROOT).toBe("/some/active/profile");
    // Inherits the rest of process.env (sanity: PATH carried through).
    expect(env.PATH).toBe(process.env.PATH);
  });

  it("defaults root to careerOpsRoot() when no root argument is given", async () => {
    const promise = addOffersToPipeline([offer()]);
    const child = h.lastChild!;
    child.stdout.emit("data", Buffer.from('{"added":1}'));
    child.emit("close");
    await promise;
    const env = h.lastSpawnArgs!.opts.env as Record<string, string>;
    expect(env.CAREER_OPS_ROOT).toBe("/fake/engine/root");
  });
});

// ── result parsing on close ─────────────────────────────────────────────────
describe("addOffersToPipeline result parsing", () => {
  it("parses { added } from the child's stdout", async () => {
    const { result } = await driveClose([offer(), offer({ url: "https://x.test/2" })], '{"added":2}');
    expect(result).toEqual({ added: 2, error: undefined });
  });

  it("propagates an error reported by the child in its JSON result", async () => {
    const { result } = await driveClose([offer()], '{"added":0,"error":"boom in writer"}');
    expect(result).toEqual({ added: 0, error: "boom in writer" });
  });

  it("coalesces a missing 'added' field to 0", async () => {
    const { result } = await driveClose([offer()], '{"error":"weird"}');
    // Upstream contract: an answer without a numeric `added` is not the writer's answer.
    expect(result.added).toBe(0);
    expect(result.error).toBe("pipeline writer failed (no result)");
  });

  it("treats empty stdout as a failure, never as 'nothing new to add'", async () => {
    const { result } = await driveClose([offer()], "");
    expect(result).toEqual({ added: 0, error: "pipeline writer failed (no result)" });
  });

  it("falls back to trimmed stderr when stdout is not valid JSON", async () => {
    const { result } = await driveClose([offer()], "this is not json", "  ERR: cannot import scan.mjs\n");
    expect(result.added).toBe(0);
    expect(result.error).toBe("pipeline writer failed (no result): ERR: cannot import scan.mjs");
  });

  it("caps the stderr fallback error at 200 chars", async () => {
    const longErr = "x".repeat(500);
    const { result } = await driveClose([offer()], "not json", longErr);
    expect(result.error).toBe(`pipeline writer failed (no result): ${"x".repeat(200)}`);
  });

  it("uses the 'no result' sentinel when both stdout and stderr are unusable", async () => {
    const { result } = await driveClose([offer()], "<<garbage not json>>", "");
    expect(result.added).toBe(0);
    expect(result.error).toBe("pipeline writer failed (no result)");
  });
});

// ── spawn / child error handling ────────────────────────────────────────────
describe("addOffersToPipeline error handling", () => {
  it("resolves { added: 0, error } when the child emits an 'error' event (Error)", async () => {
    const promise = addOffersToPipeline([offer()], "/fake/data/root");
    const child = h.lastChild!;
    child.emit("error", new Error("spawn ENOENT node"));
    const result = await promise;
    expect(result).toEqual({ added: 0, error: "spawn ENOENT node" });
  });

  it("uses the 'spawn failed' fallback when the error is not an Error instance", async () => {
    const promise = addOffersToPipeline([offer()], "/fake/data/root");
    const child = h.lastChild!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    child.emit("error", "string failure" as any);
    const result = await promise;
    expect(result).toEqual({ added: 0, error: "spawn failed" });
  });
});
