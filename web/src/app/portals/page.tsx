import { Radar } from "lucide-react";
import { PortalsView } from "@/components/portals-view";
import { PageShell, PageHeader } from "@/components/ui/page-shell";

export const dynamic = "force-dynamic";

export default function PortalsPage() {
  return (
    <PageShell maxWidth="3xl">
      <PageHeader
        icon={Radar}
        title="Portals"
        description={
          <>
            The companies career-ops watches for new roles. Run a health check to catch company boards that have
            quietly broken — a broken link means that company silently disappears from every future scan.
            <br />
            <span className="text-xs text-faint">
              Backed by <code className="text-muted">portals.yml</code> — edit it directly or ask the assistant.
            </span>
          </>
        }
      />
      <div className="mt-6">
        <PortalsView />
      </div>
    </PageShell>
  );
}
