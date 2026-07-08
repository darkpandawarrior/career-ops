import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

/**
 * /api/assistant spawns the chosen AI CLI headless and streams its reply back as
 * plain text. For the "claude" cli it parses the stream-json NDJSON stdout and
 * emits ONLY the assistant text deltas (content_block_delta.delta.text). For any
 * other cli it passes stdout through raw.
 *
 * We mock spawn to return a controllable FakeChild (stdout/stderr EventEmitters +
 * a .kill() spy), so no real process runs. resolveCli is mocked to a fake
 * {spec,binPath}; requestRoot → a tmp data root; careerOpsRoot/readMemory are
 * stubbed so nothing touches the user's real profile data. We then assert the
 * 400/404 guard responses and the exact streamed text the route emits.
 */

// A controllable fake ChildProcess: stdout/stderr are EventEmitters, the child
// itself is an EventEmitter for "error"/"close", and kill is a no-op spy.
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

// Hoisted holder so the (hoisted) vi.mock factories can reference it.
const h = vi.hoisted(() => ({
  lastChild: null as InstanceType<typeof FakeChild> | null,
  lastSpawnArgs: null as { cmd: string; args: string[]; opts: Record<string, unknown> } | null,
  spawnMock: vi.fn(),
  // resolveCli returns this; set to null to simulate an unknown/uninstalled cli.
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
  careerOpsRoot: () => "/fake/engine/root",
  readMemory: vi.fn(() => h.memory),
  doctorState: vi.fn(() => ({ phase: "established", onboardingNeeded: false, missing: [], hasCv: true, hasData: true })),
}));

vi.mock("@/lib/profile-registry", () => ({
  requestRoot: vi.fn(async () => "/fake/data/root"),
}));

import { POST } from "./route";

// A passing resolveCli result for the "claude" path (stream-json parsing).
function fakeResolved(name = "Claude Code") {
  return { spec: { name, args: (p: string) => [p] }, binPath: "/usr/local/bin/claude" };
}

// One stream-json line carrying an assistant text delta.
function delta(text: string): string {
  return JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { text } } }) + "\n";
}

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// Drain a Response's ReadableStream<Uint8Array> body into a single string.
async function readBody(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  out += dec.decode();
  return out;
}

/**
 * POST then drive the spawned fake child through a script of stdout/stderr chunks
 * and a close. The route registers its child handlers synchronously inside the
 * ReadableStream start(), which runs when the body is first read — so we kick off
 * readBody() first, let the microtask queue register the handlers, then emit.
 */
async function run(
  body: unknown,
  script: (child: InstanceType<typeof FakeChild>) => void,
): Promise<{ res: Response; text: string }> {
  const res = await POST(makeReq(body));
  const readPromise = readBody(res);
  // Let start() run and register child.stdout/stderr/close handlers.
  await Promise.resolve();
  await Promise.resolve();
  script(h.lastChild!);
  const text = await readPromise;
  return { res, text };
}

beforeEach(() => {
  h.lastChild = null;
  h.lastSpawnArgs = null;
  h.resolved = fakeResolved();
  h.memory = "";
  h.spawnMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.clearAllTimers();
});

describe("POST /api/assistant — request validation", () => {
  it("returns 400 when the body is not valid JSON", async () => {
    const res = await POST(makeReq("{ not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad json" });
  });

  it("returns 400 when message is missing", async () => {
    const res = await POST(makeReq({ cliId: "claude" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "message and cliId required" });
  });

  it("returns 400 when cliId is missing", async () => {
    const res = await POST(makeReq({ message: "hi" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "message and cliId required" });
  });

  it("returns 400 when message is an empty string (falsy)", async () => {
    const res = await POST(makeReq({ message: "", cliId: "claude" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "message and cliId required" });
  });

  it("does not spawn a child when validation fails", async () => {
    await POST(makeReq({ message: "hi" }));
    expect(h.spawnMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/assistant — unknown cli", () => {
  it("returns 404 with a not-found message when resolveCli yields null", async () => {
    h.resolved = null;
    const res = await POST(makeReq({ message: "hi", cliId: "bogus" }));
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ error: "CLI 'bogus' not found on this machine" });
  });

  it("does not spawn a child for an unknown cli", async () => {
    h.resolved = null;
    await POST(makeReq({ message: "hi", cliId: "bogus" }));
    expect(h.spawnMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/assistant — claude stream-json parsing", () => {
  it("streams assistant text deltas parsed from the NDJSON stdout", async () => {
    const { res, text } = await run({ message: "hello", cliId: "claude" }, (child) => {
      child.stdout.emit("data", Buffer.from(delta("Hello") + delta(", world")));
      child.emit("close");
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(text).toBe("Hello, world");
  });

  it("reassembles a delta record split across stdout chunks (line buffering)", async () => {
    const line = delta("buffered");
    const cut = Math.floor(line.length / 2);
    const { text } = await run({ message: "hi", cliId: "claude" }, (child) => {
      child.stdout.emit("data", Buffer.from(line.slice(0, cut)));
      child.stdout.emit("data", Buffer.from(line.slice(cut)));
      child.emit("close");
    });
    expect(text).toBe("buffered");
  });

  it("ignores non-delta stream-json events (tool_use, init) and partial/non-json lines", async () => {
    const toolUse =
      JSON.stringify({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Read" } } }) + "\n";
    const init = JSON.stringify({ type: "system", subtype: "init" }) + "\n";
    const { text } = await run({ message: "hi", cliId: "claude" }, (child) => {
      child.stdout.emit("data", Buffer.from(init + "not json at all\n" + toolUse + delta("only text")));
      child.emit("close");
    });
    expect(text).toBe("only text");
  });

  it("emits the no-output placeholder when the child closes without any text delta", async () => {
    const { text } = await run({ message: "hi", cliId: "claude" }, (child) => {
      child.emit("close");
    });
    expect(text).toBe("_(no output — is the CLI authenticated?)_");
  });

  it("surfaces stderr lines that look like errors, prefixed with the cli name", async () => {
    const { text } = await run({ message: "hi", cliId: "claude" }, (child) => {
      child.stdout.emit("data", Buffer.from(delta("partial")));
      child.stderr.emit("data", Buffer.from("Error: not authenticated\n"));
      child.emit("close");
    });
    expect(text).toContain("partial");
    expect(text).toContain("[Claude Code] Error: not authenticated");
  });

  it("ignores benign (non-error) stderr noise", async () => {
    const { text } = await run({ message: "hi", cliId: "claude" }, (child) => {
      child.stdout.emit("data", Buffer.from(delta("hi")));
      child.stderr.emit("data", Buffer.from("loading model weights...\n"));
      child.emit("close");
    });
    expect(text).toBe("hi");
  });

  it("emits a launch error message and closes when the child errors", async () => {
    const { text } = await run({ message: "hi", cliId: "claude" }, (child) => {
      child.emit("error", new Error("ENOENT spawn claude"));
    });
    expect(text).toBe("\n[error launching Claude Code: ENOENT spawn claude]");
  });
});

describe("POST /api/assistant — non-claude raw passthrough", () => {
  it("passes raw stdout through unchanged for a non-claude cli", async () => {
    h.resolved = fakeResolved("Gemini CLI");
    const { text } = await run({ message: "hi", cliId: "gemini" }, (child) => {
      child.stdout.emit("data", Buffer.from("raw line one\n"));
      child.stdout.emit("data", Buffer.from("raw line two"));
      child.emit("close");
    });
    expect(text).toBe("raw line one\nraw line two");
  });
});

describe("POST /api/assistant — cancel() safety (#1155)", () => {
  it("does not throw when the child emits data/close after the client disconnects", async () => {
    const res = await POST(makeReq({ message: "hi", cliId: "claude" }));
    const child = h.lastChild!; // start() already ran synchronously during POST
    const reader = res.body!.getReader();
    await reader.cancel(); // simulates a client disconnect → cancel()
    expect(() => {
      child.stdout.emit("data", Buffer.from(delta("late text")));
      child.emit("close");
    }).not.toThrow();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("POST /api/assistant — spawn wiring", () => {
  it("spawns the claude binary with stream-json + read-only tool guardrails and the data root env", async () => {
    await run({ message: "hello there", cliId: "claude" }, (child) => child.emit("close"));
    const { cmd, args, opts } = h.lastSpawnArgs!;
    expect(cmd).toBe("/usr/local/bin/claude");
    expect(args).toContain("--output-format");
    expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("Read,WebFetch,Glob,Grep");
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe("Bash,Write,Edit,NotebookEdit,Task");
    // The prompt is the first -p arg and carries the user's message.
    expect(args[args.indexOf("-p") + 1]).toContain("hello there");
    const env = opts.env as Record<string, string>;
    expect(env.CAREER_OPS_ROOT).toBe("/fake/data/root");
    expect(opts.cwd).toBe("/fake/engine/root");
  });

  it("uses the spec's args (not the claude flags) for a non-claude cli", async () => {
    h.resolved = fakeResolved("Gemini CLI");
    await run({ message: "scoped prompt", cliId: "gemini" }, (child) => child.emit("close"));
    const { args } = h.lastSpawnArgs!;
    // spec.args(prompt) → [prompt]; no claude stream-json flags.
    expect(args).not.toContain("--output-format");
    expect(args).toHaveLength(1);
    expect(args[0]).toContain("scoped prompt");
  });

  it("injects persistent memory into the prompt when present", async () => {
    h.memory = "Prefers Lead-level depth.";
    await run({ message: "hi", cliId: "claude" }, (child) => child.emit("close"));
    const { args } = h.lastSpawnArgs!;
    expect(args[args.indexOf("-p") + 1]).toContain("Prefers Lead-level depth.");
  });
});
