import { readScanHistory, readAgentInbox } from "@/lib/career-ops";
import { readPortals } from "@/lib/portals-meta";
import { requestRoot } from "@/lib/profile-registry";
import { OpsView } from "@/components/ops/ops-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ops console — the legacy dashboard's "Ops" tab: discovery (scan-history),
// operations (scan / verify liveness / pipeline health), the agent inbox,
// tracked companies + search queries, and the command reference.
export default async function OpsPage() {
  const root = await requestRoot();
  return <OpsView scans={readScanHistory(root)} inbox={readAgentInbox(root)} portals={readPortals(root)} />;
}
