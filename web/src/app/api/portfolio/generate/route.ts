import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot } from "@/lib/career-ops";
import { requestRoot } from "@/lib/profile-registry";
import { buildPortfolioContext, writePortfolio } from "@/lib/portfolio/context";
import { coercePortfolio, extractPortfolioJson, type PortfolioData } from "@/lib/portfolio/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = { cliId?: string; instruction?: string; base?: PortfolioData };

// Generate (or revise) a portfolio's DATA by running the user's CLI headless on
// their own files (read-only — it cannot write/exec), then render + persist it.
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const { cliId } = body;
  if (!cliId) return Response.json({ error: "cliId required" }, { status: 400 });
  const resolved = resolveCli(cliId);
  if (!resolved) return Response.json({ error: `CLI '${cliId}' not found` }, { status: 404 });
  const { spec, binPath } = resolved;

  // The mode lives in the ENGINE root (profile-independent code); the CV/profile
  // data is read from the ACTIVE profile root.
  let mode: string;
  try {
    mode = fs.readFileSync(path.join(careerOpsRoot(), "modes", "portfolio.md"), "utf8");
  } catch {
    return Response.json({ code: "MODE_MISSING", error: "portfolio mode needs a newer career-ops." }, { status: 400 });
  }
  const dataRoot = await requestRoot();
  const ctx = buildPortfolioContext(dataRoot);
  if (!ctx.cv.trim()) {
    return Response.json({ code: "NO_CV", error: "Add your CV first — the portfolio is built from it." }, { status: 400 });
  }

  const revise = body.instruction && body.base;
  const sources = `--- cv.md ---\n${ctx.cv}\n\n${ctx.extra}`;
  const prompt = revise
    ? `${mode}\n\n--- CURRENT PORTFOLIO JSON ---\n${JSON.stringify(body.base)}\n\n--- REVISION REQUESTED ---\n${body.instruction}\n\nReturn the FULL revised JSON object (same shape), applying the change. Keep everything truthful to the sources below.\n\n${sources}\n`
    : `${mode}\n\n${sources}\n\nEmit the portfolio JSON now.`;

  const isClaude = cliId === "claude";
  const args = isClaude
    ? ["-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages",
       "--permission-mode", "acceptEdits", "--allowedTools", "Read", "--disallowedTools", "Bash,Write,Edit,NotebookEdit,Task,WebFetch"]
    : spec.args(prompt);

  const child = spawn(binPath, args, { cwd: careerOpsRoot(), env: { ...process.env, CAREER_OPS_ROOT: dataRoot }, shell: process.platform === "win32" });
  if (!isClaude && spec.promptViaStdin) {
    child.stdin?.write(prompt);
    child.stdin?.end();
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let raw = ""; // full assistant text (we parse JSON from it at the end)
      let buf = "";
      const send = (obj: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };
      const killer = setTimeout(() => { try { child.kill("SIGTERM"); } catch { /* */ } }, 280_000);
      const safeClose = () => { if (!closed) { closed = true; clearTimeout(killer); try { controller.close(); } catch { /* */ } } };

      send({ kind: "status", label: "Reading your CV…" });

      child.stdout.on("data", (d: Buffer) => {
        if (closed) return;
        if (!isClaude) { raw += d.toString(); return; }
        buf += d.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === "stream_event" && obj.event?.type === "content_block_delta") {
              const t = obj.event.delta?.text;
              if (typeof t === "string") { raw += t; if (/[{}\[\]":]/.test(t)) send({ kind: "status", label: "Composing your site…" }); }
            }
          } catch { /* partial */ }
        }
      });
      child.stderr.on("data", (d: Buffer) => {
        const s = d.toString();
        if (/error|not found|denied|fatal/i.test(s) && !closed) send({ kind: "status", label: `${spec.name}: ${s.trim().slice(0, 120)}` });
      });
      child.on("error", (e) => { send({ kind: "error", error: `launch failed: ${e.message}` }); safeClose(); });
      child.on("close", () => {
        const parsed = extractPortfolioJson(raw);
        const data = coercePortfolio(parsed);
        if (!data) { send({ kind: "error", error: "The CLI didn't return a usable portfolio. Try again." }); safeClose(); return; }
        try {
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          const { html } = writePortfolio(data, dataRoot, stamp);
          send({ kind: "done", data, html });
        } catch (e) {
          send({ kind: "error", error: e instanceof Error ? e.message : "save failed" });
        }
        safeClose();
      });
    },
    cancel() { try { child.kill("SIGTERM"); } catch { /* */ } },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}




