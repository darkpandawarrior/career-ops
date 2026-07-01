import { jobDashboard } from "@/lib/jobs/scoring";
import { readApplications } from "@/lib/career-ops";
import { requestRoot } from "@/lib/profile-registry";
import { canonStatus } from "@/lib/format";
import { JobBoard } from "@/components/board/job-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // always read + re-score the live cache

// The scored job board — the read surface over the Phase 1 scoring engine.
// jobDashboard() re-scores the cached feed against the ACTIVE profile's config,
// so switching profiles re-ranks the board. Pure read (never writes user data).
export default async function BoardPage() {
  const root = await requestRoot();
  const data = jobDashboard(root);
  // Companies where this candidate was already rejected — so the board can hide
  // them (the legacy "Rejected off" toggle).
  const rejected = Array.from(
    new Set(
      readApplications(root)
        .filter((a) => canonStatus(a.status).includes("REJECTED"))
        .map((a) => a.company.toLowerCase().trim())
        .filter(Boolean),
    ),
  );
  return <JobBoard initial={data} rejectedCompanies={rejected} />;
}
