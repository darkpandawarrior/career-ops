import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * /api/ops/run is the operations console — it spawns the REAL core `.mjs` scripts
 * (verify-pipeline, scan, check-liveness) via `execFile`, scoped to the active
 * profile via CAREER_OPS_ROOT, and returns their text output verbatim. We:
 *   - mock `@/lib/profile-registry` so `requestRoot()` resolves a fixed data root,
 *   - mock `@/lib/career-ops` so `careerOpsRoot()`/`rootScript()` point into a tmp
 *     ENGINE dir (we touch the script files on disk so the route's `fs.existsSync`
 *     gate is real),
 *   - mock `node:child_process`'s `execFile` to invoke its callback with canned
 *     stdout/stderr + a synthetic exit — NO real process spawns.
 *
 * The contract under test: ONLY allowlisted ops run; an unknown op is rejected
 * 400 (with the `allowed` list); a missing-on-disk script is rejected 400; and an
 * allowlisted, present op spawns `node <script> ...args` and returns the captured
 * output + code.
 */

const ENGINE = fs.mkdtempSync(path.join(os.tmpdir(), "co-ops-run-engine-"));
const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-ops-run-data-"));

// The bare script names the allowlist references (rootScript appends .mjs).
const SCRIPTS = ["verify-pipeline", "scan", "check-liveness"] as const;
const scriptPath = (name: string) => path.join(ENGINE, `${name}.mjs`);

// Hoisted holder: the canned execFile behaviour + the captured call args.
const h = vi.hoisted(() => ({
  stdout: "" as string,
  stderr: "" as string,
  error: null as (Error & { code?: number }) | null,
  lastCall: null as { file: string; args: string[]; opts: Record<string, unknown> } | null,
  execFileMock: vi.fn(),
}));

h.execFileMock.mockImplementation(
  (
    file: string,
    args: string[],
    opts: Record<string, unknown>,
    cb: (e: (Error & { code?: number }) | null, out: string, err: string) => void,
  ) => {
    h.lastCall = { file, args, opts };
    // Defer like a real async child so the route's Promise wiring is exercised.
    queueMicrotask(() => cb(h.error, h.stdout, h.stderr));
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

import { POST } from "./route";

function feed(stdout: string, stderr = "", error: (Error & { code?: number }) | null = null) {
  h.stdout = stdout;
  h.stderr = stderr;
  h.error = error;
}

function postOp(op: unknown): Promise<Response> {
  return POST(new Request("http://localhost/api/ops/run", { method: "POST", body: JSON.stringify({ op }) }));
}

beforeEach(() => {
  feed("", "", null);
  h.lastCall = null;
  h.execFileMock.mockClear();
  // All allowlisted scripts present on disk by default so the existsSync gate passes.
  for (const s of SCRIPTS) fs.writeFileSync(scriptPath(s), `// fake ${s}\n`);
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  fs.rmSync(ENGINE, { recursive: true, force: true });
  fs.rmSync(DATA_ROOT, { recursive: true, force: true });
});

describe("POST /api/ops/run — allowlist enforcement", () => {
  it("rejects a non-allowlisted op with 400 and lists the allowed ops, WITHOUT spawning", async () => {
    const res = await postOp("rm-rf-everything");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("unknown op");
    // The allowlisted ops are surfaced so the client can render valid choices.
    expect(body.allowed).toEqual([
      "pipeline-health", "scan", "scan-verify", "liveness",
      "process-quality", "detect-reposts", "apify-search",
    ]);
    expect(h.execFileMock).not.toHaveBeenCalled();
  });

  it("rejects a missing op (no `op` key) with 400 'unknown op'", async () => {
    const res = await POST(
      new Request("http://localhost/api/ops/run", { method: "POST", body: JSON.stringify({ notOp: "scan" }) }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unknown op");
    expect(h.execFileMock).not.toHaveBeenCalled();
  });

  it("rejects an empty-string op with 400 'unknown op'", async () => {
    const res = await postOp("");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unknown op");
    expect(h.execFileMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed JSON body with 400 'bad json' before any allowlist lookup", async () => {
    const res = await POST(new Request("http://localhost/api/ops/run", { method: "POST", body: "{ not json" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad json");
    expect(h.execFileMock).not.toHaveBeenCalled();
  });

  it("rejects an allowlisted op whose script is absent on disk with 400 (no spawn)", async () => {
    // pipeline-health maps to verify-pipeline.mjs; remove it so existsSync fails.
    fs.rmSync(scriptPath("verify-pipeline"), { force: true });
    const res = await postOp("pipeline-health");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("verify-pipeline.mjs not found in this checkout");
    expect(h.execFileMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/ops/run — allowlisted op spawns and returns output", () => {
  it("spawns node against the mapped script, scoped to the data root, and returns the output", async () => {
    feed("✅ Pipeline healthy\n");
    const res = await postOp("pipeline-health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      op: "pipeline-health",
      label: "Pipeline health",
      output: "✅ Pipeline healthy",
      code: 0,
    });

    // execFile was called as node <verify-pipeline.mjs> with no extra args.
    expect(h.execFileMock).toHaveBeenCalledTimes(1);
    expect(h.lastCall!.file).toBe("node");
    expect(h.lastCall!.args).toEqual([scriptPath("verify-pipeline")]);
    expect(h.lastCall!.opts.cwd).toBe(ENGINE);
    expect((h.lastCall!.opts.env as Record<string, string>).CAREER_OPS_ROOT).toBe(DATA_ROOT);
    // Network/browser-heavy ops use a longer timeout — pipeline-health is the short one.
    expect(h.lastCall!.opts.timeout).toBe(60_000);
  });

  it("passes the op's extra args through (scan-verify -> scan.mjs --verify)", async () => {
    feed("liveness ok\n");
    const res = await postOp("scan-verify");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.op).toBe("scan-verify");
    expect(body.label).toBe("Scan + verify liveness");
    // scan-verify maps to the scan script WITH the --verify flag.
    expect(h.lastCall!.args).toEqual([scriptPath("scan"), "--verify"]);
    expect(h.lastCall!.opts.timeout).toBe(280_000);
  });

  it("maps `scan` to scan.mjs with no extra args", async () => {
    feed("scan done\n");
    await postOp("scan");
    expect(h.lastCall!.args).toEqual([scriptPath("scan")]);
  });

  it("maps `liveness` to check-liveness.mjs", async () => {
    feed("checked\n");
    const res = await postOp("liveness");
    expect(res.status).toBe(200);
    expect((await res.json()).label).toBe("Liveness check");
    expect(h.lastCall!.args).toEqual([scriptPath("check-liveness")]);
    expect(h.lastCall!.opts.timeout).toBe(200_000);
  });

  it("appends stderr to stdout and trims the combined output", async () => {
    feed("main report\n", "a warning");
    const res = await postOp("scan");
    const body = await res.json();
    // out = stdout + "\n" + stderr, then trimmed.
    expect(body.output).toBe("main report\n\na warning");
  });

  it("surfaces the numeric exit code from a failed (non-zero) child", async () => {
    const err = new Error("Command failed") as Error & { code?: number };
    err.code = 2;
    feed("partial output\n", "❌ something broke", err);
    const res = await postOp("pipeline-health");
    expect(res.status).toBe(200); // route still 200s; failure is reported in `code`
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.code).toBe(2);
    expect(body.output).toContain("partial output");
    expect(body.output).toContain("❌ something broke");
  });

  it("reports code 1 when the error carries no numeric code", async () => {
    feed("", "", new Error("ETIMEDOUT killed"));
    const res = await postOp("scan");
    expect((await res.json()).code).toBe(1);
  });

  it("reports code 0 when there is no error", async () => {
    feed("all good", "");
    expect((await postOp("scan")).status).toBe(200);
    expect((await (await postOp("scan")).json()).code).toBe(0);
  });
});
