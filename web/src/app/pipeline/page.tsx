import { Suspense } from "react";
import { pipelineSummary } from "@/lib/career-ops";
import { requestRoot } from "@/lib/profile-registry";
import { PipelineView } from "@/components/pipeline-view";

export const dynamic = "force-dynamic"; // always read fresh local files

export default async function PipelinePage() {
  const { inbox, applications } = pipelineSummary(await requestRoot());
  return (
    <Suspense>
      <PipelineView applications={applications} inbox={inbox} />
    </Suspense>
  );
}
