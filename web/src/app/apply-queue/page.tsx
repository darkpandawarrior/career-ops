import { readApplications, applicationUrl } from "@/lib/career-ops";
import { requestRoot } from "@/lib/profile-registry";
import { canonStatus } from "@/lib/format";
import { ApplyQueueView, type QueueCandidate } from "@/components/apply-queue-view";

export const dynamic = "force-dynamic";

// Candidates worth queuing: evaluated-but-not-yet-applied rows with a posting
// URL we can resolve from their report (applications.md carries no URL column).
// SKIP/Discarded/Rejected rows never belong in an apply queue.
const EXCLUDE = ["APPLIED", "RESPONDED", "INTERVIEW", "OFFER", "REJECTED", "DISCARDED", "SKIP"];

export default async function ApplyQueuePage() {
  const root = await requestRoot();
  const apps = readApplications(root);
  const candidates: QueueCandidate[] = apps
    .filter((a) => !EXCLUDE.some((s) => canonStatus(a.status).includes(s)))
    .map((a) => ({ n: a.n, company: a.company, role: a.role, score: a.score, status: a.status, url: applicationUrl(a, root) }))
    .filter((c): c is QueueCandidate & { url: string } => !!c.url);

  return <ApplyQueueView candidates={candidates} />;
}
