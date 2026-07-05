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
            The companies the scanner watches for new roles (<code className="text-foreground">portals.yml</code>). Run a
            health check to catch ATS slugs that have quietly broken — a 404 means that company silently disappears from
            every future scan.
          </>
        }
      />
      <div className="mt-6">
        <PortalsView />
      </div>
    </PageShell>
  );
}
