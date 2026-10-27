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
    // process.execPath + windowsHide: see api/doctor/route.ts — a stale inherited
    // console kills every child with 0xC0000142 on Windows; never inherit one.
    // analyze-patterns.mjs EMITS JSON by default and rejects --json (exits non-zero).
    // It exits 1 for "not enough data yet" and still prints the explanatory JSON,
    // so stdout is taken even on a non-zero exit.
    execFile(
      process.execPath,
      [script],
      { cwd: careerOpsRoot(), env: { ...process.env, CAREER_OPS_ROOT: dataRoot }, timeout: 45_000, maxBuffer: 8 << 20, windowsHide: true },
      (_err, out) => resolve(out || ""),
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
