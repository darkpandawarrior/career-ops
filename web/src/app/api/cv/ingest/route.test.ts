import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

/**
 * /api/cv/ingest parses a CV (pasted text OR an uploaded PDF/DOCX) into clean
 * cv.md markdown by running the USER'S OWN cli headless. It is a PROPOSER: it
 * streams candidate markdown back (Claude's stream-json deltas are unwrapped to
 * plain text; other CLIs are forwarded verbatim) and never writes a file.
 *
 * We exercise it hermetically:
 *   - mock `node:child_process` spawn → a FAKE EventEmitter child with stdout /
 *     stderr EventEmitters and a kill spy (NO real process),
 *   - mock `@/lib/clis` resolveCli → a fake { spec, binPath } (or null for the
 *     not-found branch),
 *   - mock `@/lib/career-ops` careerOpsRoot → a tmp engine root (also drives the
 *     canonical-mode fallback: no modes/cv-ingest.md on disk → inline prompt),
 *   - mock `@/lib/profile-registry` requestRoot → a tmp data root.
 *
 * Coverage targets: the cliId + content-type branches (json / multipart /
 * unsupported), the non-Claude-PDF guard, the resolveCli 404, and the streamed
 * output for both the Claude stream-json path and the verbatim path.
 */

const ENGINE = fs.mkdtempSync(path.join(os.tmpdir(), "co-cv-ingest-engine-"));
const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-cv-ingest-data-"));

// Fake child process + spawn capture, in a hoisted holder so the (hoisted)
// vi.mock factory can reference them without a TDZ error.
type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};
const h = vi.hoisted(() => {
  const state = {
    lastChild: undefined as unknown as FakeChild,
    spawnArgs: undefined as unknown as { cmd: string; args: readonly string[]; opts: Record<string, unknown> },
    throwOnSpawn: false,
  };
  const spawnMock = vi.fn((cmd: string, args: readonly string[], opts: Record<string, unknown>) => {
    if (state.throwOnSpawn) throw new Error("spawn EACCES");
    state.spawnArgs = { cmd, args, opts };
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    state.lastChild = child;
    return child;
  });
  // resolveCli is mutable per-test: default returns a fake claude resolution.
  const resolveCliMock = vi.fn();
  // runOnboarding mock — used only for the non-Claude PDF extraction path.
  const runOnboardingMock = vi.fn();
  return { state, spawnMock, resolveCliMock, runOnboardingMock };
});

vi.mock("node:child_process", () => ({ spawn: h.spawnMock }));

vi.mock("@/lib/clis", () => ({
  resolveCli: h.resolveCliMock,
}));

vi.mock("@/lib/onboarding/run", () => ({
  runOnboarding: h.runOnboardingMock,
}));

vi.mock("@/lib/career-ops", () => ({
  careerOpsRoot: () => ENGINE,
}));

vi.mock("@/lib/profile-registry", () => ({
  requestRoot: vi.fn(async () => DATA_ROOT),
}));

import { POST } from "./route";

// A fake resolveCli result. `name`/`args` mirror the CliSpec shape the route uses
// (spec.name for stderr framing; spec.args(prompt) for non-Claude invocation).
function fakeResolved(name = "Codex", binPath = "/fake/bin/codex") {
  return { spec: { id: name.toLowerCase(), name, bin: name.toLowerCase(), run: name, url: "", args: (p: string) => ["exec", p] }, binPath };
}

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

// One stream-json line as Claude's --include-partial-messages stream emits it.
function delta(text: string): string {
  return JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { text } } }) + "\n";
}

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/cv/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.throwOnSpawn = false;
  // Default: a valid Claude resolution so spawn-path tests work out of the box.
  h.resolveCliMock.mockReturnValue(fakeResolved("Claude Code", "/fake/bin/claude"));
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  fs.rmSync(ENGINE, { recursive: true, force: true });
  fs.rmSync(DATA_ROOT, { recursive: true, force: true });
});

describe("POST /api/cv/ingest — request validation (no spawn)", () => {
  it("rejects an unsupported content-type with 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/cv/ingest", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "hi",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unsupported content-type");
    expect(h.spawnMock).not.toHaveBeenCalled();
  });

  it("rejects empty/blank pasted CV text with 400 (json branch)", async () => {
    const res = await POST(jsonReq({ text: "   ", cliId: "claude" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("empty cv text");
    expect(h.spawnMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400 'bad request'", async () => {
    const res = await POST(
      new Request("http://localhost/api/cv/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ not json",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad request");
    expect(h.spawnMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the requested cli is not installed on this machine", async () => {
    h.resolveCliMock.mockReturnValue(null);
    const res = await POST(jsonReq({ text: "John Doe, Android engineer", cliId: "ghostcli" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("CLI 'ghostcli' not found on this machine");
    expect(h.spawnMock).not.toHaveBeenCalled();
  });

  it("returns 500 when spawning the cli throws synchronously", async () => {
    h.state.throwOnSpawn = true;
    const res = await POST(jsonReq({ text: "John Doe", cliId: "claude" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("spawn EACCES");
  });
});

describe("POST /api/cv/ingest — multipart branch validation", () => {
  it("rejects a multipart request with no file with 400", async () => {
    const form = new FormData();
    form.set("cliId", "claude");
    const res = await POST(new Request("http://localhost/api/cv/ingest", { method: "POST", body: form }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("no file");
    expect(h.spawnMock).not.toHaveBeenCalled();
  });

  it("extracts PDF text locally via the bridge for a non-Claude cli, then spawns CLI with text prompt", async () => {
    h.resolveCliMock.mockReturnValue(fakeResolved("Gemini CLI", "/fake/bin/gemini"));
    h.runOnboardingMock.mockResolvedValue({ ok: true, text: "John Doe — Software Engineer" });

    const form = new FormData();
    form.set("cliId", "gemini");
    form.set("file", new File([new Uint8Array([1, 2, 3])], "resume.pdf", { type: "application/pdf" }));
    const res = await POST(new Request("http://localhost/api/cv/ingest", { method: "POST", body: form }));

    // Bridge was called to extract text (no CLI file access needed).
    expect(h.runOnboardingMock).toHaveBeenCalledWith(
      "extract-text",
      expect.arrayContaining([expect.stringContaining(".pdf")]),
      {},
    );
    // CLI was then spawned with a TEXT_SRC prompt (not a FILE_SRC path).
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(h.spawnMock).toHaveBeenCalledTimes(1);
    const prompt = h.state.spawnArgs.args[1] as string; // gemini: ["exec", prompt]
    expect(prompt).toContain("pasted as text");
    expect(prompt).toContain("John Doe — Software Engineer");

    const bodyPromise = readBody(res);
    h.state.lastChild.stdout.emit("data", Buffer.from("<<cv:start>>\n# CV -- John Doe\n<<cv:end>>"));
    h.state.lastChild.emit("close");
    expect(await bodyPromise).toContain("# CV -- John Doe");
  });

  it("returns 422 when PDF text extraction fails for a non-Claude cli", async () => {
    h.resolveCliMock.mockReturnValue(fakeResolved("Codex", "/fake/bin/codex"));
    h.runOnboardingMock.mockResolvedValue({ ok: false, error: "No selectable text found — this PDF may be a scanned image." });

    const form = new FormData();
    form.set("cliId", "codex");
    form.set("file", new File([new Uint8Array([1, 2, 3])], "resume.pdf", { type: "application/pdf" }));
    const res = await POST(new Request("http://localhost/api/cv/ingest", { method: "POST", body: form }));

    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("No selectable text found — this PDF may be a scanned image.");
    expect(h.spawnMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/cv/ingest — Claude stream-json path", () => {
  it("spawns the resolved bin with stream-json args scoped to the data root, and unwraps deltas to text", async () => {
    const res = await POST(jsonReq({ text: "Jane Dev — Senior Android Engineer", cliId: "claude" }));
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");

    // Verify the spawn wiring: the fake claude binPath, the headless stream-json
    // flags, the engine cwd, and the profile-scoped CAREER_OPS_ROOT env.
    expect(h.spawnMock).toHaveBeenCalledTimes(1);
    expect(h.state.spawnArgs.cmd).toBe("/fake/bin/claude");
    expect(h.state.spawnArgs.args).toContain("--output-format");
    expect(h.state.spawnArgs.args).toContain("stream-json");
    expect(h.state.spawnArgs.args).toContain("--allowedTools");
    expect(h.state.spawnArgs.opts.cwd).toBe(ENGINE);
    expect((h.state.spawnArgs.opts.env as Record<string, string>).CAREER_OPS_ROOT).toBe(DATA_ROOT);

    const bodyPromise = readBody(res);
    const child = h.state.lastChild;
    // Two delta lines + a non-content line that must be ignored.
    child.stdout.emit("data", Buffer.from(delta("Reading your CV…\n<<cv:start>>\n# CV -- Jane Dev\n")));
    child.stdout.emit("data", Buffer.from(JSON.stringify({ type: "system", event: {} }) + "\n"));
    child.stdout.emit("data", Buffer.from(delta("<<cv:end>>\n")));
    child.emit("close");

    const body = await bodyPromise;
    expect(body).toContain("<<cv:start>>");
    expect(body).toContain("# CV -- Jane Dev");
    expect(body).toContain("<<cv:end>>");
    // The non-content stream-json line contributed nothing.
    expect(body).not.toContain("system");
  });

  it("reassembles a stream-json line split across stdout chunks (line buffering)", async () => {
    const res = await POST(jsonReq({ text: "split cv", cliId: "claude" }));
    const bodyPromise = readBody(res);
    const child = h.state.lastChild;
    const line = delta("HELLO-WORLD");
    const mid = Math.floor(line.length / 2);
    child.stdout.emit("data", Buffer.from(line.slice(0, mid)));
    child.stdout.emit("data", Buffer.from(line.slice(mid)));
    child.emit("close");
    expect(await bodyPromise).toContain("HELLO-WORLD");
  });

  it("emits the no-output cv:error sentinel when the child closes having streamed nothing", async () => {
    const res = await POST(jsonReq({ text: "cv", cliId: "claude" }));
    const bodyPromise = readBody(res);
    h.state.lastChild.emit("close"); // closed with zero deltas
    const body = await bodyPromise;
    expect(body).toContain('<<cv:error>>{"reason":"no-output"}');
  });

  it("frames an error-bearing stderr line with the cli name", async () => {
    const res = await POST(jsonReq({ text: "cv", cliId: "claude" }));
    const bodyPromise = readBody(res);
    const child = h.state.lastChild;
    child.stderr.emit("data", Buffer.from("fatal: permission denied\n"));
    child.emit("close");
    const body = await bodyPromise;
    expect(body).toContain("[Claude Code] fatal: permission denied");
  });

  it("kills the child with SIGTERM when the response stream is cancelled", async () => {
    const res = await POST(jsonReq({ text: "cv", cliId: "claude" }));
    const child = h.state.lastChild;
    await res.body!.cancel();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("POST /api/cv/ingest — non-Claude verbatim path", () => {
  it("forwards a non-Claude cli's stdout through verbatim (no stream-json unwrapping)", async () => {
    h.resolveCliMock.mockReturnValue(fakeResolved("Codex", "/fake/bin/codex"));
    const res = await POST(jsonReq({ text: "Paste me", cliId: "codex" }));

    // Non-Claude uses spec.args(prompt) → ["exec", <prompt>], not the stream-json flags.
    expect(h.state.spawnArgs.cmd).toBe("/fake/bin/codex");
    expect(h.state.spawnArgs.args[0]).toBe("exec");
    expect(h.state.spawnArgs.args).not.toContain("stream-json");

    const bodyPromise = readBody(res);
    const child = h.state.lastChild;
    // Raw text, not JSON — forwarded unchanged.
    child.stdout.emit("data", Buffer.from("<<cv:start>>\n# CV -- Paste Me\n<<cv:end>>"));
    child.emit("close");
    const body = await bodyPromise;
    expect(body).toContain("# CV -- Paste Me");
  });
});

describe("POST /api/cv/ingest — multipart Claude file path", () => {
  it("accepts a PDF upload for Claude, writes a temp file outside the repo, and spawns with FILE_SRC", async () => {
    const form = new FormData();
    form.set("cliId", "claude");
    form.set("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "resume.pdf", { type: "application/pdf" }));
    const res = await POST(new Request("http://localhost/api/cv/ingest", { method: "POST", body: form }));
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(h.spawnMock).toHaveBeenCalledTimes(1);

    // The prompt (last positional arg before the flags) references a temp file path,
    // and the temp dir is outside the engine/data roots (PII-safe, basename-only).
    const prompt = h.state.spawnArgs.args[1] as string; // ["-p", prompt, ...]
    expect(prompt).toContain("READ it with your file/Read tool");
    expect(prompt).toMatch(/career-ops-cv-[^/]+\/cv\.pdf/);
    expect(prompt).not.toContain(ENGINE);

    // Drive to close so the temp file is cleaned up by the route.
    const bodyPromise = readBody(res);
    h.state.lastChild.emit("close");
    await bodyPromise;
  });
});
