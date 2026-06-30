import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * /api/cadence runs followup-cadence.mjs --json (via execFile) and returns
 * { available, metadata, entries }. Unlike /api/patterns it slices from the FIRST
 * '{' to the END of stdout (no lastIndexOf('}') trim), then JSON.parse's that.
 *
 * Same mocking shape as the patterns test: requestRoot → fixed data root,
 * careerOpsRoot/rootScript → tmp ENGINE (real script file on disk for the
 * existsSync gate), and execFile → canned-stdout callback. The route's callback
 * is `(_e, out) => resolve(out || "")`, so it ignores the error/exit code and
 * reads ONLY stdout.
 */

const ENGINE = fs.mkdtempSync(path.join(os.tmpdir(), "co-cadence-route-"));
const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-cadence-data-"));
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

describe("GET /api/cadence — happy path", () => {
  it("returns the FULL entry list with metadata", async () => {
    const payload = {
      metadata: { generatedAt: "2026-06-30", total: 3 },
      entries: [
        { company: "Acme", status: "overdue", dueIn: -2 },
        { company: "Beta", status: "due", dueIn: 0 },
        { company: "Gamma", status: "scheduled", dueIn: 4 },
      ],
    };
    feed(JSON.stringify(payload));
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.available).toBe(true);
    expect(body.metadata).toEqual(payload.metadata);
    expect(body.entries).toHaveLength(3);
    expect(body.entries).toEqual(payload.entries);
  });

  it("strips human preamble before the first '{' and parses the rest", async () => {
    feed("Computing cadence...\n" + JSON.stringify({ metadata: { total: 1 }, entries: [{ company: "Solo" }] }));
    const res = await GET();
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.metadata).toEqual({ total: 1 });
    expect(body.entries).toEqual([{ company: "Solo" }]);
  });

  it("defaults metadata to null when the JSON omits it", async () => {
    feed(JSON.stringify({ entries: [{ company: "X" }] }));
    const res = await GET();
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.metadata).toBeNull();
    expect(body.entries).toEqual([{ company: "X" }]);
  });

  it("coerces a non-array entries field to an empty array", async () => {
    feed(JSON.stringify({ metadata: { total: 0 }, entries: "not-an-array" }));
    const res = await GET();
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.metadata).toEqual({ total: 0 });
    expect(body.entries).toEqual([]);
  });

  it("treats a missing entries field as an empty array", async () => {
    feed(JSON.stringify({ metadata: { total: 0 } }));
    const res = await GET();
    const body = await res.json();
    expect(body.entries).toEqual([]);
  });

  it("invokes node with the script path and --json, scoped to the data root via env", async () => {
    feed(JSON.stringify({ metadata: null, entries: [] }));
    await GET();
    expect(h.lastCall!.file).toBe("node");
    expect(h.lastCall!.args).toEqual([SCRIPT, "--json"]);
    expect(h.lastCall!.opts.cwd).toBe(ENGINE);
    const env = h.lastCall!.opts.env as Record<string, string>;
    expect(env.CAREER_OPS_ROOT).toBe(DATA_ROOT);
  });
});

describe("GET /api/cadence — missing script", () => {
  it("returns the empty shape WITHOUT spawning when the script does not exist", async () => {
    fs.rmSync(SCRIPT, { force: true });
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [] });
    expect(h.execFileMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/cadence — bad output / non-zero exit", () => {
  it("returns available:false when stdout is empty", async () => {
    feed("");
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [] });
  });

  it("returns available:false when stdout has no '{' (slice(-1) yields the last char, parse fails)", async () => {
    // indexOf('{') === -1 → slice(-1) takes the last character → JSON.parse throws.
    feed("plain text, no json here");
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [] });
  });

  it("returns available:false when the JSON is malformed from the first brace", async () => {
    feed("{ broken json: }}}");
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [] });
  });

  it("returns available:false on trailing junk after a valid object (slice goes to END, not last brace)", async () => {
    // Unlike /api/patterns, cadence does NOT trim to lastIndexOf('}'); a trailing
    // log line after the JSON makes JSON.parse throw → available:false.
    feed(JSON.stringify({ metadata: null, entries: [] }) + "\nDone scanning.\n");
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [] });
  });

  it("does NOT trust partial stdout from a non-zero-exit child (regression)", async () => {
    // On a hard failure the route blanks the output rather than rendering a
    // crashed run's partial JSON as if it succeeded.
    feed(JSON.stringify({ metadata: { partial: true }, entries: [{ company: "P" }] }), new Error("exit 1"));
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [] });
  });

  it("returns the empty shape when the child errors AND produced no stdout", async () => {
    feed("", new Error("ENOENT"));
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ available: false, metadata: null, entries: [] });
  });
});
