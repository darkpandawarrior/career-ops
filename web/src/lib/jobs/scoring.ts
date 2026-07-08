import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { scoreJob, normalizeJob } from "@/lib/scoring/scorer.mjs";
import { validateJobSearchConfig } from "@/lib/search/config-schema.mjs";
import { buildSearchPlan } from "@/lib/search/query-builder.mjs";
import { careerOpsRoot } from "@/lib/career-ops";
import type { ConfigValidation, RawJob, ScoredJob, SearchPlan } from "@/lib/jobs/types";

/**
 * Scoring engine — the library boundary over the vendored pure-function .mjs.
 *
 * The legacy HireSignal dashboard scored jobs client-side; the 2.0 app delegated
 * scoring to the CLI. This restores deterministic, server-side scoring by
 * importing the SAME pure functions directly (no subprocess), driven by the
 * active profile's `config/job-search.yml`. Every entry is profile-aware via an
 * explicit `root` (default `careerOpsRoot()` → single-profile back-compat).
 */

/** Read + parse `config/job-search.yml` (the raw, un-normalized config). */
export function loadRawJobSearchConfig(root: string = careerOpsRoot()): unknown {
  const file = path.join(root, "config", "job-search.yml");
  try {
    const value = yaml.load(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/** Validate the active profile's job-search config. */
export function validateConfig(root: string = careerOpsRoot()): ConfigValidation {
  return validateJobSearchConfig(loadRawJobSearchConfig(root));
}

export interface ScoreResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  jobs: ScoredJob[];
}

/**
 * Score a batch of raw jobs against the active profile. When the config is
 * invalid the jobs come back unscored with the validation errors attached, so
 * the caller can surface "fix your config" rather than emit meaningless scores.
 */
export function scoreJobs(jobs: RawJob[], root: string = careerOpsRoot()): ScoreResult {
  const v = validateConfig(root);
  if (!v.valid) return { valid: false, errors: v.errors, warnings: v.warnings, jobs: [] };
  const scored = (Array.isArray(jobs) ? jobs : []).map((j) => normalizeJob(j, v.config));
  return { valid: true, errors: [], warnings: v.warnings, jobs: scored };
}

/** Score one raw job (thin convenience over the pure `scoreJob`). */
export function scoreOne(job: RawJob, root: string = careerOpsRoot()): ScoredJob {
  return scoreJob(job, loadRawJobSearchConfig(root));
}

/** The generated search plan for the active profile, or null if config invalid. */
export function searchPlan(root: string = careerOpsRoot()): SearchPlan | null {
  const v = validateConfig(root);
  return v.valid ? buildSearchPlan(v.config) : null;
}

export interface JobDashboard {
  generatedAt: string | null;
  jobs: ScoredJob[];
  stats: { total: number; excellent: number; sources: number };
  searchConfig: { valid: boolean; errors: string[]; warnings: string[] };
  searchPlan: SearchPlan["summary"] | null;
  diagnostics: { note: string; feedErrors: unknown[] };
}

type RawCache = {
  jobs?: RawJob[];
  scored?: boolean;
  generatedAt?: string | null;
  diagnostics?: { note?: string; feedErrors?: unknown[] };
};

/** Read `data/job-dashboard.json` for a root, or null when absent/unreadable. */
function readCache(root: string): RawCache | null {
  const file = path.join(root, "data", "job-dashboard.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as RawCache;
  } catch {
    return null;
  }
}

/**
 * Build the scored job dashboard for the active profile — the read path that
 * ports `dashboard-web/server.mjs#buildDashboardPayload`: read the cached job
 * feed, (re)score it against the current config unless the cache is already
 * marked `scored`, and compute the headline stats. Pure read (never writes).
 */
export function jobDashboard(root: string = careerOpsRoot()): JobDashboard {
  const v = validateConfig(root);
  const cached = readCache(root);
  const jobs: ScoredJob[] =
    Array.isArray(cached?.jobs) && v.valid
      ? cached!.scored === true
        ? (cached!.jobs as ScoredJob[])
        : cached!.jobs.map((job) => normalizeJob(job, v.config))
      : [];
  const plan = v.valid ? buildSearchPlan(v.config) : null;
  const realJobs = jobs.filter((j) => j.type !== "searchLead");
  return {
    generatedAt: cached?.generatedAt ?? null,
    jobs,
    stats: {
      total: realJobs.length,
      excellent: realJobs.filter((j) => Number(j.score) >= 8).length,
      sources: jobs.filter((j) => j.type === "searchLead").length,
    },
    searchConfig: { valid: v.valid, errors: v.errors, warnings: v.warnings },
    searchPlan: plan?.summary ?? null,
    diagnostics: {
      note: cached?.diagnostics?.note
        ?? (v.valid
          ? plan
            ? `Profile-driven scoring is active with ${plan.summary.queries} generated search queries.`
            : "Profile-driven scoring is active."
          : `Job-search configuration needs review: ${v.errors.join("; ")}`),
      feedErrors: cached?.diagnostics?.feedErrors ?? [],
    },
  };
}
