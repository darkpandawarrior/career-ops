import { pipelineSummary, doctorState } from "@/lib/career-ops";
import { readCoachState } from "@/lib/coach";
import { readProfileMeta } from "@/lib/profile-meta";
import { jobDashboard } from "@/lib/jobs/scoring";
import { canonStatus } from "@/lib/format";
import { requestRoot } from "@/lib/profile-registry";
import { OnboardingBanner } from "@/components/onboarding-banner";
import { FirstRunHome } from "@/components/home/first-run-home";
import { TodayDashboard } from "@/components/home/today-dashboard";

export const dynamic = "force-dynamic"; // always read fresh local files at request time (never at build — CI has no user data)

export default async function Home() {
  const root = await requestRoot();
  const { phase, onboardingNeeded } = doctorState(root);
  // First run (truly empty install): the CV-upload takeover IS the home — value
  // before commitment. The full dashboard returns once they have a CV or any data.
  if (phase === "first-run") return <FirstRunHome />;

  // Gather everything for the command center once, on the server, from the
  // canonical files (profile-aware via `root`). Each reader degrades to a safe
  // empty so a sparse profile still renders cleanly — the widgets self-hide.
  const { applications } = pipelineSummary(root);
  const coach = readCoachState();
  const meta = readProfileMeta(root);
  const board = jobDashboard(root).stats;

  const activeInterviews = applications.filter((a) => canonStatus(a.status) === "INTERVIEW").length;
  const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  // Established / in-between: the command-center Today. Show the setup banner
  // whenever ANY prereq is missing (mirrors the core doctor.mjs), so a
  // portals-missing user is nudged rather than told "all caught up".
  return (
    <>
      {onboardingNeeded && <OnboardingBanner />}
      <TodayDashboard
        applications={applications}
        name={meta?.fullName ?? ""}
        headline={meta?.headline ?? ""}
        dateLabel={dateLabel}
        activeInterviews={activeInterviews}
        board={board.total > 0 || board.sources > 0 ? board : null}
        coachSnapshot={
          coach
            ? {
                loops: coach.loops,
                drillStage: coach.drillStage,
                drillQueue: coach.drillQueue,
                outcomes: coach.outcomes.map((o) => ({
                  date: o.date,
                  company: o.company,
                  role: o.role,
                  round: o.round,
                  result: o.result,
                })),
              }
            : null
        }
        coachingCallout={
          coach && (coach.effectivePatterns.length > 0 || coach.strategy.length > 0)
            ? { effectivePatterns: coach.effectivePatterns, strategy: coach.strategy }
            : null
        }
        inBetween={phase === "in-between"}
      />
    </>
  );
}
