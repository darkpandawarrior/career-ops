/**
 * Types for the vendored scoring engine (web/src/lib/{scoring,search}/*.mjs).
 * The .mjs files are byte-identical copies of dashboard-web/{scoring,search} —
 * these types describe their public surface so the TS app type-checks without
 * touching the (intentionally unmodified) JavaScript. See scoring/VENDORED.md.
 */

/** A raw job posting fed into the scorer (all fields optional / best-effort). */
export interface RawJob {
  id?: string;
  type?: string;
  title?: string;
  company?: string;
  location?: string;
  url?: string;
  source?: string;
  sourceCategory?: string;
  snippet?: string;
  description?: string;
  compensation?: unknown;
  salary?: unknown;
}

/** A scored job. The scorer attaches many derived fields; the ones the UI is
 *  most likely to read are typed explicitly, the rest are open via the index. */
export interface ScoredJob extends RawJob {
  id?: string;
  score: number;
  scoreRaw: number;
  level: "Excellent" | "Strong" | "Possible" | "Low";
  priority: string;
  urgency: string;
  matchedSkills: string[];
  supportingSkills: string[];
  learningSkills: string[];
  recommendedSkillGaps: string[];
  excludedSkillMatches: string[];
  skillMatchCount: number;
  reasons: string[];
  gates: string[];
  section?: "sources" | "recommended" | "review";
  [key: string]: unknown;
}

/** The normalized job-search config (output of normalizeJobSearchConfig). */
export interface JobSearchConfig {
  titles: { strong: string[]; adjacent: string[]; exclude: string[] };
  skills: {
    demonstrated: string[];
    confirmed_unlisted: string[];
    supporting: string[];
    learning: string[];
    recommended_gaps: string[];
    excluded: string[];
  };
  seniority: {
    minimum_years: number | null;
    maximum_years: number | null;
    preferred_levels: string[];
  };
  availability: { notice_period: string };
  location: Record<string, unknown> & {
    home_country: string;
    search_scopes: string[];
    visa_sponsorship_required: boolean;
    remote_eligibility_required: boolean;
  };
  compensation: Record<string, unknown>;
  preferences: Record<string, unknown>;
  weights: { skills: number; experience: number; availability: number };
}

/** Result of validateJobSearchConfig. */
export interface ConfigValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  config: JobSearchConfig;
}

/** Output of buildSearchPlan — loosely typed (summary is what the UI reads). */
export interface SearchPlan {
  summary: { queries: number } & Record<string, unknown>;
  [key: string]: unknown;
}
