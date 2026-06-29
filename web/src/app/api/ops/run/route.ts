import { execFile } from "node:child_process";
import fs from "node:fs";
import { NextResponse } from "next/server";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { requestRoot } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Operations console — spawn the REAL core scripts (never reimplement), scoped
// to the active profile via CAREER_OPS_ROOT. Output is captured as text and
// shown verbatim (these scripts print human-readable ✅/⚠️/❌ reports, not JSON).
// Allowlisted ops only; scan/liveness are network/browser-heavy (longer timeout).
const OPS: Record<string, { script: string; args: string[]; label: string; timeout: number }> = {
  "pipeline-health": { script: "verify-pipeline", args: [], label: "Pipeline health", timeout: 60_000 },
  scan: { script: "scan", args: [], label: "Portal scan", timeout: 280_000 },
  "scan-verify": { script: "scan", args: ["--verify"], label: "Scan + verify liveness", timeout: 280_000 },
  liveness: { script: "check-liveness", args: [], label: "Liveness check", timeout: 200_000 },
};

export async function POST(req: Request) {
  let body: { op?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  const op = OPS[body.op ?? ""];
  if (!op) {
    return NextResponse.json({ ok: false, error: "unknown op", allowed: Object.keys(OPS) }, { status: 400 });
  }
  const script = rootScript(op.script);
  if (!fs.existsSync(script)) {
    return NextResponse.json({ ok: false, error: `${op.script}.mjs not found in this checkout` }, { status: 400 });
  }
  const dataRoot = await requestRoot();
  const output = await new Promise<{ out: string; code: number | null }>((resolve) => {
    execFile(
      "node",
      [script, ...op.args],
      { cwd: careerOpsRoot(), env: { ...process.env, CAREER_OPS_ROOT: dataRoot }, timeout: op.timeout, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === "number"
          ? ((err as unknown as { code: number }).code)
          : err ? 1 : 0;
        resolve({ out: (stdout || "") + (stderr ? `\n${stderr}` : ""), code });
      },
    );
  });
  return NextResponse.json({ ok: true, op: body.op, label: op.label, output: output.out.trim(), code: output.code });
}
