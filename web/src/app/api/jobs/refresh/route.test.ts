import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

// A real on-disk engine root so the route's `fs.existsSync(cli)` check passes
// (or fails) deterministically. engineScript()/engineRoot() are mocked to point
// here; we create/remove job-search-cli.mjs per test to exercise both branches.
const ENGINE = fs.mkdtempSync(path.join(os.tmpdir(), "co-refresh-engine-"));
const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-refresh-data-"));
const CLI = path.join(ENGINE, "job-search-cli.mjs");

vi.mock("@/lib/career-ops", () => ({
  engineScript: vi.fn((name: string) => path.join(ENGINE, `${name}.mjs`)),
  engineRoot: vi.fn(() => ENGINE),
}));

vi.mock("@/lib/profile-registry", () => ({
  requestRoot: vi.fn(async () => DATA_ROOT),
}));

// Fake child process: an EventEmitter with a stdout EventEmitter and a kill spy.
// The most recent fake is captured so a test can drive its events after POST().
// The spawn mock + shared state live in vi.hoisted so the vi.mock factory
// (hoisted to top of file) can reference them without a TDZ error.
type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};
const h = vi.hoisted(() => {
  const state = {
    lastChild: undefined as unknown as FakeChild,
    spawnArgs: undefined as unknown as { cmd: string; args: readonly string[]; opts: Record<string, unknown> },
  };
  const spawnMock = vi.fn((cmd: string, args: readonly string[], opts: Record<string, unknown>) => {
    state.spawnArgs = { cmd, args, opts };
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.kill = vi.fn();
    state.lastChild = child;
    return child;
  });
  return { state, spawnMock };
});
const spawnMock = h.spawnMock;

vi.mock("node:child_process", () => ({ spawn: h.spawnMock }));

import { POST } from "./route";

// Drain a streaming Response body into a single decoded string.
async function readBody(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out + dec.decode();
}

beforeEach(() => {
  vi.clearAllMocks();
  fs.rmSync(CLI, { force: true });
});

afterAll(() => {
  fs.rmSync(ENGINE, { recursive: true, force: true });
  fs.rmSync(DATA_ROOT, { recursive: true, force: true });
});

describe("POST /api/jobs/refresh", () => {
  it("returns 400 NDJSON error when job-search-cli.mjs is missing (no spawn)", async () => {
    // CLI deliberately absent.
    const res = await POST();
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");
    const body = await res.text();
    expect(JSON.parse(body.trim())).toEqual({
      type: "error",
      message: "job-search-cli.mjs not found in this checkout",
    });
    // It bailed before ever spawning.
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("spawns node against the cli + data root and scopes CAREER_OPS_ROOT to the profile", async () => {
    fs.writeFileSync(CLI, "// stub cli", "utf8");
    const res = await POST();
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(h.state.spawnArgs.cmd).toBe("node");
    expect(h.state.spawnArgs.args).toEqual([CLI, DATA_ROOT]);
    expect(h.state.spawnArgs.opts.cwd).toBe(ENGINE);
    expect((h.state.spawnArgs.opts.env as Record<string, string>).CAREER_OPS_ROOT).toBe(DATA_ROOT);

    // Close out the stream so the test doesn't leave the controller open.
    h.state.lastChild.emit("close");
    await readBody(res);
  });

  it("streams the child's stdout through verbatim as NDJSON", async () => {
    fs.writeFileSync(CLI, "// stub cli", "utf8");
    const res = await POST();
    const bodyPromise = readBody(res);

    // The cli emits NDJSON progress lines; the route forwards them unchanged.
    h.state.lastChild.stdout.emit("data", Buffer.from('{"type":"progress","pct":10}\n'));
    h.state.lastChild.stdout.emit("data", Buffer.from('{"type":"progress","pct":100}\n{"type":"done"}\n'));
    h.state.lastChild.emit("close");

    const body = await bodyPromise;
    const lines = body.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { type: "progress", pct: 10 },
      { type: "progress", pct: 100 },
      { type: "done" },
    ]);
  });

  it("emits a terminal error line and closes when the child errors", async () => {
    fs.writeFileSync(CLI, "// stub cli", "utf8");
    const res = await POST();
    const bodyPromise = readBody(res);

    h.state.lastChild.stdout.emit("data", Buffer.from('{"type":"progress"}\n'));
    h.state.lastChild.emit("error", new Error("spawn ENOENT node"));

    const body = await bodyPromise;
    const lines = body.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toEqual({ type: "progress" });
    expect(lines[1]).toEqual({ type: "error", message: "spawn ENOENT node" });
  });

  it("kills the child with SIGTERM when the response stream is cancelled", async () => {
    fs.writeFileSync(CLI, "// stub cli", "utf8");
    const res = await POST();
    // Cancelling the consumer triggers the stream's cancel() -> child.kill.
    await res.body!.cancel();
    expect(h.state.lastChild.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("does not enqueue stdout received after the stream has closed", async () => {
    fs.writeFileSync(CLI, "// stub cli", "utf8");
    const res = await POST();
    const bodyPromise = readBody(res);

    h.state.lastChild.stdout.emit("data", Buffer.from('{"type":"a"}\n'));
    h.state.lastChild.emit("close"); // closes the controller
    // Late data after close must be dropped, not enqueued.
    h.state.lastChild.stdout.emit("data", Buffer.from('{"type":"late"}\n'));

    const body = await bodyPromise;
    const lines = body.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(lines).toEqual([{ type: "a" }]);
  });
});
