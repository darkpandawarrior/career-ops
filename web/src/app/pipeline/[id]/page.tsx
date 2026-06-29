import { notFound } from "next/navigation";
import { readReport, findApplication } from "@/lib/career-ops";
import { requestRoot } from "@/lib/profile-registry";
import { ReportView } from "@/components/report-view";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const root = await requestRoot();
  const app = findApplication(id, root);
  const report = readReport(id, root);
  if (!app && !report) notFound();
  return <ReportView id={id} app={app} report={report?.content ?? null} file={report?.file ?? null} />;
}
