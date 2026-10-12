import { requestRoot } from "@/lib/profile-registry";
import { OutcomePatterns } from "@/components/analytics/outcome-patterns";
import { pipelineSummary, readApplicationStatusLog, readStatusLog } from "@/lib/career-ops";
import { PipelineSankey } from "@/components/analytics/pipeline-sankey";
import { canonStatus } from "@/lib/format";
import { cumulativeProgressWithHistory } from "@/lib/funnel-tiles.mjs";
import { analyticsApplications } from "@/lib/analytics-data";
import { computeProgressMetrics, computeStatsMetrics, generateInsights, resolveAnalyticsView } from "@/lib/analytics-metrics.mjs";
import { AnalyticsShell, ProgressPanel, StatsPanel } from "@/components/analytics-view";
import { FunnelRates } from "@/components/analytics/funnel-rates";
import { SearchInsights } from "@/components/analytics/search-insights";

export const dynamic = "force-dynamic";

export default async function Analytics({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const root = await requestRoot();
  const { applications } = pipelineSummary(root);
  // One URL contract for all three views. Each view owns its reads, as on main:
  // an incomplete Progress core install must not take Insights/Search stats down.
  const view = resolveAnalyticsView(params.view);
  return (
    <AnalyticsShell total={applications.length} view={view}>
      {view === "insights" ? <SearchInsights /> : view === "search-stats" ? <SearchStatsView applications={applications} /> : <ProgressView applications={applications} root={root} />}
    </AnalyticsShell>
  );
}

async function ProgressView({ applications, root }: { applications: ReturnType<typeof pipelineSummary>["applications"]; root: string }) {
  const achievements = await cumulativeProgressWithHistory(
    applications.map((app) => ({ n: app.n, status: canonStatus(app.status) })),
    readApplicationStatusLog(root),
  );
  return (
    <>
      <ProgressPanel metrics={computeProgressMetrics(applications, achievements)} />
      <PipelineSankey applications={applications} statusLog={readStatusLog(root)} />
      <FunnelRates />
      <OutcomePatterns />
    </>
  );
}

function SearchStatsView({ applications }: { applications: ReturnType<typeof pipelineSummary>["applications"] }) {
  const stats = computeStatsMetrics(analyticsApplications(applications));
  return <StatsPanel metrics={stats} insights={generateInsights(stats)} />;
}
