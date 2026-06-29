import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import type { Application } from "@/lib/career-ops";
import { canonStatus } from "@/lib/format";
import { KpiHero } from "@/components/home/kpi-hero";
import { NeedsAction } from "@/components/home/needs-action";
import { InterviewSnapshot, type CoachSnapshot } from "@/components/home/interview-snapshot";
import { BoardSnapshot } from "@/components/home/board-snapshot";
import { CoachingCallout, type CoachingCallout as CoachingCalloutData } from "@/components/home/coaching-callout";
import { AllClearStrip } from "@/components/home/all-clear-strip";
import { DecisionCard } from "@/components/home/decision-card";
import { QuickEvaluate } from "@/components/quick-evaluate";

// The retention "Today", revamped into an ordered command center. Server-first:
// the hero + every snapshot is rendered from canonical files passed as props, so
// the page paints the candidate's whole situation in one pass. Only the
// live/mutating strips (follow-ups due, all-clear) fetch client-side. Order:
//   1. KPI hero (identity + the three counts that matter today)
//   2. Needs action today (overdue follow-ups, client)
//   3. Awaiting your decision (scored roles, one-tap apply/skip)
//   4. Interview snapshot (active loops + drill + last outcomes)
//   5. Board snapshot (scored market matches)
//   6. Coaching edge (effective patterns + strategy)
//   7. All-clear strip when nothing is due/awaiting.
export function TodayDashboard({
  applications,
  name,
  headline,
  dateLabel,
  activeInterviews,
  board,
  coachSnapshot,
  coachingCallout,
  inBetween,
}: {
  applications: Application[];
  name: string;
  headline: string;
  dateLabel: string;
  activeInterviews: number;
  board: { total: number; excellent: number; sources: number } | null;
  coachSnapshot: CoachSnapshot | null;
  coachingCallout: CoachingCalloutData | null;
  inBetween: boolean;
}) {
  // Awaiting decision: scored (Evaluated) but no terminal status yet.
  const awaiting = applications.filter((a) => canonStatus(a.status) === "EVALUATED").slice(0, 6);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <KpiHero
        name={name}
        headline={headline}
        dateLabel={dateLabel}
        activeInterviews={activeInterviews}
        activeLoops={coachSnapshot?.loops.length ?? 0}
        decisionsAwaiting={awaiting.length}
        actionItemsDue={null}
      />

      {inBetween && (
        <div className="mt-6">
          <QuickEvaluate />
        </div>
      )}

      <NeedsAction />

      {awaiting.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <ClipboardCheck className="size-4 text-brand" />
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Awaiting your decision</h2>
            <span className="text-xs text-faint">· scored — apply or skip</span>
            <Link href="/pipeline" className="ml-auto text-xs text-muted transition hover:text-brand">
              Open pipeline →
            </Link>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {awaiting.map((a) => (
              <DecisionCard key={a.n} app={a} />
            ))}
          </div>
        </section>
      )}

      {coachSnapshot && <InterviewSnapshot snapshot={coachSnapshot} />}

      {board && <BoardSnapshot total={board.total} excellent={board.excellent} sources={board.sources} />}

      {coachingCallout && <CoachingCallout callout={coachingCallout} />}

      <AllClearStrip decisionsAwaiting={awaiting.length} />
    </div>
  );
}
