import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * /api/patterns runs the core's analyze-patterns.mjs (via execFile) and returns
 * the LAST `{...}` JSON block from its stdout. We:
 *   - mock `@/lib/profile-registry` so `requestRoot()` resolves a fixed data root
 *     (recipe (a) — simplest for read routes),
 *   - mock `@/lib/career-ops` so `careerOpsRoot()`/`rootScript()` point into a tmp
 *     ENGINE dir (we touch the script file on disk so `fs.existsSync` is real),
 *   - mock `node:child_process`'s `execFile` to invoke its callback with canned
 *     stdout — NO real process spawns.
 *
 * The route's callback is `(_e, out) => resolve(out || "")`: it reads ONLY stdout
 * and ignores both the error and the exit code, so "non-zero exit" is modelled by
 * a thrown/error-carrying callback whose stdout is empty or unparseable.
 */

const ENGINE = fs.mkdtempSync(path.join(os.tmpdir(), "co-patterns-route-"));
const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-patterns-data-"));
const SCRIPT = path.join(ENGINE, "analyze-patterns.mjs");

// Hoisted holder: the canned execFile behaviour + the captured call args.
const h = vi.hoisted(() => ({
  // (error, stdout) the fake execFile callback will receive.
  stdout: "" as string,
  error: null as Error | null,
  lastCall: null as { file: string; args: string[]; opts: Record<string, unknown> } | null,
  execFileMock: vi.fn(),
}));

h.execFileMock.mockImplementation(
  (file: string, args: string[], opts: Record<string, unknown>, cb: (e: Error | null, out: string) => void) => {
    h.lastCall = { file, args, opts };
    // Defer like a real async child so the route's Promise wiring is exercised.
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

// Convenience: set the canned execFile result for the next route call.
function feed(stdout: string, error: Error | null = null) {
  h.stdout = stdout;
  h.error = error;
}

beforeEach(() => {
  feed("", null);
  h.lastCall = null;
  h.execFileMock.mockClear();
  // The script must exist on disk for the route's existsSync gate to pass.
  fs.writeFileSync(SCRIPT, "// fake analyze-patterns\n");
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  fs.rmSync(ENGINE, { recursive: true, force: true });
  fs.rmSync(DATA_ROOT, { recursive: true, force: true });
});

describe("GET /api/patterns — happy path", () => {
  it("returns available:true and the parsed JSON result", async () => {
    feed(JSON.stringify({ totalRejections: 3, topReason: "no response" }));
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      available: true,
      result: { totalRejections: 3, topReason: "no response" },
    });
  });

  it("extracts the LAST {...} block when human text precedes the JSON", async () => {
    feed("Analyzing patterns...\nFound 5 rejections.\n{\"verdict\":\"ghosted\",\"count\":5}\n");
    const res = await GET();
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.result).toEqual({ verdict: "ghosted", count: 5 });
  });

  it("uses indexOf('{') .. lastIndexOf('}') so a trailing log line after the JSON is tolerated", async () => {
    // Note: this slices from the FIRST '{' to the LAST '}', so nested objects in a
    // single JSON document round-trip; trailing non-JSON text after '}' is dropped.
    feed("{\"a\":{\"b\":2}}\nDone.\n");
    const res = await GET();
    const body = await res.json();
    expect(body.result).toEqual({ a: { b: 2 } });
  });

  it("invokes node with the script path and --json, scoped to the data root via env", async () => {
    feed(JSON.stringify({ ok: true }));
    await GET();
    expect(h.lastCall).not.toBeNull();
    expect(h.lastCall!.file).toBe("node");
    expect(h.lastCall!.args).toEqual([SCRIPT, "--json"]);
    expect(h.lastCall!.opts.cwd).toBe(ENGINE);
    const env = h.lastCall!.opts.env as Record<string, string>;
    expect(env.CAREER_OPS_ROOT).toBe(DATA_ROOT);
  });
});

describe("GET /api/patterns — missing script", () => {
  it("returns available:false WITHOUT spawning when the script does not exist", async () => {
    fs.rmSync(SCRIPT, { force: true });
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ available: false, result: null });
    expect(h.execFileMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/patterns — bad output / non-zero exit", () => {
  it("returns available:false when stdout is empty (e.g. crashed before output)", async () => {
    feed("");
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ available: false, result: null });
  });

  it("returns available:false when stdout contains no JSON braces at all", async () => {
    feed("Error: analyze-patterns failed to start\n");
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ available: false, result: null });
  });

  it("returns available:false when the braces enclose invalid JSON (parse throws)", async () => {
    feed("{ not: valid, json }");
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ available: false, result: null });
  });

  it("returns available:false when '}' precedes '{' (end <= start guard)", async () => {
    // lastIndexOf('}') is before indexOf('{') → end <= start → early false.
    feed("} stray brace then { open");
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ available: false, result: null });
  });

  it("does NOT trust partial stdout from a non-zero-exit child (regression)", async () => {
    // A crashed child may have printed partial/garbled JSON; the route now blanks
    // the output on error so a failed run degrades to available:false, not garbage.
    feed(JSON.stringify({ partial: true }), new Error("Command failed: exit 1"));
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ available: false, result: null });
  });

  it("returns available:false when the child errors AND produced no stdout", async () => {
    feed("", new Error("Command failed: exit 2"));
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ available: false, result: null });
  });
});
