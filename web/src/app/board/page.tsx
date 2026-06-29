import { jobDashboard } from "@/lib/jobs/scoring";
import { requestRoot } from "@/lib/profile-registry";
import { JobBoard } from "@/components/board/job-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // always read + re-score the live cache

// The scored job board — the read surface over the Phase 1 scoring engine.
// jobDashboard() re-scores the cached feed against the ACTIVE profile's config,
// so switching profiles re-ranks the board. Pure read (never writes user data).
export default async function BoardPage() {
  const data = jobDashboard(await requestRoot());
  return <JobBoard initial={data} />;
}
