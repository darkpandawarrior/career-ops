import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * /api/followups runs the SAME followup-cadence.mjs --json as /api/cadence, but it
 * is the "home" view: it surfaces only what is DUE (cadence returns the full
 * list). The shaping lives in lib/core/followup-view.mjs (#86):
 *   entries     = selectDueFollowups(entries, 8)   // urgency urgent|overdue
 *   nextUpcoming = due.length ? null : the nearest not-yet-due entry
 *
 * The old shape filtered on `status` (applied/responded/interview — never
 * "overdue"), so it matched nothing and fell back to an unfiltered top-6 that
 * the home rendered under a "Follow-ups due" heading. Nothing due now says so.
 *
 * Mocking mirrors the patterns/cadence tests: requestRoot → fixed data root,
 * careerOpsRoot/rootScript → tmp ENGINE (real script for the existsSync gate),
 * execFile → canned-stdout callback. Route slices stdout from the first '{' to the
 * END and JSON.parse's it; the callback ignores the error/exit code (reads stdout
 * only). This route returns via `Response.json`, not NextResponse.
 */

const ENGINE = fs.mkdtempSync(path.join(os.tmpdir(), "co-followups-route-"));
const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-followups-data-"));
const SCRIPT = path.join(ENGINE, "followup-cadence.mjs");

const h = vi.hoisted(() => ({
  stdout: "" as string,
  error: null as Error | null,
  lastCall: null as { file: string; args: string[]; opts: Record<string, unknown> } | null,
  execFileMock: vi.fn(),
}));

h.execFileMock.mockImplementation(
  (file: string, args: string[], opts: Record<string, unknown>, cb: (e: Error | null, out: string) => void) => {
    h.lastCall = { file, args, opts };
    queueMicrotask(() => cb(h.error, h.stdout));
    return {} as ReturnType<typeof import("node:child_process").execFile>;
  },
);

vi.mock("node:child_process", () => ({ execFile: h.execFileMock }));

vi.mock("@/lib/career-ops", () => ({
  careerOpsRoot: () => ENGINE,
  rootScript: (name: string) => path.join(ENGINE, `${name}.mjs`),
}));

vi.mock("@/lib/profile-registry", () => ({
  requestRoot: vi.fn(async () => DATA_ROOT),
}));

import { GET } from "./route";

function feed(stdout: string, error: Error | null = null) {
  h.stdout = stdout;
  h.error = error;
}

// Build N entries with a given cadence urgency, labelled so order is verifiable.
function entriesWith(urgency: string, n: number, prefix = "C") {
  return Array.from({ length: n }, (_, i) => ({ company: `${prefix}${i}`, urgency }));
}

beforeEach(() => {
  feed("", null);
  h.lastCall = null;
  h.execFileMock.mockClear();
  fs.writeFileSync(SCRIPT, "// fake followup-cadence\n");
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  fs.rmSync(ENGINE, { recursive: true, force: true });
  fs.rmSync(DATA_ROOT, { recursive: true, force: true });
});

// GET now reads `?full=1` off the request, so every call site needs one.
// Bare `req()` is the home-card shape (capped list); `req("?full=1")` is the
// /followups tracker-page shape.
const req = (qs = "") => new Request(`http://localhost/api/followups${qs}`);

describe("GET /api/followups — happy path + shaping", () => {
  it("returns available:true with metadata and the shaped entries", async () => {
    feed(JSON.stringify({ metadata: { total: 2 }, entries: entriesWith("overdue", 2) }));
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.available).toBe(true);
    expect(body.metadata).toEqual({ total: 2 });
    expect(body.entries.map((e: { company: string }) => e.company)).toEqual(["C0", "C1"]);
    expect(body.nextUpcoming).toBeNull();
  });

  it("?full=1 returns every entry uncapped, plus cadenceConfig", async () => {
    // The home card caps at 6; the tracker page must get the whole list and the
    // cadence settings it renders the config panel from.
    feed(JSON.stringify({ metadata: { total: 9 }, entries: entriesWith("scheduled", 9), cadenceConfig: { first: 7 } }));
    const res = await GET(req("?full=1"));
    const body = await res.json();
    expect(body.entries).toHaveLength(9);
    expect(body.cadenceConfig).toEqual({ first: 7 });
  });

  it("?full=1 does not apply the overdue-first reordering the home card uses", async () => {
    feed(JSON.stringify({ entries: [{ company: "Scheduled1", status: "scheduled" }, { company: "Overdue1", status: "overdue" }] }));
    const body = await (await GET(req("?full=1"))).json();
    expect(body.entries.map((e: { company: string }) => e.company)).toEqual(["Scheduled1", "Overdue1"]);
    expect(body.cadenceConfig).toBeNull();
  });

  it("keeps only what is due, urgent ahead of overdue", async () => {
    const payload = {
      metadata: null,
      entries: [
        { company: "Waiting1", urgency: "waiting" },
        { company: "Overdue1", urgency: "overdue" },
        { company: "Urgent1", urgency: "urgent" },
        { company: "Cold1", urgency: "cold" },
      ],
    };
    feed(JSON.stringify(payload));
    const res = await GET(req());
    const body = await res.json();
    // 'waiting'/'cold' are NOT due and must never render under "Follow-ups due".
    expect(body.entries.map((e: { company: string }) => e.company)).toEqual(["Urgent1", "Overdue1"]);
  });

  it("reads urgency, not status — a tracker status never makes a row due", async () => {
    // The pre-#86 shape filtered `status`, where "overdue"/"urgent" never appear.
    feed(JSON.stringify({ entries: [{ company: "A", status: "Very Urgent Now" }, { company: "B", status: "overdue" }] }));
    const res = await GET(req());
    const body = await res.json();
    expect(body.entries).toEqual([]);
  });

  it("caps the due set at 8", async () => {
    feed(JSON.stringify({ entries: entriesWith("overdue", 10) }));
    const res = await GET(req());
    const body = await res.json();
    expect(body.entries).toHaveLength(8);
    expect(body.entries.map((e: { company: string }) => e.company)).toEqual(["C0", "C1", "C2", "C3", "C4", "C5", "C6", "C7"]);
  });

  it("returns NO entries when nothing is due, and names the nearest upcoming one", async () => {
    feed(
      JSON.stringify({
        entries: [
          { company: "Far", urgency: "waiting", nextFollowupDate: "2026-09-30" },
          { company: "Near", urgency: "waiting", nextFollowupDate: "2026-09-01" },
          { company: "Undated", urgency: "cold" },
        ],
      }),
    );
    const res = await GET(req());
    const body = await res.json();
    expect(body.entries).toEqual([]);
    expect(body.nextUpcoming.company).toBe("Near");
  });

  it("returns fewer than the cap when fewer entries are due", async () => {
    feed(JSON.stringify({ entries: entriesWith("urgent", 3) }));
    const res = await GET(req());
    const body = await res.json();
    expect(body.entries).toHaveLength(3);
  });

  it("returns an empty entries array when the cadence has no entries", async () => {
    feed(JSON.stringify({ metadata: { total: 0 }, entries: [] }));
    const res = await GET(req());
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.entries).toEqual([]);
  });

  it("treats a non-array entries field as empty (String(e.status) guard never runs)", async () => {
    feed(JSON.stringify({ entries: { not: "array" } }));
    const res = await GET(req());
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.entries).toEqual([]);
  });

  it("tolerates entries with no urgency field", async () => {
    feed(JSON.stringify({ entries: [{ company: "NoUrgency" }, { company: "Overdue", urgency: "overdue" }] }));
    const res = await GET(req());
    const body = await res.json();
    // Only the overdue one is due; the urgency-less one is neither due nor
    // upcoming (no nextFollowupDate), so it never surfaces.
    expect(body.entries.map((e: { company: string }) => e.company)).toEqual(["Overdue"]);
  });

  it("defaults metadata to null when omitted", async () => {
    feed(JSON.stringify({ entries: entriesWith("overdue", 1) }));
    const res = await GET(req());
    const body = await res.json();
    expect(body.metadata).toBeNull();
  });

  it("invokes node with the script path and --json, scoped to the data root via env", async () => {
    feed(JSON.stringify({ entries: [] }));
    await GET(req());
    expect(h.lastCall!.file).toBe(process.execPath);
    expect(h.lastCall!.args).toEqual([SCRIPT, "--json"]);
    expect(h.lastCall!.opts.cwd).toBe(ENGINE);
    const env = h.lastCall!.opts.env as Record<string, string>;
    expect(env.CAREER_OPS_ROOT).toBe(DATA_ROOT);
  });
});

describe("GET /api/followups — missing script", () => {
  it("returns the empty shape WITHOUT spawning when the script does not exist", async () => {
    fs.rmSync(SCRIPT, { force: true });
    const res = await GET(req());
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [], upcoming: [], nextUpcoming: null });
    expect(h.execFileMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/followups — bad output / non-zero exit", () => {
  it("returns the empty shape when stdout is empty", async () => {
    feed("");
    const res = await GET(req());
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [], upcoming: [], nextUpcoming: null });
  });

  it("returns the empty shape when stdout has no '{'", async () => {
    feed("no json at all");
    const res = await GET(req());
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [], upcoming: [], nextUpcoming: null });
  });

  it("returns the empty shape when the JSON is malformed", async () => {
    feed("{ nope: not json }");
    const res = await GET(req());
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [], upcoming: [], nextUpcoming: null });
  });

  it("returns the empty shape on trailing junk after valid JSON (slice runs to END)", async () => {
    feed(JSON.stringify({ entries: entriesWith("overdue", 2) }) + "\nextra log\n");
    const res = await GET(req());
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [], upcoming: [], nextUpcoming: null });
  });

  it("does NOT trust partial stdout from a non-zero-exit child (regression)", async () => {
    // On a hard failure the route blanks the output rather than rendering a
    // crashed run's partial JSON as if it succeeded.
    feed(JSON.stringify({ metadata: { partial: true }, entries: entriesWith("overdue", 3) }), new Error("exit 1"));
    const res = await GET(req());
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [], upcoming: [], nextUpcoming: null });
  });

  it("returns the empty shape when the child errors AND produced no stdout", async () => {
    feed("", new Error("ENOENT"));
    const res = await GET(req());
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [], upcoming: [], nextUpcoming: null });
  });
});
