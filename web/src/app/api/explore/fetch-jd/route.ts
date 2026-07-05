import { execFile } from "node:child_process";
import fs from "node:fs";
import { NextResponse } from "next/server";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Clean JD preview for a recognized ATS URL (Greenhouse/Ashby/Lever/Workday) —
// spawns the REAL fetch-jd.mjs engine (per-job API, not a full-page scrape),
// never reimplements it. Exits 1 on a miss/unrecognized provider; the caller
// falls back to just the "Add to pipeline" / "Evaluate" actions with no preview.
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
  const script = rootScript("fetch-jd");
  if (!fs.existsSync(script)) {
    return NextResponse.json({ ok: false, error: "fetch-jd.mjs not found in this checkout" }, { status: 400 });
  }
  const { out, code } = await new Promise<{ out: string; code: number | null }>((resolve) => {
    execFile(
      "node",
      [script, url, "--json"],
      { cwd: careerOpsRoot(), timeout: 15_000, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        const c = err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === "number"
          ? ((err as unknown as { code: number }).code)
          : err ? 1 : 0;
        resolve({ out: stdout || "", code: c });
      },
    );
  });
  if (code !== 0) return NextResponse.json({ ok: false, error: "no clean JD available for this posting" }, { status: 404 });
  try {
    const parsed = JSON.parse(out) as { title?: string; company?: string; location?: string; text?: string };
    return NextResponse.json({ ok: true, ...parsed });
  } catch {
    return NextResponse.json({ ok: false, error: "fetch-jd.mjs returned unparseable output" }, { status: 502 });
  }
}
