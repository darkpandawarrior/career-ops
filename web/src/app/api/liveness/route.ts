import { execFile } from "node:child_process";
import fs from "node:fs";
import { NextResponse } from "next/server";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { requestRoot } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

// Ad-hoc liveness — spawn the REAL check-liveness.mjs engine for a single URL
// the user pastes (never reimplement the detection logic). Profile-aware via
// CAREER_OPS_ROOT. The script prints a human-readable ✅/❌/⚠️ report per URL.
export async function POST(req: Request) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  const url = (body.url ?? "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ ok: false, error: "a job URL starting with http(s) is required" }, { status: 400 });
  }
  const script = rootScript("check-liveness");
  if (!fs.existsSync(script)) {
    return NextResponse.json({ ok: false, error: "check-liveness.mjs not found in this checkout" }, { status: 400 });
  }
  const dataRoot = await requestRoot();
  const { out, code } = await new Promise<{ out: string; code: number | null }>((resolve) => {
    execFile(
      "node",
      [script, url],
      { cwd: careerOpsRoot(), env: { ...process.env, CAREER_OPS_ROOT: dataRoot }, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const c = err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === "number"
          ? ((err as unknown as { code: number }).code)
          : err ? 1 : 0;
        resolve({ out: (stdout || "") + (stderr ? `\n${stderr}` : ""), code: c });
      },
    );
  });
  const text = out.trim();
  // Infer liveness from the engine's markers: ✅/active → live, ❌/expired → dead.
  // The script reports per-URL with these icons; ⚠️ uncertain → leave null.
  let live: boolean | null = null;
  if (/✅|\bactive\b/i.test(text)) live = true;
  else if (/❌|\bexpired\b|\bdead\b/i.test(text)) live = false;
  return NextResponse.json({ ok: true, output: text || "(no output)", live, code });
}
