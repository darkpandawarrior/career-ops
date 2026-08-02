import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * /api/followups runs the SAME followup-cadence.mjs --json as /api/cadence, but it
 * is the "home" view: it surfaces only the overdue/urgent top-6 (cadence returns
 * the full list). The shaping logic:
 *   overdue = entries.filter(status ~ /overdue|urgent/i).slice(0, 8)
 *   top     = (overdue.length ? overdue : entries).slice(0, 6)
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

// Build N entries with a given status, labelled so order is verifiable.
function entriesWith(status: string, n: number, prefix = "C") {
  return Array.from({ length: n }, (_, i) => ({ company: `${prefix}${i}`, status }));
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

  it("prioritises overdue/urgent entries over non-overdue ones", async () => {
    const payload = {
      metadata: null,
      entries: [
        { company: "Scheduled1", status: "scheduled" },
        { company: "Overdue1", status: "overdue" },
        { company: "Urgent1", status: "URGENT" },
        { company: "Due1", status: "due" },
      ],
    };
    feed(JSON.stringify(payload));
    const res = await GET(req());
    const body = await res.json();
    // Only the overdue/urgent ones survive (filter), in their original order.
    expect(body.entries.map((e: { company: string }) => e.company)).toEqual(["Overdue1", "Urgent1"]);
  });

  it("matches 'urgent' case-insensitively (regex /overdue|urgent/i)", async () => {
    feed(JSON.stringify({ entries: [{ company: "A", status: "Very Urgent Now" }, { company: "B", status: "ok" }] }));
    const res = await GET(req());
    const body = await res.json();
    expect(body.entries.map((e: { company: string }) => e.company)).toEqual(["A"]);
  });

  it("caps the overdue set at 8 BEFORE the final top-6 trim → returns 6", async () => {
    // 10 overdue → slice(0,8) → 8 → top = slice(0,6) → 6.
    feed(JSON.stringify({ entries: entriesWith("overdue", 10) }));
    const res = await GET(req());
    const body = await res.json();
    expect(body.entries).toHaveLength(6);
    expect(body.entries.map((e: { company: string }) => e.company)).toEqual(["C0", "C1", "C2", "C3", "C4", "C5"]);
  });

  it("falls back to the (capped) full list when NOTHING is overdue/urgent", async () => {
    // No overdue → overdue.length === 0 → use entries → slice(0,6).
    feed(JSON.stringify({ entries: entriesWith("scheduled", 9) }));
    const res = await GET(req());
    const body = await res.json();
    expect(body.entries).toHaveLength(6);
    expect(body.entries.map((e: { company: string }) => e.company)).toEqual(["C0", "C1", "C2", "C3", "C4", "C5"]);
  });

  it("returns fewer than 6 when there are fewer than 6 entries", async () => {
    feed(JSON.stringify({ entries: entriesWith("due", 3) }));
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

  it("tolerates entries with no status field (String(undefined) → 'undefined', no match)", async () => {
    feed(JSON.stringify({ entries: [{ company: "NoStatus" }, { company: "Overdue", status: "overdue" }] }));
    const res = await GET(req());
    const body = await res.json();
    // Only the overdue one matches; the status-less one is filtered out.
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
    expect(h.lastCall!.file).toBe("node");
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
    expect(body).toEqual({ available: false, metadata: null, entries: [] });
    expect(h.execFileMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/followups — bad output / non-zero exit", () => {
  it("returns the empty shape when stdout is empty", async () => {
    feed("");
    const res = await GET(req());
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [] });
  });

  it("returns the empty shape when stdout has no '{'", async () => {
    feed("no json at all");
    const res = await GET(req());
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [] });
  });

  it("returns the empty shape when the JSON is malformed", async () => {
    feed("{ nope: not json }");
    const res = await GET(req());
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [] });
  });

  it("returns the empty shape on trailing junk after valid JSON (slice runs to END)", async () => {
    feed(JSON.stringify({ entries: entriesWith("overdue", 2) }) + "\nextra log\n");
    const res = await GET(req());
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [] });
  });

  it("does NOT trust partial stdout from a non-zero-exit child (regression)", async () => {
    // On a hard failure the route blanks the output rather than rendering a
    // crashed run's partial JSON as if it succeeded.
    feed(JSON.stringify({ metadata: { partial: true }, entries: entriesWith("overdue", 3) }), new Error("exit 1"));
    const res = await GET(req());
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [] });
  });

  it("returns the empty shape when the child errors AND produced no stdout", async () => {
    feed("", new Error("ENOENT"));
    const res = await GET(req());
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [] });
  });
});
