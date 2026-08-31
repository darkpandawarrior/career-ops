import { spawnHeadlessCli } from "@/lib/spawn-cli.mjs";
import type { CliSpec } from "@/lib/clis";

/**
 * planner.ts - spawn the read-only planner CLI and collect what it wrote.
 *
 * Lifted out of api/apply/prefill/route.ts unchanged, fork version: the route
 * streams `--output-format stream-json` (Claude only) so the UI can fill
 * fields as they're drafted instead of waiting on the whole turn, and picks
 * one of two Claude arg sets depending on whether the candidate's cv.md was
 * inlined into the prompt (`haveCv` — no cv.md means the planner needs Read
 * access to go fetch it itself). Everything here is a relocation: the argv,
 * the stream-json NDJSON parsing, the timeout formula, the heartbeat
 * interval, and the resolve-on-error behaviour are byte-for-byte what the
 * route did.
 *
 * What did NOT move: turning the drafted text into individual field answers
 * (the `co<N>` JSON entries) and the consent-field guard both need the
 * route's own `s.fields`/`emit` — those stay in the route, fed by `onText`.
 */

/**
 * One form control, as much of it as the planner needs. Structurally satisfied
 * by ApplyField; kept separate so this module does not import extract.ts and
 * with it playwright-core.
 */
export type PlannerField = {
  id: string;
  type: string;
  label: string;
  required?: boolean;
  options?: string[];
};

/**
 * A finished planner run. `code: null` with `signal: null` means the spawn
 * itself failed; the caller decides whether that is fatal, which is why this
 * resolves rather than rejecting.
 */
export type PlannerRun = { buf: string; code: number | null; signal: NodeJS.Signals | null };

export function runPlanner(opts: {
  /** Undefined is not an error here: only the Claude carve-out below reads it. */
  cliId: string | undefined;
  spec: CliSpec;
  binPath: string;
  prompt: string;
  fieldCount: number;
  cwd: string;
  /** Env the child inherits, plus whatever profile-root variables the caller needs set (e.g. CAREER_OPS_ROOT). */
  env: NodeJS.ProcessEnv;
  /** Whether the candidate's cv.md was inlined into the prompt — picks the Claude arg set (no-tools fast path vs Read/Glob/Grep fallback). Ignored for non-Claude CLIs, which always use `spec.args`. */
  haveCv: boolean;
  /** Request start, so elapsed times in the log stay relative to the same t0 the caller reports. */
  t0: number;
  log: (m: string) => void;
  /** Called with each chunk of drafted ANSWER text as it arrives (already unwrapped from Claude's stream-json envelope) — lets the caller stream per-field UI updates. */
  onText?: (text: string) => void;
}): Promise<PlannerRun> {
  const { cliId, spec, binPath, prompt, fieldCount, cwd, env, haveCv, t0, log, onText } = opts;

  const isClaude = cliId === "claude";
  // --output-format stream-json (+ --verbose --include-partial-messages) streams
  // the answer token-by-token so the UI shows live progress instead of a dead
  // "0 chars" wait (a big form = 1-2 min of drafting). Without it, `claude -p`
  // buffers everything and emits nothing until the whole turn ends → looks hung.
  // --strict-mcp-config with no --mcp-config loads ZERO MCP servers → faster
  // startup (the planner only reads local files; it doesn't need the user's
  // playwright/gmail/linear/… servers).
  const args = isClaude
    ? haveCv
      ? // fast path: everything is inlined → NO tools → no file-read round-trips
        ["-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-mode", "acceptEdits", "--strict-mcp-config", "--disallowedTools", "Bash,Read,Write,Edit,NotebookEdit,Task,WebFetch,WebSearch,Glob,Grep"]
      : // fallback (no cv.md inlined): let the planner read the files itself
        ["-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-mode", "acceptEdits", "--strict-mcp-config", "--allowedTools", "Read,Glob,Grep", "--disallowedTools", "Bash,Write,Edit,NotebookEdit,Task,WebFetch,WebSearch"]
    : spec.args(prompt);
  // Scale the timeout with form size (big forms = more drafting). Cap < maxDuration.
  const killMs = Math.min(300_000, 150_000 + fieldCount * 6_000);
  log(`Spawning planner (timeout ${Math.round(killMs / 1000)}s)…`);

  return new Promise<PlannerRun>((resolve) => {
    // spawnHeadlessCli closes stdin right after spawning, so the CLI doesn't
    // wait on piped input that will never arrive.
    const child = spawnHeadlessCli(binPath, args, { cwd, env, shell: process.platform === "win32" });
    let buf = "";
    let lineBuf = "";
    let firstByteAt = 0;
    const onDraftText = (text: string) => {
      if (!firstByteAt) {
        firstByteAt = Date.now();
        log(`first answer token at ${Math.round((firstByteAt - t0) / 1000)}s`);
      }
      buf += text;
      onText?.(text);
    };
    const hb = setInterval(() => {
      log(`…running ${Math.round((Date.now() - t0) / 1000)}s · ${buf.length} chars drafted`);
    }, 4000);
    child.stdout.on("data", (d: Buffer) => {
      const chunk = d.toString();
      if (!isClaude) {
        onDraftText(chunk); // other CLIs: raw stdout is the answer
        return;
      }
      // Claude stream-json = NDJSON; accumulate ONLY the assistant text deltas
      // (content_block_delta.text) — the drafted answer — into buf. A marker can
      // split across chunks, so buffer partial lines and parse line-by-line.
      lineBuf += chunk;
      let nl: number;
      while ((nl = lineBuf.indexOf("\n")) !== -1) {
        const line = lineBuf.slice(0, nl).trim();
        lineBuf = lineBuf.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === "stream_event" && obj.event?.type === "content_block_delta") {
            const text = obj.event.delta?.text;
            if (typeof text === "string") onDraftText(text);
          }
        } catch {
          /* partial / non-json line — ignore */
        }
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      const e = d.toString().trim();
      if (e) log(`stderr: ${e.slice(0, 160).replace(/\s+/g, " ")}`);
    });
    const killer = setTimeout(() => {
      log("TIMEOUT reached → SIGTERM");
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, killMs);
    child.on("close", (code, signal) => {
      clearTimeout(killer);
      clearInterval(hb);
      resolve({ buf, code, signal });
    });
    child.on("error", (e) => {
      clearTimeout(killer);
      clearInterval(hb);
      log(`spawn error: ${e.message}`);
      resolve({ buf, code: null, signal: null });
    });
  });
}
