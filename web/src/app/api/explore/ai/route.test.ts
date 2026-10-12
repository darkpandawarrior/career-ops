import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

/**
 * POST /api/explore/ai runs the user's configured CLI headless to PROPOSE job
 * candidates, streaming its reasoning back as plain text. For Claude it parses
 * stream-json NDJSON and emits only the content_block_delta text; for any other
 * CLI it passes stdout through verbatim.
 *
 * We mock the spawn seam (a fake EventEmitter child), resolveCli (so no real
 * binary is probed), the career-ops readers + the dedup-context assembler, and
 * fs.readFileSync (the discover.md mode the route loads at request time). We then
 * drive stdout/stderr/close on the fake child and assert the streamed text.
 */

// A controllable fake ChildProcess: stdout/stderr are EventEmitters, the child
// itself is an EventEmitter for "error"/"close", and kill is a no-op spy.
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

const h = vi.hoisted(() => ({
  lastChild: null as InstanceType<typeof FakeChild> | null,
  lastSpawn: null as { bin: string; args: string[]; opts: Record<string, unknown> } | null,
  spawnMock: vi.fn(),
  // resolveCli return value (null => 404). Default is a generic non-claude CLI.
  resolved: null as { spec: { name: string; args: (p: string) => string[] }; binPath: string } | null,
  // fs.readFileSync(modes/discover.md) — string => mode found, throw => MODE_MISSING.
  mode: "FOLLOW modes/discover.md" as string | null,
  dataRoot: "/fake/data/root",
  dedup: { urls: new Set<string>(), lines: [] as string[] },
  memory: "",
}));

class FakeChildCtor extends FakeChild {}

// route.ts gates cliId "codex" on supportsSafeCodexExec(binPath), which probes
// `codex --help` and `codex exec --help` (via the SAME mocked spawn) before the
// real exec ever runs. Auto-satisfy those two probe spawns with output carrying
// every flag the gate checks for, so every existing codex-flavored test still
// reaches the real exec spawn without having to drive the probes by hand.
const CODEX_GLOBAL_HELP = "--ask-for-approval <policy> --search";
const CODEX_EXEC_HELP =
  "--sandbox read-only --strict-config --ignore-user-config --ephemeral --skip-git-repo-check --output-last-message <file>";

h.spawnMock.mockImplementation((bin: string, args: string[], opts: Record<string, unknown>) => {
  const child = new FakeChildCtor();
  h.lastChild = child;
  h.lastSpawn = { bin, args, opts };
  if (args[0] === "--help") {
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from(CODEX_GLOBAL_HELP));
      child.emit("close");
    });
  } else if (args[0] === "exec" && args[1] === "--help") {
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from(CODEX_EXEC_HELP));
      child.emit("close");
    });
  }
  return child as unknown as ReturnType<typeof import("node:child_process").spawn>;
});

vi.mock("node:child_process", () => ({ spawn: h.spawnMock }));

vi.mock("node:fs", async (importOriginal) => {
  // Real fs for everything else — codex runs need a REAL isolated tmp workspace
  // (mkdtempSync/rmSync under os.tmpdir()), only discover.md and the capability
  // probe's binary stat are faked.
  const actual = await importOriginal<typeof import("node:fs")>();
  const readFileSync = (..._a: unknown[]) => {
    if (h.mode === null) throw new Error("ENOENT modes/discover.md");
    return h.mode;
  };
  // supportsSafeCodexExec stats the binary to key its capability cache; any
  // stable-looking stat is fine, the mtime/size values themselves are unused
  // by the assertions here.
  const statSync = (..._a: unknown[]) => ({ mtimeMs: 1, size: 1 });
  return {
    ...actual,
    default: { ...actual, readFileSync, statSync },
    readFileSync,
    statSync,
  };
});

vi.mock("@/lib/clis", () => ({
  resolveCli: vi.fn(() => h.resolved),
  resolveCliOrFallback: (id: string) => { const r = (h.resolved); return r ? { ...r, spec: { id, ...r.spec }, substitutedFrom: null } : null; },
  cliSubstitutionNotice: () => null,
  cliUnavailableError: (id: string) => ({ error: `CLI '${id}' not found on this machine` }),
}));

vi.mock("@/lib/career-ops", () => ({
  careerOpsRoot: () => "/fake/engine/root",
  readMemory: () => h.memory,
}));

vi.mock("@/lib/profile-registry", () => ({
  requestRoot: vi.fn(async () => h.dataRoot),
}));

vi.mock("@/lib/core/discover", () => ({
  assembleDedupContext: vi.fn(() => h.dedup),
}));

import { POST } from "./route";

// Upstream prefixes a "cannot be permission-restricted" notice for CLIs the fence cannot certify.
const unfenced = (t: string) => t.replace(/^⚠️[^\n]*\n\n/, "");

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/explore/ai", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

/** Emit a Claude stream-json content_block_delta line carrying `text`. */
function claudeDelta(text: string): string {
  return JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { text } } }) + "\n";
}

/** Kick off POST, run the streaming body to completion, and return its text. */
async function collect(req: Request, drive: (child: InstanceType<typeof FakeChild>) => void): Promise<string> {
  const res = await POST(req);
  // For the streaming (200) path the child has been spawned synchronously in the
  // stream's start(); drive it then read the body.
  if (res.status === 200 && h.lastChild) drive(h.lastChild);
  return res.text();
}

beforeEach(() => {
  h.lastChild = null;
  h.lastSpawn = null;
  h.spawnMock.mockClear();
  h.mode = "FOLLOW modes/discover.md exactly.";
  h.dataRoot = "/fake/data/root";
  h.dedup = { urls: new Set<string>(), lines: [] };
  h.memory = "";
  // Default resolved CLI: a generic (non-claude, non-codex) runner whose stdout
  // is passed through verbatim. cliId "codex" now triggers its OWN dedicated
  // safety-gated + isolated-workspace flow (#2361, see the describe block
  // below), so it is no longer a valid stand-in for "any non-claude CLI".
  h.resolved = { spec: { name: "OpenCode", args: (p: string) => ["run", p] }, binPath: "/usr/local/bin/opencode" };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/explore/ai — input validation", () => {
  it("400s on a malformed JSON body", async () => {
    const res = await POST(makeReq("{ not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad json" });
  });

  it("400s when query is missing", async () => {
    const res = await POST(makeReq({ cliId: "codex" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/query and cliId required/);
  });

  it("400s when query is only whitespace", async () => {
    const res = await POST(makeReq({ query: "   ", cliId: "codex" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/query and cliId required/);
  });

  it("400s when cliId is missing", async () => {
    const res = await POST(makeReq({ query: "android lead roles" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/query and cliId required/);
  });

  it("404s when the requested CLI is not resolvable on this machine", async () => {
    h.resolved = null;
    const res = await POST(makeReq({ query: "find me jobs", cliId: "ghost" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not found on this machine/);
  });

  it("400s MODE_MISSING when modes/discover.md cannot be read", async () => {
    h.mode = null; // readFileSync throws
    const res = await POST(makeReq({ query: "find me jobs", cliId: "codex" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("MODE_MISSING");
    expect(body.error).toMatch(/newer career-ops/i);
  });
});

describe("POST /api/explore/ai — streaming (generic CLI)", () => {
  it("passes stdout through verbatim for a non-claude CLI", async () => {
    const text = await collect(makeReq({ query: "android jobs", cliId: "opencode" }), (child) => {
      child.stdout.emit("data", Buffer.from("hunting boards... "));
      child.stdout.emit("data", Buffer.from("found one"));
      child.emit("close");
    });
    expect(unfenced(text)).toBe("hunting boards... found one");
  });

  it("spawns the resolved binary with the spec's args and the prompt, scoped to the data root via env", async () => {
    h.dataRoot = "/profiles/alex";
    await collect(makeReq({ query: "staff android", cliId: "opencode" }), (child) => child.emit("close"));
    expect(h.lastSpawn!.bin).toBe("/usr/local/bin/opencode");
    // spec.args(prompt) => ["run", <prompt>]; the prompt embeds the user intent.
    expect(h.lastSpawn!.args[0]).toBe("run");
    expect(h.lastSpawn!.args[1]).toContain("staff android");
    const env = h.lastSpawn!.opts.env as Record<string, string>;
    expect(env.CAREER_OPS_ROOT).toBe("/profiles/alex");
    expect(h.lastSpawn!.opts.cwd).toBe("/fake/engine/root");
  });

  it("emits the no-output placeholder when the child closes having produced nothing", async () => {
    const text = await collect(makeReq({ query: "x", cliId: "opencode" }), (child) => child.emit("close"));
    expect(unfenced(text)).toBe("_(no output — is the CLI authenticated?)_");
  });

  it("surfaces stderr lines that look like errors, prefixed with the CLI name", async () => {
    const text = await collect(makeReq({ query: "x", cliId: "opencode" }), (child) => {
      child.stderr.emit("data", Buffer.from("fatal: not authenticated\n"));
      child.emit("close");
    });
    expect(text).toContain("[OpenCode] fatal: not authenticated");
  });

  it("ignores benign stderr noise (no error keyword)", async () => {
    const text = await collect(makeReq({ query: "x", cliId: "opencode" }), (child) => {
      child.stderr.emit("data", Buffer.from("loading model weights\n"));
      child.stdout.emit("data", Buffer.from("ok"));
      child.emit("close");
    });
    expect(unfenced(text)).toBe("ok");
    expect(text).not.toContain("loading model weights");
  });

  it("emits a launch-error notice when the child errors before output", async () => {
    const text = await collect(makeReq({ query: "x", cliId: "opencode" }), (child) => {
      child.emit("error", new Error("spawn ENOENT"));
    });
    expect(text).toContain("error launching OpenCode: spawn ENOENT");
  });
});

describe("POST /api/explore/ai — codex-specific safety (#2361)", () => {
  beforeEach(() => {
    h.resolved = { spec: { name: "Codex", args: (p: string) => ["exec", p] }, binPath: "/usr/local/bin/codex" };
  });

  it("400s CODEX_UNSUPPORTED, without ever running the real exec, when the installed codex is missing a required read-only flag", async () => {
    // Override the module-default auto-satisfying probe stub for this test only:
    // the exec-help probe answers WITHOUT --sandbox read-only, which must fail
    // closed rather than fall back to a weaker invocation.
    const defaultImpl = h.spawnMock.getMockImplementation()!;
    h.spawnMock.mockImplementation((bin: string, args: string[], opts: Record<string, unknown>) => {
      const child = new FakeChildCtor();
      h.lastChild = child;
      h.lastSpawn = { bin, args, opts };
      if (args[0] === "--help") {
        queueMicrotask(() => {
          child.stdout.emit("data", Buffer.from(CODEX_GLOBAL_HELP));
          child.emit("close");
        });
      } else if (args[0] === "exec" && args[1] === "--help") {
        queueMicrotask(() => {
          child.stdout.emit("data", Buffer.from("--strict-config --ignore-user-config")); // no --sandbox read-only
          child.emit("close");
        });
      }
      return child as unknown as ReturnType<typeof import("node:child_process").spawn>;
    });

    const res = await POST(makeReq({ query: "x", cliId: "codex" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("CODEX_UNSUPPORTED");
    // Only the two --help probes ran — the real (unsafe) exec never spawned.
    expect(h.spawnMock).toHaveBeenCalledTimes(2);

    h.spawnMock.mockImplementation(defaultImpl);
  });
});

describe("POST /api/explore/ai — cancel() safety (#1155)", () => {
  it("does not throw when the child emits data/close after the client disconnects", async () => {
    const res = await POST(makeReq({ query: "x", cliId: "opencode" }));
    const child = h.lastChild!; // start() already ran synchronously during POST
    const reader = res.body!.getReader();
    await reader.cancel(); // simulates a client disconnect → cancel()
    expect(() => {
      child.stdout.emit("data", Buffer.from("late text"));
      child.emit("close");
    }).not.toThrow();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("POST /api/explore/ai — streaming (claude stream-json)", () => {
  beforeEach(() => {
    // Claude path is keyed off cliId === "claude".
    h.resolved = { spec: { name: "Claude Code", args: (p: string) => ["-p", p] }, binPath: "/usr/local/bin/claude" };
  });

  it("parses stream-json deltas and emits only the assistant text", async () => {
    const text = await collect(makeReq({ query: "android lead", cliId: "claude" }), (child) => {
      child.stdout.emit("data", Buffer.from(claudeDelta("Searching ")));
      child.stdout.emit("data", Buffer.from(claudeDelta("Greenhouse...")));
      child.emit("close");
    });
    expect(unfenced(text)).toBe("Searching Greenhouse...");
  });

  it("reassembles a stream-json line split across stdout chunks", async () => {
    const line = claudeDelta("split across chunks");
    const mid = Math.floor(line.length / 2);
    const text = await collect(makeReq({ query: "x", cliId: "claude" }), (child) => {
      child.stdout.emit("data", Buffer.from(line.slice(0, mid)));
      child.stdout.emit("data", Buffer.from(line.slice(mid)));
      child.emit("close");
    });
    expect(unfenced(text)).toBe("split across chunks");
  });

  it("ignores non-delta stream-json events and malformed lines", async () => {
    const text = await collect(makeReq({ query: "x", cliId: "claude" }), (child) => {
      child.stdout.emit("data", Buffer.from(JSON.stringify({ type: "stream_event", event: { type: "message_start" } }) + "\n"));
      child.stdout.emit("data", Buffer.from("this is not json\n"));
      child.stdout.emit("data", Buffer.from(claudeDelta("real text")));
      child.emit("close");
    });
    expect(unfenced(text)).toBe("real text");
  });

  it("uses the claude-specific arg set (stream-json + read-only proposer tools), not spec.args", async () => {
    await collect(makeReq({ query: "x", cliId: "claude" }), (child) => child.emit("close"));
    const args = h.lastSpawn!.args;
    expect(args).toContain("--output-format");
    expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json");
    expect(args).toContain("--allowedTools");
    expect(args[args.indexOf("--allowedTools") + 1]).toContain("WebSearch");
    // Proposer-not-writer: Write/Edit/Bash are disabled by construction.
    expect(args[args.indexOf("--disallowedTools") + 1]).toMatch(/Write/);
  });
});

describe("POST /api/explore/ai — prompt assembly", () => {
  it("threads persistent memory + the dedup 'already known' block into the prompt", async () => {
    h.memory = "Prefers fully-remote Android lead roles.";
    h.dedup = {
      urls: new Set(["https://x.test/a"]),
      lines: ["Companies already in the user's pipeline: Acme, Beta."],
    };
    await collect(makeReq({ query: "remote android", cliId: "opencode" }), (child) => child.emit("close"));
    const prompt = h.lastSpawn!.args[1];
    expect(prompt).toContain("Prefers fully-remote Android lead roles.");
    expect(prompt).toContain("Acme, Beta");
    expect(prompt).toContain("ALREADY KNOWN");
    expect(prompt).toContain("remote android");
  });
});
