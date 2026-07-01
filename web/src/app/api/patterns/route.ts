import { execFile } from "node:child_process";
import fs from "node:fs";
import { NextResponse } from "next/server";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { requestRoot } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Rejection / outcome patterns — runs the core's analyze-patterns.mjs (the SAME
 * analysis the CLI uses) for the active profile and returns its JSON result. We
 * read the core's verdict, never reimplement it (mirrors /api/followups, /api/doctor).
 */
export async function GET() {
  const script = rootScript("analyze-patterns");
  if (!fs.existsSync(script)) return NextResponse.json({ available: false, result: null });
  const dataRoot = await requestRoot();
  const stdout = await new Promise<string>((resolve) => {
    execFile(
      "node",
      [script, "--json"],
      { cwd: careerOpsRoot(), env: { ...process.env, CAREER_OPS_ROOT: dataRoot }, timeout: 45_000, maxBuffer: 8 * 1024 * 1024 },
      (err, out) => resolve(err ? "" : out || ""),
    );
  });
  // The script may print human text before the JSON block — grab the last {...}.
  try {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start === -1 || end <= start) return NextResponse.json({ available: false, result: null });
    return NextResponse.json({ available: true, result: JSON.parse(stdout.slice(start, end + 1)) });
  } catch {
    return NextResponse.json({ available: false, result: null });
  }
}
