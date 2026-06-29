import { execFile } from "node:child_process";
import fs from "node:fs";
import { NextResponse } from "next/server";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { requestRoot } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Full follow-up cadence for the active profile — runs the core's
 * followup-cadence.mjs --json (the SAME calculator the CLI + home card use) and
 * returns the COMPLETE entry list (the home card only shows the overdue top-6).
 */
export async function GET() {
  const script = rootScript("followup-cadence");
  if (!fs.existsSync(script)) return NextResponse.json({ available: false, metadata: null, entries: [] });
  const dataRoot = await requestRoot();
  const stdout = await new Promise<string>((resolve) => {
    execFile(
      "node",
      [script, "--json"],
      { cwd: careerOpsRoot(), env: { ...process.env, CAREER_OPS_ROOT: dataRoot }, timeout: 15_000 },
      (_e, out) => resolve(out || ""),
    );
  });
  try {
    const start = stdout.indexOf("{");
    const j = JSON.parse(stdout.slice(start));
    return NextResponse.json({
      available: true,
      metadata: j.metadata ?? null,
      entries: Array.isArray(j.entries) ? j.entries : [],
    });
  } catch {
    return NextResponse.json({ available: false, metadata: null, entries: [] });
  }
}
