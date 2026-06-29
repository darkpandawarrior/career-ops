import { readScanHistory, readAgentInbox } from "@/lib/career-ops";
import { requestRoot } from "@/lib/profile-registry";
import { OpsView } from "@/components/ops/ops-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ops console — the legacy dashboard's "Ops" tab: discovery (scan-history),
// operations (scan / verify liveness / pipeline health), and the agent inbox.
export default async function OpsPage() {
  const root = await requestRoot();
  return <OpsView scans={readScanHistory(root)} inbox={readAgentInbox(root)} />;
}
