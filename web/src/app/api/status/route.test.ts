import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// One throwaway root the (mocked) careerOpsRoot()/rootScript() and requestRoot()
// both point at. /api/status no longer touches applications.md itself (#2900,
// #2901) — it delegates the whole read-modify-write to set-status.mjs via
// execFile, so what we control here is the CLI's (exit code, stdout) contract,
// not a real tracker file.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-status-route-"));
// fs.existsSync(script) is real fs, not mocked — the route feature-detects the
// core script before spawning, so a file must actually exist at that path.
fs.writeFileSync(path.join(ROOT, "set-status.mjs"), "// stub for existsSync\n");

vi.mock("@/lib/profile-registry", () => ({ requestRoot: vi.fn(async () => ROOT) }));
vi.mock("@/lib/career-ops", () => ({
  careerOpsRoot: () => ROOT,
  rootScript: vi.fn((name: string) => path.join(ROOT, `${name}.mjs`)),
}));

// Mock canonicalizeStatus so the test never depends on the user's real
// templates/states.yml (or its module-level cache). Route uses this as a fast
// pre-check before ever spawning set-status.mjs.
const CANON: Record<string, string> = {
  applied: "Applied",
  sent: "Applied", // alias
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};
vi.mock("@/lib/core/states", () => ({
  canonicalizeStatus: vi.fn((raw: string) => {
    const q = raw.trim().toLowerCase().replace(/\*\*/g, "");
    return CANON[q] ?? null;
  }),
}));

// The execFile seam: route.ts spawns set-status.mjs and reads back its --json
// stdout. Each test configures `h.respond` to answer with the CLI outcome it
// wants to exercise, without a real child process or a real tracker file.
type CliOutcome =
  | { kind: "ok"; stdout: string; stderr?: string }
  | { kind: "exit"; code: number; stdout?: string; stderr?: string }
  | { kind: "spawnFailed" }
  | { kind: "timedOut" };

const h = vi.hoisted(() => ({
  respond: null as ((args: string[]) => unknown) | null,
  lastArgs: null as string[] | null,
}));

vi.mock("node:child_process", () => ({
  execFile: (
    _file: string,
    args: string[],
    _opts: Record<string, unknown>,
    cb: (err: unknown, stdout: string, stderr: string) => void,
  ) => {
    h.lastArgs = args;
    const outcome = h.respond!(args) as CliOutcome;
    if (outcome.kind === "spawnFailed") {
      cb(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }), "", "");
    } else if (outcome.kind === "timedOut") {
      cb(Object.assign(new Error("killed"), { killed: true }), "", "");
    } else if (outcome.kind === "exit") {
      cb(Object.assign(new Error("exit"), { code: outcome.code }), outcome.stdout ?? "", outcome.stderr ?? "");
    } else {
      cb(null, outcome.stdout, outcome.stderr ?? "");
    }
  },
}));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/status", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

const okResult = (extra: Record<string, unknown> = {}) => ({
  kind: "ok" as const,
  stdout: JSON.stringify({ changed: true, num: 2, company: "Globex", role: "APM", oldStatus: "Evaluated", newStatus: "Interview", statusLogged: true, ...extra }),
});

beforeEach(() => {
  h.respond = () => okResult();
  h.lastArgs = null;
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("POST /api/status — happy path (delegates to set-status.mjs)", () => {
  it("updates status via the CLI and echoes the canonical label + changed/statusLogged", async () => {
    h.respond = () => okResult();
    const res = await post({ n: "2", status: "interview" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, status: "Interview", changed: true, statusLogged: true });
  });

  it("canonicalizes an alias to its label before spawning, and passes it to the CLI", async () => {
    h.respond = () => ({ kind: "ok", stdout: JSON.stringify({ changed: true, statusLogged: true }) });
    const res = await post({ n: "7", status: "sent" }); // alias for Applied
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("Applied");
    expect(h.lastArgs).toContain("Applied");
  });

  it("passes --row <n> and --source web to set-status.mjs", async () => {
    await post({ n: "5", status: "offer" });
    const args = h.lastArgs!;
    expect(args).toContain("--row");
    expect(args[args.indexOf("--row") + 1]).toBe("5");
    expect(args).toContain("--source");
    expect(args[args.indexOf("--source") + 1]).toBe("web");
    expect(args).toContain("--json");
  });

  it("changed:false (no-op re-set) is echoed through unchanged", async () => {
    h.respond = () => ({ kind: "ok", stdout: JSON.stringify({ changed: false }) });
    const res = await post({ n: "1", status: "applied" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, status: "Applied", changed: false, statusLogged: false });
  });
});

describe("POST /api/status — validation before any spawn", () => {
  it("returns 400 'bad json' on a malformed body", async () => {
    const res = await post("{ not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad json" });
    expect(h.lastArgs).toBeNull();
  });

  it("returns 400 when n is missing", async () => {
    const res = await post({ status: "Applied" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "n and status required" });
  });

  it("returns 400 when status is missing, non-string, or blank", async () => {
    for (const body of [{ n: "1" }, { n: "1", status: 42 }, { n: "1", status: "   " }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "n and status required" });
    }
  });

  it("rejects table-breaking characters (pipe, newline, asterisk) with 400 before canonicalizing", async () => {
    for (const status of ["App|lied", "Applied\nRejected", "App*lied"]) {
      const res = await post({ n: "1", status });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid status (table-breaking characters)" });
    }
    expect(h.lastArgs).toBeNull();
  });

  it("returns 400 for a non-canonical status without spawning", async () => {
    const res = await post({ n: "1", status: "Ghosted" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not a canonical status: Ghosted" });
    expect(h.lastArgs).toBeNull();
  });

  it("returns 400 when n is not a tracker row number, without spawning", async () => {
    const res = await post({ n: "not-a-number", status: "applied" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "n must be a tracker row number" });
    expect(h.lastArgs).toBeNull();
  });
});

describe("POST /api/status — core script missing (data-only root)", () => {
  it("returns 503 core-script-missing without spawning", async () => {
    const bareRoot = fs.mkdtempSync(path.join(os.tmpdir(), "co-status-bare-"));
    const { rootScript } = await import("@/lib/career-ops");
    vi.mocked(rootScript).mockReturnValueOnce(path.join(bareRoot, "set-status.mjs")); // no such file
    const res = await post({ n: "1", status: "applied" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "status updates need the career-ops scripts; this root has data only",
      code: "core-script-missing",
    });
    expect(h.lastArgs).toBeNull();
    fs.rmSync(bareRoot, { recursive: true, force: true });
  });
});

describe("POST /api/status — set-status.mjs error contract", () => {
  it("maps exit 2 (not-found) to 404 with the CLI's message and code", async () => {
    h.respond = () => ({ kind: "exit", code: 2, stdout: JSON.stringify({ error: "No tracker row with #99", code: "not-found" }) });
    const res = await post({ n: "99", status: "applied" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No tracker row with #99", code: "not-found" });
  });

  it("maps exit 2 (no-tracker) to 404", async () => {
    h.respond = () => ({ kind: "exit", code: 2, stdout: JSON.stringify({ error: "No tracker found at /x/data/applications.md", code: "no-tracker" }) });
    const res = await post({ n: "1", status: "applied" });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("no-tracker");
  });

  it("maps exit 3 (ambiguous) to 409", async () => {
    h.respond = () => ({ kind: "exit", code: 3, stdout: JSON.stringify({ error: "Multiple rows match", code: "ambiguous" }) });
    const res = await post({ n: "1", status: "applied" });
    expect(res.status).toBe(409);
  });

  it("maps exit 4 (lock contention) to 503 with Retry-After", async () => {
    h.respond = () => ({ kind: "exit", code: 4, stdout: JSON.stringify({ error: "Cannot acquire tracker lock", code: "lock-timeout" }) });
    const res = await post({ n: "1", status: "applied" });
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("maps exit 1 with a client-error code (usage/invalid-state) to 400", async () => {
    h.respond = () => ({ kind: "exit", code: 1, stdout: JSON.stringify({ error: '"applied" is not a canonical state', code: "invalid-state" }) });
    const res = await post({ n: "1", status: "applied" });
    expect(res.status).toBe(400);
  });

  it("maps exit 1 with an unrecognized/missing code to 500 (assume ours, not theirs)", async () => {
    h.respond = () => ({ kind: "exit", code: 1, stdout: "", stderr: "TypeError: something exploded\n    at ..." });
    const res = await post({ n: "1", status: "applied" });
    expect(res.status).toBe(500);
  });

  it("returns 500 when the child fails to spawn at all", async () => {
    h.respond = () => ({ kind: "spawnFailed" });
    const res = await post({ n: "1", status: "applied" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "status update failed to run" });
  });

  it("returns 504 with Retry-After when the child is killed by our own timeout", async () => {
    h.respond = () => ({ kind: "timedOut" });
    const res = await post({ n: "1", status: "applied" });
    expect(res.status).toBe(504);
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("returns 500 when the CLI exits 0 but prints no parseable JSON document", async () => {
    h.respond = () => ({ kind: "ok", stdout: "not json at all" });
    const res = await post({ n: "1", status: "applied" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "status update returned no result" });
  });
});
