import path from "node:path";
import { pathToFileURL } from "node:url";
import { careerOpsRoot } from "@/lib/career-ops";

/**
 * ACL for the core's `resolvePdfIndexPath`/`resolveTrackerPath` (tracker-utils.mjs)
 * — the shared manifest-path resolver merge-tracker.mjs, sync-pdf-flags.mjs, and
 * find.mjs all use (#2471).
 *
 * DERIVED, NOT COPIED (#2369, #2666). The manifest path used to be rebuilt from a
 * `"data/pdf-index.tsv"` literal in each reader, and each picked its own base
 * directory — so a script resolving the tracker from `CAREER_OPS_TRACKER` could
 * read one workspace's manifest against another's tracker. `resolvePdfIndexPath`
 * exists specifically to make that impossible: one definition, including the
 * `CAREER_OPS_PDF_INDEX` override, for every reader.
 *
 * We can't `import` it statically: the core lives in the USER's checkout,
 * resolved at runtime via careerOpsRoot(), and is not a build dependency of this
 * app. So we import it dynamically per resolved engine root and cache the
 * module — keyed by path, and NEVER caching a failure (the lesson from #2590,
 * where a cached fallback pinned stale definitions for the process lifetime).
 *
 * Fork note: the script lives at the ENGINE root (careerOpsRoot()'s single,
 * unparameterized location — same convention as rootScript()/engineScript() in
 * career-ops.ts), while the tracker/manifest it resolves lives under the
 * request's own DATA root, which may be a `?profile` root under multi-profile.
 * The two are passed separately for that reason: `dataRoot` here is never
 * assumed to equal the engine's careerOpsRoot().
 */

type TrackerUtils = {
  resolveTrackerPath: (rootDir: string) => string;
  resolvePdfIndexPath: (trackerPath: string) => string;
};

const modCache = new Map<string, TrackerUtils>();

let warned = false;

/** The absolute path to data/pdf-index.tsv for the given data root, or null if
 *  the core module couldn't be loaded (older checkout). Falling back to a
 *  hardcoded literal here would reintroduce #2471 for non-default layouts, so
 *  callers must treat null as "can't resolve" rather than guessing a path.
 *
 *  `dataRoot` defaults to careerOpsRoot() (single-profile); request-scoped
 *  callers pass the active profile's resolved root (`await requestRoot()`). */
export async function resolvePdfIndexPath(dataRoot: string = careerOpsRoot()): Promise<string | null> {
  const engineFile = path.join(careerOpsRoot(), "tracker-utils.mjs");
  const hit = modCache.get(engineFile);
  if (hit) return hit.resolvePdfIndexPath(hit.resolveTrackerPath(dataRoot));
  try {
    const mod = (await import(/* webpackIgnore: true */ pathToFileURL(engineFile).href)) as Partial<TrackerUtils>;
    if (typeof mod.resolveTrackerPath === "function" && typeof mod.resolvePdfIndexPath === "function") {
      const utils = mod as TrackerUtils;
      modCache.set(engineFile, utils); // only successes are cached (#2590)
      return utils.resolvePdfIndexPath(utils.resolveTrackerPath(dataRoot));
    }
    if (!warned) {
      warned = true;
      console.warn(`[career-ops] ${engineFile} has no resolveTrackerPath/resolvePdfIndexPath export — update career-ops to enable the tailored-CV viewer.`);
    }
  } catch {
    if (!warned) {
      warned = true;
      console.warn(`[career-ops] could not load ${engineFile} — update career-ops to enable the tailored-CV viewer.`);
    }
  }
  return null;
}
