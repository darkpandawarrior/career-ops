import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * /api/run ORCHESTRATES the real career-ops engine: it spawns the chosen AI CLI
 * headless with a kind-specific prompt and streams progress back as NDJSON events
 * ({type:"text"|"tool"|"status"|"done"|"error"}). For the "claude" cli it parses
 * the stream-json stdout; other CLIs are wrapped raw as {type:"text"}.
 *
 * Guards (all 400/404 JSON before streaming):
 *   - bad json / missing input|cliId           → 400
 *   - unknown cli (resolveCli null)             → 404
 *   - kind needs a full checkout (oferta.md …)  → 400 when the script is absent
 *   - evaluate/pdf need cv.md                   → 400 when cv.md is absent
 *
 * We use a REAL tmp root on disk (requestRoot mocked to it) so the fs.existsSync
 * gates run for real, and a FakeChild (spawn mocked) to drive the stream. No real
 * process spawns, no user data touched.
 */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-run-route-"));

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

const h = vi.hoisted(() => ({
  lastChild: null as InstanceType<typeof FakeChild> | null,
  lastSpawnArgs: null as { cmd: string; args: string[]; opts: Record<string, unknown> } | null,
  spawnMock: vi.fn(),
  resolved: null as { spec: { name: string; args: (p: string) => string[] }; binPath: string } | null,
  memory: "" as string,
}));

h.spawnMock.mockImplementation((cmd: string, args: string[], opts: Record<string, unknown>) => {
  h.lastChild = new FakeChild();
  h.lastSpawnArgs = { cmd, args, opts };
  return h.lastChild as unknown as ReturnType<typeof import("node:child_process").spawn>;
});

vi.mock("node:child_process", () => ({ spawn: h.spawnMock }));

vi.mock("@/lib/clis", () => ({
  resolveCli: vi.fn((id: string) => h.resolved),
}));

vi.mock("@/lib/career-ops", () => ({
  readMemory: vi.fn(() => h.memory),
}));

vi.mock("@/lib/profile-registry", () => ({
  requestRoot: vi.fn(async () => ROOT),
}));

import { POST } from "./route";

function fakeResolved(name = "Claude Code") {
  return { spec: { name, args: (p: string) => [p] }, binPath: "/usr/local/bin/claude" };
}

function delta(text: string): string {
  return JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { text } } }) + "\n";
}

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/run", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// Drain a Response stream body and parse each NDJSON line into an event object.
async function readEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  buf += dec.decode();
  return buf
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function run(
  body: unknown,
  script: (child: InstanceType<typeof FakeChild>) => void,
): Promise<{ res: Response; events: Array<Record<string, unknown>> }> {
  const res = await POST(makeReq(body));
  const readPromise = readEvents(res);
  await Promise.resolve();
  await Promise.resolve();
  script(h.lastChild!);
  const events = await readPromise;
  return { res, events };
}

// Create / clear the on-disk gate files (full-checkout scripts + cv.md).
function setupFullCheckout() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(ROOT, "modes"), { recursive: true });
  fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "modes", "oferta.md"), "# oferta mode\n");
  fs.writeFileSync(path.join(ROOT, "verify-portals.mjs"), "// fake\n");
  fs.writeFileSync(path.join(ROOT, "generate-pdf.mjs"), "// fake\n");
  fs.writeFileSync(path.join(ROOT, "cv.md"), "# CV\n");
}

beforeEach(() => {
  h.lastChild = null;
  h.lastSpawnArgs = null;
  h.resolved = fakeResolved();
  h.memory = "";
  h.spawnMock.mockClear();
  setupFullCheckout();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.clearAllTimers();
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("POST /api/run — request validation", () => {
  it("returns 400 when the body is not valid JSON", async () => {
    const res = await POST(makeReq("{ not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad json" });
  });

  it("returns 400 when input is missing", async () => {
    const res = await POST(makeReq({ cliId: "claude" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "input and cliId required" });
  });

  it("returns 400 when cliId is missing", async () => {
    const res = await POST(makeReq({ input: "https://x.test/job" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "input and cliId required" });
  });

  it("does not spawn a child when validation fails", async () => {
    await POST(makeReq({ cliId: "claude" }));
    expect(h.spawnMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/run — unknown cli", () => {
  it("returns 404 when resolveCli yields null", async () => {
    h.resolved = null;
    const res = await POST(makeReq({ input: "https://x.test/job", cliId: "bogus" }));
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ error: "CLI 'bogus' not found" });
  });
});

describe("POST /api/run — checkout / prerequisite gates", () => {
  it("returns 400 when an evaluate run lacks a full checkout (modes/oferta.md absent)", async () => {
    fs.rmSync(path.join(ROOT, "modes", "oferta.md"), { force: true });
    const res = await POST(makeReq({ kind: "evaluate", input: "https://x.test/job", cliId: "claude" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("modes/oferta.md");
  });

  it("returns 400 when a fix-portal run lacks verify-portals.mjs", async () => {
    fs.rmSync(path.join(ROOT, "verify-portals.mjs"), { force: true });
    const res = await POST(makeReq({ kind: "fix-portal", input: "Acme", cliId: "claude" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("verify-portals.mjs");
  });

  it("returns 400 when an evaluate run has no cv.md to score against", async () => {
    fs.rmSync(path.join(ROOT, "cv.md"), { force: true });
    const res = await POST(makeReq({ kind: "evaluate", input: "https://x.test/job", cliId: "claude" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Add your CV first");
  });

  it("returns 400 when a pdf run has no cv.md", async () => {
    fs.rmSync(path.join(ROOT, "cv.md"), { force: true });
    const res = await POST(makeReq({ kind: "pdf", input: "42", cliId: "claude" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Add your CV first");
  });

  it("allows a research run with no checkout scripts and no cv.md (read-only, no gates)", async () => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.mkdirSync(ROOT, { recursive: true });
    const { res, events } = await run({ kind: "research", input: "my portfolio", cliId: "claude" }, (child) => {
      child.stdout.emit("data", Buffer.from(delta("looks strong")));
      child.emit("close");
    });
    expect(res.status).toBe(200);
    expect(events).toContainEqual({ type: "text", text: "looks strong" });
  });
});

describe("POST /api/run — claude stream-json → NDJSON events", () => {
  it("maps content_block_delta text into {type:'text'} events", async () => {
    const { res, events } = await run({ kind: "research", input: "https://x.test/job", cliId: "claude" }, (child) => {
      child.stdout.emit("data", Buffer.from(delta("Hello") + delta(" world")));
      child.emit("close");
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(events).toContainEqual({ type: "text", text: "Hello" });
    expect(events).toContainEqual({ type: "text", text: " world" });
  });

  it("maps a tool_use content_block_start into a {type:'tool'} event", async () => {
    const toolStart =
      JSON.stringify({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "WebFetch" } } }) + "\n";
    const { events } = await run({ kind: "research", input: "x", cliId: "claude" }, (child) => {
      child.stdout.emit("data", Buffer.from(toolStart + delta("done")));
      child.emit("close");
    });
    expect(events).toContainEqual({ type: "tool", name: "WebFetch" });
  });

  it("maps a system/init event into {type:'status'} and a result event into {type:'done'}", async () => {
    const initLine = JSON.stringify({ type: "system", subtype: "init" }) + "\n";
    const resultLine = JSON.stringify({ type: "result" }) + "\n";
    const { events } = await run({ kind: "research", input: "x", cliId: "claude" }, (child) => {
      child.stdout.emit("data", Buffer.from(initLine + delta("hi") + resultLine));
      child.emit("close");
    });
    expect(events).toContainEqual({ type: "status", label: "Agent ready" });
    expect(events).toContainEqual({ type: "done" });
  });

  it("reassembles a delta record split across stdout chunks", async () => {
    const line = delta("buffered text");
    const cut = Math.floor(line.length / 2);
    const { events } = await run({ kind: "research", input: "x", cliId: "claude" }, (child) => {
      child.stdout.emit("data", Buffer.from(line.slice(0, cut)));
      child.stdout.emit("data", Buffer.from(line.slice(cut)));
      child.emit("close");
    });
    expect(events).toContainEqual({ type: "text", text: "buffered text" });
  });
});

describe("POST /api/run — stderr / close honesty", () => {
  it("emits {type:'error'} for an auth-shaped stderr line", async () => {
    const { events } = await run({ kind: "research", input: "x", cliId: "claude" }, (child) => {
      child.stderr.emit("data", Buffer.from("Error: not authenticated — run login\n"));
      child.stdout.emit("data", Buffer.from(delta("partial")));
      child.emit("close");
    });
    const err = events.find((e) => e.type === "error");
    expect(err).toBeTruthy();
    expect(String(err!.msg)).toContain("not authenticated");
  });

  it("reports a no-output error when the child closes without any text delta", async () => {
    const { events } = await run({ kind: "research", input: "x", cliId: "claude" }, (child) => {
      child.emit("close", 0);
    });
    const err = events.find((e) => e.type === "error");
    expect(err).toBeTruthy();
    expect(String(err!.msg)).toContain("no output");
  });

  it("reports a non-zero exit as an error when no stderr error was seen", async () => {
    const { events } = await run({ kind: "research", input: "x", cliId: "claude" }, (child) => {
      child.emit("close", 1);
    });
    const err = events.find((e) => e.type === "error");
    expect(err).toBeTruthy();
    expect(String(err!.msg)).toContain("exited with an error");
  });

  it("emits a launch error and closes when the child errors", async () => {
    const { events } = await run({ kind: "research", input: "x", cliId: "claude" }, (child) => {
      child.emit("error", new Error("ENOENT spawn claude"));
    });
    expect(events).toContainEqual({ type: "error", msg: "ENOENT spawn claude" });
  });
});

describe("POST /api/run — evaluate persistence honesty", () => {
  it("emits the 'didn't save a report' error when an evaluate run produced text but wrote no new report", async () => {
    // reports/ starts empty (setupFullCheckout makes the dir but no .md). The
    // worker emits text but never writes a report → countReports stays equal.
    const { events } = await run({ kind: "evaluate", input: "https://x.test/job", cliId: "claude" }, (child) => {
      child.stdout.emit("data", Buffer.from(delta("VERDICT: 4/5 — strong fit")));
      child.emit("close", 0);
    });
    const err = events.find((e) => e.type === "error");
    expect(err).toBeTruthy();
    expect(String(err!.msg)).toContain("didn't save a report");
  });

  it("emits {type:'done'} when an evaluate run actually writes a new report file", async () => {
    const { events } = await run({ kind: "evaluate", input: "https://x.test/job", cliId: "claude" }, (child) => {
      child.stdout.emit("data", Buffer.from(delta("scoring...")));
      // Simulate the worker persisting a canonical report before close.
      fs.writeFileSync(path.join(ROOT, "reports", "035-acme-2026-06-30.md"), "# report\n");
      child.emit("close", 0);
    });
    expect(events).toContainEqual({ type: "done" });
    expect(events.some((e) => e.type === "error")).toBe(false);
  });
});

describe("POST /api/run — non-claude raw passthrough", () => {
  it("wraps raw stdout as {type:'text'} for a non-claude cli", async () => {
    h.resolved = fakeResolved("Gemini CLI");
    const { events } = await run({ kind: "research", input: "x", cliId: "gemini" }, (child) => {
      child.stdout.emit("data", Buffer.from("raw output chunk"));
      child.emit("close", 0);
    });
    expect(events).toContainEqual({ type: "text", text: "raw output chunk" });
  });
});

describe("POST /api/run — cancel() safety (#1155)", () => {
  it("does not throw when the child emits data/close after the client disconnects", async () => {
    const res = await POST(makeReq({ kind: "research", input: "x", cliId: "claude" }));
    const child = h.lastChild!; // start() already ran synchronously during POST
    const reader = res.body!.getReader();
    await reader.cancel(); // simulates a client disconnect → cancel()
    // Late events after cancel() must not throw "Controller is already closed".
    expect(() => {
      child.stdout.emit("data", Buffer.from(delta("late text")));
      child.emit("close", 0);
    }).not.toThrow();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("POST /api/run — spawn wiring", () => {
  it("spawns claude with write-capable tools + the data root for an evaluate run", async () => {
    await run({ kind: "evaluate", input: "https://x.test/job", cliId: "claude" }, (child) => {
      fs.writeFileSync(path.join(ROOT, "reports", "036-x-2026-06-30.md"), "# r\n");
      child.stdout.emit("data", Buffer.from(delta("x")));
      child.emit("close", 0);
    });
    const { cmd, args, opts } = h.lastSpawnArgs!;
    expect(cmd).toBe("/usr/local/bin/claude");
    expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json");
    // evaluate gets Write + Bash; Task is always blocked.
    expect(args[args.indexOf("--allowedTools") + 1]).toContain("Write");
    expect(args[args.indexOf("--allowedTools") + 1]).toContain("Bash");
    expect(args[args.indexOf("--disallowedTools") + 1]).toContain("Task");
    expect(args[args.indexOf("-p") + 1]).toContain("https://x.test/job");
    const env = opts.env as Record<string, string>;
    expect(env.CAREER_OPS_ROOT).toBe(ROOT);
    expect(opts.cwd).toBe(ROOT);
  });

  it("scopes a research run to read-only tools (no Write/Bash)", async () => {
    await run({ kind: "research", input: "x", cliId: "claude" }, (child) => child.emit("close", 0));
    const { args } = h.lastSpawnArgs!;
    const allowed = args[args.indexOf("--allowedTools") + 1];
    expect(allowed).not.toContain("Write");
    expect(args[args.indexOf("--disallowedTools") + 1]).toContain("Bash");
  });

  it("uses the spec's args (no claude flags) for a non-claude cli", async () => {
    h.resolved = fakeResolved("Gemini CLI");
    await run({ kind: "research", input: "scoped prompt", cliId: "gemini" }, (child) => child.emit("close", 0));
    const { args } = h.lastSpawnArgs!;
    expect(args).not.toContain("--output-format");
    expect(args).toHaveLength(1);
    expect(args[0]).toContain("scoped prompt");
  });
});
