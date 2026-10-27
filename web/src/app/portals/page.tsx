import { Radar } from "lucide-react";
import path from "node:path";
import { PortalsView } from "@/components/portals-view";
import { PageShell, PageHeader } from "@/components/ui/page-shell";
import { careerOpsRoot, portalsConfigPath } from "@/lib/career-ops";
import { requestRoot } from "@/lib/profile-registry";
import { loadPortalsDocument, watchedCompanies, type WatchedCompany } from "@/lib/portals-config.mjs";

export const dynamic = "force-dynamic";

function readWatched(root: string): { watched: WatchedCompany[]; error: string | null } {
  try {
    const { doc, seeded } = loadPortalsDocument(portalsConfigPath(root), path.join(careerOpsRoot(), "templates", "portals.example.yml"));
    return { watched: seeded ? [] : watchedCompanies(doc), error: null };
  } catch (e) {
    return { watched: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export default async function PortalsPage() {
  const { watched, error } = readWatched(await requestRoot());
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
      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-400">
          Could not read <code>portals.yml</code>: {error}
        </p>
      )}
      <div className="mt-6">
        <PortalsView watched={watched} />
      </div>
    </PageShell>
  );
}
