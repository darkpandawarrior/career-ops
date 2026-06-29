import { NextResponse } from "next/server";
import { scoreJobs } from "@/lib/jobs/scoring";
import { requestRoot } from "@/lib/profile-registry";
import type { RawJob } from "@/lib/jobs/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Score one or more raw jobs against the active profile's job-search config.
 * Body: `{ jobs: RawJob[] }` or `{ job: RawJob }`. Pure compute over the
 * vendored scoring engine — no subprocess, deterministic, profile-aware.
 */
export async function POST(req: Request) {
  let body: { jobs?: RawJob[]; job?: RawJob };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const jobs = Array.isArray(body.jobs) ? body.jobs : body.job ? [body.job] : null;
  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ error: "provide `jobs` (array) or `job` (object)" }, { status: 400 });
  }
  const result = scoreJobs(jobs, await requestRoot());
  if (!result.valid) {
    return NextResponse.json(
      { valid: false, errors: result.errors, warnings: result.warnings, jobs: [] },
      { status: 422 },
    );
  }
  return NextResponse.json(result);
}
