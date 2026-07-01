import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * POST /api/portfolio/generate. The route:
 *   1. validates cliId, resolves the CLI, reads modes/portfolio.md (ENGINE root)
 *   2. reads cv.md/profile.yml from the active profile root (NO_CV guard)
 *   3. spawns the user's CLI headless, streams stream-json deltas, accumulates the
 *      assistant text, extracts+coerces JSON, persists the draft, emits {kind:"done"}
 *
 * We mock every external seam — careerOpsRoot (engine, holds modes/), requestRoot
 * (data root, holds cv.md + receives the draft), resolveCli (fake bin), and
 * node:child_process spawn (a controllable fake child). writePortfolio/render/
 * schema run for real so we assert the real persisted artifact. Fully hermetic.
 */

// ── tmp roots ───────────────────────────────────────────────────────────────
const ENGINE = fs.mkdtempSync(path.join(os.tmpdir(), "co-gen-engine-"));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "co-gen-data-"));
fs.mkdirSync(path.join(ENGINE, "modes"), { recursive: true });
fs.writeFileSync(path.join(ENGINE, "modes", "portfolio.md"), "PORTFOLIO MODE INSTRUCTIONS", "utf8");

// ── fake child process ────────────────────────────────────────────────────────
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

const h = vi.hoisted(() => ({
  lastChild: null as InstanceType<typeof EventEmitter> | null,
  lastSpawn: null as { cmd: string; args: string[]; opts: Record<string, unknown> } | null,
  spawnMock: vi.fn(),
  resolveMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: h.spawnMock }));
vi.mock("@/lib/career-ops", () => ({ careerOpsRoot: () => ENGINE }));
vi.mock("@/lib/profile-registry", () => ({ requestRoot: vi.fn(async () => DATA) }));
vi.mock("@/lib/clis", () => ({ resolveCli: h.resolveMock }));

import { POST } from "./route";
import { readPortfolio } from "@/lib/portfolio/context";

// ── helpers ───────────────────────────────────────────────────────────────────

// A fresh fake child captured into h.lastChild whenever the route spawns.
function installSpawn(): void {
  h.spawnMock.mockImplementation((cmd: string, args: string[], opts: Record<string, unknown>) => {
    const child = new FakeChild();
    h.lastChild = child;
    h.lastSpawn = { cmd, args, opts };
    return child as unknown as ReturnType<typeof import("node:child_process").spawn>;
  });
}

// Default: a resolvable, non-claude CLI (raw stdout accumulation path).
function installResolve(id = "gemini"): void {
  h.resolveMock.mockReturnValue({
    spec: { name: "Gemini CLI", args: (p: string) => ["-p", p] },
    binPath: "/fake/bin/" + id,
  });
}

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/portfolio/generate", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// Build a claude stream-json line carrying a text delta.
function claudeDelta(text: string): string {
  return JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { text } } }) + "\n";
}

// Drain an NDJSON ReadableStream body into an array of parsed objects.
async function drainNdjson(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

// Kick the POST, wait for the child to be spawned, run a feed script against it,
// then collect the streamed NDJSON events.
async function run(
  body: unknown,
  feed: (child: InstanceType<typeof FakeChild>) => void,
): Promise<Array<Record<string, unknown>>> {
  const resP = POST(makeReq(body));
  // The route awaits req.json() + requestRoot() before spawning; yield until the
  // fake child exists.
  for (let i = 0; i < 50 && !h.lastChild; i++) await Promise.resolve();
  const child = h.lastChild as unknown as InstanceType<typeof FakeChild>;
  feed(child);
  const res = await resP;
  return drainNdjson(res);
}

beforeEach(() => {
  h.lastChild = null;
  h.lastSpawn = null;
  h.spawnMock.mockReset();
  h.resolveMock.mockReset();
  installSpawn();
  installResolve();
  // Seed cv.md so the NO_CV guard passes; clear any prior draft.
  fs.writeFileSync(path.join(DATA, "cv.md"), "# Ada Lovelace\nSenior Engineer\n", "utf8");
  fs.mkdirSync(path.join(DATA, "config"), { recursive: true });
  fs.writeFileSync(path.join(DATA, "config", "profile.yml"), "name: Ada\n", "utf8");
  fs.rmSync(path.join(DATA, ".career-ops-web"), { recursive: true, force: true });
});

afterEach(() => {
  vi.clearAllTimers();
});

afterAll(() => {
  fs.rmSync(ENGINE, { recursive: true, force: true });
  fs.rmSync(DATA, { recursive: true, force: true });
});

// ── validation guards (return BEFORE spawning) ─────────────────────────────────
describe("POST /api/portfolio/generate — request validation", () => {
  it("400 'bad json' on a malformed body", async () => {
    const res = await POST(makeReq("{ not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad json" });
    expect(h.spawnMock).not.toHaveBeenCalled();
  });

  it("400 'cliId required' when cliId is missing", async () => {
    const res = await POST(makeReq({ instruction: "x" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "cliId required" });
    expect(h.spawnMock).not.toHaveBeenCalled();
  });

  it("404 when the CLI cannot be resolved (not installed)", async () => {
    h.resolveMock.mockReturnValue(null);
    const res = await POST(makeReq({ cliId: "ghost" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not found/i);
    expect(h.spawnMock).not.toHaveBeenCalled();
  });

  it("400 NO_CV when cv.md is empty/absent in the data root", async () => {
    fs.writeFileSync(path.join(DATA, "cv.md"), "   \n", "utf8"); // whitespace → trim() empty
    const res = await POST(makeReq({ cliId: "gemini" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("NO_CV");
    expect(h.spawnMock).not.toHaveBeenCalled();
  });

  it("400 MODE_MISSING when modes/portfolio.md is absent from the engine root", async () => {
    const modePath = path.join(ENGINE, "modes", "portfolio.md");
    const saved = fs.readFileSync(modePath, "utf8");
    fs.rmSync(modePath);
    try {
      const res = await POST(makeReq({ cliId: "gemini" }));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("MODE_MISSING");
      expect(h.spawnMock).not.toHaveBeenCalled();
    } finally {
      fs.writeFileSync(modePath, saved, "utf8"); // restore for other tests
    }
  });
});

// ── happy path (non-claude: raw stdout accumulation) ──────────────────────────
describe("POST /api/portfolio/generate — non-claude happy path", () => {
  it("streams a status then a {kind:'done'} with data + html, and persists the draft", async () => {
    const portfolio = {
      name: "Ada Lovelace",
      title: "Senior Engineer",
      tagline: "Builds reliable things",
      metrics: [{ value: "10x", label: "throughput" }],
    };
    const events = await run({ cliId: "gemini" }, (child) => {
      // A chatty CLI: prose, then a fenced JSON block, then close.
      child.stdout.emit("data", Buffer.from("Sure! Here is your portfolio:\n```json\n"));
      child.stdout.emit("data", Buffer.from(JSON.stringify(portfolio)));
      child.stdout.emit("data", Buffer.from("\n```\nDone.\n"));
      child.emit("close");
    });

    const done = events.find((e) => e.kind === "done");
    expect(done).toBeTruthy();
    expect((done!.data as Record<string, unknown>).name).toBe("Ada Lovelace");
    expect(typeof done!.html).toBe("string");
    expect(done!.html as string).toContain("Ada Lovelace");
    expect(events.some((e) => e.kind === "error")).toBe(false);

    // The draft was persisted to the DATA root via the real writePortfolio.
    const state = readPortfolio(DATA);
    expect(state.exists).toBe(true);
    expect(state.data!.name).toBe("Ada Lovelace");
    expect(state.html).toContain("Ada Lovelace");
  });

  it("spawns the resolved bin with cwd=engine root and CAREER_OPS_ROOT=data root", async () => {
    await run({ cliId: "gemini" }, (child) => {
      child.stdout.emit("data", Buffer.from('{"name":"Ada"}'));
      child.emit("close");
    });
    expect(h.lastSpawn!.cmd).toBe("/fake/bin/gemini");
    expect(h.lastSpawn!.opts.cwd).toBe(ENGINE);
    const env = h.lastSpawn!.opts.env as Record<string, string>;
    expect(env.CAREER_OPS_ROOT).toBe(DATA);
    // Non-claude path uses spec.args(prompt) → ["-p", <prompt>]; prompt carries the mode + cv.
    expect(h.lastSpawn!.args[0]).toBe("-p");
    expect(h.lastSpawn!.args[1]).toContain("PORTFOLIO MODE INSTRUCTIONS");
    expect(h.lastSpawn!.args[1]).toContain("Ada Lovelace"); // from cv.md
  });
});

// ── happy path (claude: stream-json delta parsing) ────────────────────────────
describe("POST /api/portfolio/generate — claude stream-json path", () => {
  beforeEach(() => {
    h.resolveMock.mockReturnValue({
      spec: { name: "Claude Code", args: (p: string) => ["-p", p] },
      binPath: "/fake/bin/claude",
    });
  });

  it("accumulates content_block_delta text into the final JSON and emits done", async () => {
    const json = '{"name":"Grace Hopper","title":"Compiler Pioneer","tagline":"Invented the compiler"}';
    const events = await run({ cliId: "claude" }, (child) => {
      // Split the JSON across several stream-json delta lines.
      child.stdout.emit("data", Buffer.from(claudeDelta(json.slice(0, 15))));
      child.stdout.emit("data", Buffer.from(claudeDelta(json.slice(15, 40))));
      child.stdout.emit("data", Buffer.from(claudeDelta(json.slice(40))));
      child.emit("close");
    });

    const done = events.find((e) => e.kind === "done");
    expect(done).toBeTruthy();
    expect((done!.data as Record<string, unknown>).name).toBe("Grace Hopper");
    // Composing-status fires once a delta contains JSON punctuation.
    expect(events.some((e) => e.kind === "status" && /Composing/.test(String(e.label)))).toBe(true);

    const state = readPortfolio(DATA);
    expect(state.data!.name).toBe("Grace Hopper");
  });

  it("passes the claude headless flags (stream-json, read-only tools)", async () => {
    await run({ cliId: "claude" }, (child) => {
      child.stdout.emit("data", Buffer.from(claudeDelta('{"name":"X"}')));
      child.emit("close");
    });
    const args = h.lastSpawn!.args;
    expect(args).toContain("--output-format");
    expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json");
    expect(args).toContain("--disallowedTools");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("Read");
  });
});

// ── error paths from the child ────────────────────────────────────────────────
describe("POST /api/portfolio/generate — failure modes", () => {
  it("emits {kind:'error'} when the child returns no usable JSON", async () => {
    const events = await run({ cliId: "gemini" }, (child) => {
      child.stdout.emit("data", Buffer.from("I could not help with that, sorry."));
      child.emit("close");
    });
    const err = events.find((e) => e.kind === "error");
    expect(err).toBeTruthy();
    expect(String(err!.error)).toMatch(/didn't return a usable portfolio/i);
    expect(events.some((e) => e.kind === "done")).toBe(false);
    // Nothing was persisted.
    expect(readPortfolio(DATA).exists).toBe(false);
  });

  it("emits {kind:'error'} when JSON parses but has no name (coercePortfolio → null)", async () => {
    const events = await run({ cliId: "gemini" }, (child) => {
      child.stdout.emit("data", Buffer.from('{"title":"no name here"}'));
      child.emit("close");
    });
    expect(events.find((e) => e.kind === "error")).toBeTruthy();
    expect(events.some((e) => e.kind === "done")).toBe(false);
  });

  it("emits {kind:'error'} 'launch failed' when the child errors (e.g. ENOENT)", async () => {
    const events = await run({ cliId: "gemini" }, (child) => {
      child.emit("error", new Error("spawn ENOENT"));
    });
    const err = events.find((e) => e.kind === "error");
    expect(err).toBeTruthy();
    expect(String(err!.error)).toMatch(/launch failed/i);
  });

  it("surfaces a status line when stderr reports an error", async () => {
    const events = await run({ cliId: "gemini" }, (child) => {
      child.stderr.emit("data", Buffer.from("fatal: model not found"));
      child.stdout.emit("data", Buffer.from('{"name":"Ada"}'));
      child.emit("close");
    });
    expect(
      events.some((e) => e.kind === "status" && /Gemini CLI:/.test(String(e.label))),
    ).toBe(true);
  });
});
