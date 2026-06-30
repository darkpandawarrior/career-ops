import { readCoachState } from "@/lib/coach";
import { readProfileMeta } from "@/lib/profile-meta";
import { requestRoot } from "@/lib/profile-registry";
import { IntelView } from "@/components/intel/intel-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Intel — the legacy "Intel" tab: profile banner + interview-coach state
// (storybank, outcomes, question bank, drills, company patterns) plus
// rejection-pattern analysis and the full follow-up cadence.
export default async function IntelPage() {
  const root = await requestRoot();
  return <IntelView coach={readCoachState(root)} profile={readProfileMeta(root)} />;
}
