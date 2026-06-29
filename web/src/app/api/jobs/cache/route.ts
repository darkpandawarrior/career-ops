import { NextResponse } from "next/server";
import { jobDashboard } from "@/lib/jobs/scoring";
import { requestRoot } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // always read fresh local files

/**
 * The scored job dashboard for the active profile — reads the cached job feed
 * (`data/job-dashboard.json`), (re)scores it against the current config, and
 * returns jobs + headline stats. Read-only (ports buildDashboardPayload's job
 * section); refreshing the feed itself is a later phase.
 */
export async function GET() {
  return NextResponse.json(jobDashboard(await requestRoot()));
}
