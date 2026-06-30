import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot } from "@/lib/career-ops";
import { requestRoot } from "@/lib/profile-registry";
import { readPortfolio, buildPortfolioContext } from "@/lib/portfolio/context";
import { extractPortfolioJson } from "@/lib/portfolio/schema";
import { coerceAnalysis, ANALYZE_PROMPT } from "@/lib/portfolio/analyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

// Critique the active profile's portfolio and return actionable suggestions. The
// suggestions' `action` strings can be applied verbatim via the refine flow.
export async function POST(req: Request) {
  let body: { cliId?: string };
  try {
    body = (await req.json()) as { cliId?: string };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.cliId) return NextResponse.json({ error: "cliId required" }, { status: 400 });
  const resolved = resolveCli(body.cliId);
  if (!resolved) return NextResponse.json({ error: `CLI '${body.cliId}' not found` }, { status: 404 });

  const root = await requestRoot();
  const { exists, data } = readPortfolio(root);
  if (!exists || !data) return NextResponse.json({ error: "generate a portfolio first" }, { status: 400 });
  const ctx = buildPortfolioContext(root);

  const prompt = `${ANALYZE_PROMPT}\n\n--- PORTFOLIO JSON ---\n${JSON.stringify(data)}\n\n--- cv.md ---\n${ctx.cv}\n\n${ctx.extra}`;
  const isClaude = body.cliId === "claude";
  const args = isClaude
    ? ["-p", prompt, "--permission-mode", "acceptEdits", "--allowedTools", "Read", "--disallowedTools", "Bash,Write,Edit,NotebookEdit,Task,WebFetch"]
    : resolved.spec.args(prompt);

  const out = await new Promise<string>((resolve) => {
    const child = spawn(resolved.binPath, args, { cwd: careerOpsRoot(), env: { ...process.env, CAREER_OPS_ROOT: root } });
    let buf = "";
    const killer = setTimeout(() => { try { child.kill("SIGTERM"); } catch { /* */ } }, 150_000);
    child.stdout.on("data", (d: Buffer) => (buf += d.toString()));
    child.on("error", () => { clearTimeout(killer); resolve(""); });
    child.on("close", () => { clearTimeout(killer); resolve(buf); });
  });

  const analysis = coerceAnalysis(extractPortfolioJson(out));
  if (!analysis) return NextResponse.json({ error: "couldn't analyze — try again" }, { status: 502 });
  return NextResponse.json({ analysis });
}
