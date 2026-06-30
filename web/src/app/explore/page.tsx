import fs from "node:fs";
import { ExplorerView } from "@/components/explore/explorer-view";
import { seedExploreFilters } from "@/lib/core/portals";
import { readInbox, readApplications } from "@/lib/career-ops";
import { requestRoot } from "@/lib/profile-registry";
import { DEFAULT_FILTERS } from "@/lib/explore";

// Read live data at request time so a bare checkout (or `next build` with no
// CAREER_OPS_ROOT) never fails — discovery seeds are best-effort.
export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  // The ACTIVE profile's data root (?profile=… → middleware → header). All reads
  // below are scoped to it so the Explorer seeds + snapshots match the candidate,
  // never the engine root in a multi-profile install.
  const root = await requestRoot();
  let seed: { filters: typeof DEFAULT_FILTERS; seededFrom: string[] } = { filters: DEFAULT_FILTERS, seededFrom: [] };
  try {
    seed = seedExploreFilters(root);
  } catch {
    /* bare checkout → defaults */
  }
  let rootExists = false;
  try {
    rootExists = fs.existsSync(root);
  } catch {
    /* ignore */
  }
  return (
    <ExplorerView seed={seed} inboxSnapshot={readInbox(root)} appsSnapshot={readApplications(root)} rootExists={rootExists} />
  );
}
