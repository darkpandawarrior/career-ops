import { notFound } from "next/navigation";
import { readReport, readReportForApplication, findApplication } from "@/lib/career-ops";
import { requestRoot } from "@/lib/profile-registry";
import { ReportView } from "@/components/report-view";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const root = await requestRoot();
  const app = findApplication(id, root);
  // Resolve the report via the tracker row's link (report no. ≠ application no.),
  // falling back to a by-number lookup when there is no matching row.
  const report = app ? readReportForApplication(app, root) : readReport(id, root);
  if (!app && !report) notFound();
  return <ReportView id={id} app={app} report={report?.content ?? null} file={report?.file ?? null} />;
}
