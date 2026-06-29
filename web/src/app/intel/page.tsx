import { readCoachState } from "@/lib/coach";
import { IntelView } from "@/components/intel/intel-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Intel — the legacy "Intel" tab: interview-coach state (storybank, outcomes,
// question bank, drills, company patterns) plus rejection-pattern analysis and
// the full follow-up cadence (both fetched client-side as they spawn scripts).
export default function IntelPage() {
  return <IntelView coach={readCoachState()} />;
}
