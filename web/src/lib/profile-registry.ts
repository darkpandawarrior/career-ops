import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { headers } from "next/headers";
import { careerOpsRoot } from "@/lib/career-ops";

/** Request header set by `proxy.ts` carrying the sanitized active slug. */
const PROFILE_HEADER = "x-co-profile";

/**
 * Multi-profile registry — ports HireSignal's `?profile=slug` routing onto the
 * 2.0 app. A single career-ops checkout can host several candidate "profiles",
 * each with its own data root (cv.md, data/, reports/ …). The registry lives at
 * `<careerOpsRoot>/profiles.yml` and maps a slug → a root directory (relative to
 * the engine root, exactly like the legacy `dashboard-web/server.mjs`).
 *
 *   profiles:
 *     - name: alex
 *       display_name: Alex Doe
 *       root: profiles/alex        # relative to careerOpsRoot()
 *       color: "#0284c7"
 *     - name: jordan
 *       display_name: Jordan
 *       root: profiles/jordan
 *
 * Backwards-compatible: when no registry exists (or a request carries no/invalid
 * `?profile`), callers fall back to the single-profile `careerOpsRoot()`.
 */

export type ProfileEntry = {
  name: string;
  display_name: string;
  root: string; // as written in profiles.yml (relative or absolute)
  color?: string;
};

export type ResolvedProfile = ProfileEntry & {
  /** Absolute, normalized root directory for this profile's data. */
  absoluteRoot: string;
  /** Whether the resolved root directory exists on disk. */
  exists: boolean;
};

/** Slug grammar — same allowlist the legacy server enforced. */
const SLUG_RE = /^[a-z0-9_-]+$/;

export function isValidSlug(slug: string | null | undefined): slug is string {
  return typeof slug === "string" && SLUG_RE.test(slug);
}

/** Absolute path to the registry file (sibling of the user's data). */
export function registryPath(): string {
  return path.join(careerOpsRoot(), "profiles.yml");
}

/** Resolve a profile's declared root (relative → relative to careerOpsRoot()). */
function absoluteRootFor(entryRoot: string): string {
  return path.isAbsolute(entryRoot)
    ? path.normalize(entryRoot)
    : path.resolve(careerOpsRoot(), entryRoot);
}

/**
 * Parse profiles.yml. Returns [] when ABSENT — that is single-profile mode and a
 * perfectly normal state.
 *
 * A file that EXISTS but cannot be read or parsed is NOT that state, and used to
 * be indistinguishable from it: both returned []. requestRoot() then fell through
 * to careerOpsRoot(), so one YAML typo silently served the DEFAULT profile's
 * tracker to a session that had explicitly selected another profile — plausible
 * output, wrong person's data, nothing in the UI to say so. `registryBroken`
 * keeps the two apart so requestRoot() can refuse instead of guessing.
 */
let registryBroken: string | null = null;

/** Why profiles.yml could not be read this process, or null if it is fine/absent. */
export function registryFault(): string | null {
  return registryBroken;
}

export function readRegistry(): ProfileEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(registryPath(), "utf8");
    registryBroken = null;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      registryBroken = null; // absent is the documented single-profile signal
      return [];
    }
    registryBroken = `cannot read ${registryPath()}: ${err?.message ?? String(e)}`;
    console.error(`[profile-registry] ${registryBroken}`);
    return [];
  }
  try {
    const doc = yaml.load(raw) as { profiles?: unknown } | null;
    const list = Array.isArray(doc?.profiles) ? doc!.profiles : [];
    return (list as Record<string, unknown>[])
      .filter((p) => isValidSlug(p?.name as string) && typeof p?.root === "string")
      .map((p) => ({
        name: p.name as string,
        display_name: (p.display_name as string) || (p.name as string),
        root: p.root as string,
        color: typeof p.color === "string" ? (p.color as string) : undefined,
      }));
  } catch (e) {
    registryBroken = `cannot parse ${registryPath()}: ${(e as Error)?.message ?? String(e)}`;
    console.error(`[profile-registry] ${registryBroken}`);
    return [];
  }
}

/** All registered profiles, with resolved absolute roots + existence flags. */
export function listProfiles(): ResolvedProfile[] {
  return readRegistry().map((p) => {
    const absoluteRoot = absoluteRootFor(p.root);
    return { ...p, absoluteRoot, exists: safeExists(absoluteRoot) };
  });
}

/**
 * Resolve a slug to an absolute data root, or `null` when the slug is invalid,
 * unknown, or unregistered. A `null` return means "fall back to careerOpsRoot()".
 */
export function resolveProfileRoot(slug: string | null | undefined): string | null {
  if (!isValidSlug(slug)) return null;
  const entry = readRegistry().find((p) => p.name === slug);
  if (!entry) return null;
  return absoluteRootFor(entry.root);
}

function safeExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** The active slug for the current request, or `null` (single-profile). */
export async function requestSlug(): Promise<string | null> {
  try {
    const slug = (await headers()).get(PROFILE_HEADER);
    return isValidSlug(slug) ? slug : null;
  } catch {
    // headers() throws outside a request scope (e.g. build-time): single-profile.
    return null;
  }
}

/**
 * Resolve the data root for the CURRENT request. Reads the active `?profile`
 * slug (forwarded by middleware as a header), looks it up in the registry, and
 * returns its absolute root. Falls back to `careerOpsRoot()` whenever there is
 * no profile context, the slug is invalid, or it is unregistered — so every
 * single-profile path keeps working unchanged.
 *
 * Use at request entry points (pages / route handlers), then pass the result
 * into the synchronous `@/lib/career-ops` readers.
 */
export async function requestRoot(): Promise<string> {
  const slug = await requestSlug();
  const root = resolveProfileRoot(slug);
  if (root) return root;
  // A slug was explicitly selected but did not resolve, AND the registry is
  // broken rather than absent: falling back to careerOpsRoot() here would serve
  // the DEFAULT profile's data under another profile's name. Refuse instead —
  // an error the user can see beats the wrong person's tracker.
  if (slug && registryFault()) {
    throw new Error(
      `profile "${slug}" selected, but the profile registry is unusable — ${registryFault()}`,
    );
  }
  return careerOpsRoot();
}

/**
 * Environment for spawning a core `.mjs` script under the active profile. The
 * scripts live in the engine root (`careerOpsRoot()`); only the DATA root
 * varies, so we point the child at the profile via `CAREER_OPS_ROOT` — exactly
 * how the legacy dashboard server scoped per-profile subprocess runs.
 */
export async function requestSpawnEnv(
  base: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const root = await requestRoot();
  return { ...base, CAREER_OPS_ROOT: root };
}
