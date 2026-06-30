import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * scoring.ts is the library boundary over the vendored pure-function scorer.
 * Every export takes an explicit `root`, defaulting to careerOpsRoot(). We mock
 * careerOpsRoot() to a known tmp tree (so the default-arg path is exercised too)
 * and write real fixtures under tmpdir for config/job-search.yml and
 * data/job-dashboard.json. No real profiles/ or data/ is ever read.
 */

// A throwaway engine root used as the careerOpsRoot() default. Individual tests
// usually pass an explicit per-test root, but mocking the default keeps any
// default-arg code path off the user's real checkout.
const DEFAULT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-scoring-default-"));
vi.mock("@/lib/career-ops", () => ({ careerOpsRoot: () => DEFAULT_ROOT }));

import {
  loadRawJobSearchConfig,
  validateConfig,
  scoreJobs,
  scoreOne,
  searchPlan,
  jobDashboard,
} from "./scoring";

// A minimal-but-valid job-search.yml body (YAML). Valid requires at least one
// demonstrated/confirmed_unlisted skill and a non-empty search scope.
const VALID_YAML = `titles:
  strong:
    - Android Engineer
skills:
  demonstrated:
    - Kotlin
    - Jetpack Compose
  supporting:
    - Hilt
seniority:
  minimum_years: 3
  maximum_years: 8
availability:
  notice_period: "30 days"
location:
  home_country: India
  search_scopes:
    - local
    - remote
`;

// A YAML that parses but is INVALID per the schema: no skills at all.
const INVALID_YAML = `titles:
  strong:
    - Android Engineer
location:
  search_scopes:
    - local
`;

const roots: string[] = [];

/** Make a fresh tmp root, optionally writing config/job-search.yml. */
function makeRoot(opts: { yml?: string } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-scoring-"));
  roots.push(root);
  if (opts.yml !== undefined) {
    fs.mkdirSync(path.join(root, "config"), { recursive: true });
    fs.writeFileSync(path.join(root, "config", "job-search.yml"), opts.yml);
  }
  return root;
}

/** Write data/job-dashboard.json under a root (string passes through verbatim). */
function writeCache(root: string, body: unknown): void {
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  const text = typeof body === "string" ? body : JSON.stringify(body);
  fs.writeFileSync(path.join(root, "data", "job-dashboard.json"), text);
}

const STRONG_JOB = {
  title: "Senior Android Engineer",
  company: "Acme",
  url: "https://acme.com/jobs/1",
  snippet: "Kotlin Jetpack Compose Hilt 5 years experience",
};

afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(() => {
  for (const r of [...roots, DEFAULT_ROOT]) fs.rmSync(r, { recursive: true, force: true });
});

describe("loadRawJobSearchConfig", () => {
  it("reads and parses config/job-search.yml into an object", () => {
    const root = makeRoot({ yml: VALID_YAML });
    const cfg = loadRawJobSearchConfig(root) as Record<string, unknown>;
    expect(cfg).toMatchObject({ skills: { demonstrated: ["Kotlin", "Jetpack Compose"] } });
  });

  it("returns {} when the file is missing", () => {
    const root = makeRoot(); // no config written
    expect(loadRawJobSearchConfig(root)).toEqual({});
  });

  it("returns {} on malformed YAML rather than throwing", () => {
    const root = makeRoot({ yml: "this: : : not valid yaml: [" });
    expect(loadRawJobSearchConfig(root)).toEqual({});
  });

  it("returns {} when the YAML parses to a non-object (e.g. a bare scalar)", () => {
    const root = makeRoot({ yml: "42\n" });
    expect(loadRawJobSearchConfig(root)).toEqual({});
  });

  it("defaults root to careerOpsRoot() (mocked) â€” empty default tree yields {}", () => {
    expect(loadRawJobSearchConfig()).toEqual({});
  });
});

describe("validateConfig", () => {
  it("reports valid for a well-formed config", () => {
    const root = makeRoot({ yml: VALID_YAML });
    const v = validateConfig(root);
    expect(v.valid).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.config.skills.demonstrated).toContain("Kotlin");
  });

  it("reports invalid with the skills error when no skills are present", () => {
    const root = makeRoot({ yml: INVALID_YAML });
    const v = validateConfig(root);
    expect(v.valid).toBe(false);
    expect(v.errors).toContain(
      "skills must contain at least one skill",
    );
  });

  it("missing config file => invalid (normalized empty config fails the skills rule)", () => {
    const root = makeRoot();
    const v = validateConfig(root);
    expect(v.valid).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
  });
});

describe("scoreJobs", () => {
  it("scores a batch against a valid config (strong job => Excellent/recommended)", () => {
    const root = makeRoot({ yml: VALID_YAML });
    const res = scoreJobs([STRONG_JOB], root);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.jobs).toHaveLength(1);
    const job = res.jobs[0];
    expect(job.score).toBe(9);
    expect(job.level).toBe("Excellent");
    expect(job.section).toBe("recommended");
    expect(job.id).toBeTruthy(); // normalizeJob assigns a stable id
  });

  it("returns no jobs and surfaces errors when the config is invalid", () => {
    const root = makeRoot({ yml: INVALID_YAML });
    const res = scoreJobs([STRONG_JOB], root);
    expect(res.valid).toBe(false);
    expect(res.jobs).toEqual([]);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it("tolerates a non-array `jobs` argument (treats it as empty)", () => {
    const root = makeRoot({ yml: VALID_YAML });
    // @ts-expect-error deliberately passing the wrong type
    const res = scoreJobs(null, root);
    expect(res.valid).toBe(true);
    expect(res.jobs).toEqual([]);
  });

  it("returns an empty job list for an empty input batch", () => {
    const root = makeRoot({ yml: VALID_YAML });
    expect(scoreJobs([], root).jobs).toEqual([]);
  });
});

describe("scoreOne", () => {
  it("scores a single job via the raw config (no validation gate)", () => {
    const root = makeRoot({ yml: VALID_YAML });
    const job = scoreOne(STRONG_JOB, root);
    expect(job.score).toBe(9);
    expect(job.level).toBe("Excellent");
    expect(Array.isArray(job.reasons)).toBe(true);
  });

  it("still scores (low) when config is empty â€” scoreOne does not gate on validity", () => {
    const root = makeRoot(); // no config => loadRawJobSearchConfig returns {}
    const job = scoreOne(STRONG_JOB, root);
    expect(typeof job.score).toBe("number");
    expect(job.score).toBeGreaterThanOrEqual(1);
    expect(job.score).toBeLessThanOrEqual(10);
  });
});

describe("searchPlan", () => {
  it("returns a plan summary for a valid config", () => {
    const root = makeRoot({ yml: VALID_YAML });
    const plan = searchPlan(root);
    expect(plan).not.toBeNull();
    expect(plan!.summary.queries).toBeGreaterThan(0);
    expect(plan!.summary).toMatchObject({ verifiedSkills: 2, supportingSkills: 1 });
  });

  it("returns null when the config is invalid", () => {
    const root = makeRoot({ yml: INVALID_YAML });
    expect(searchPlan(root)).toBeNull();
  });
});

describe("jobDashboard", () => {
  it("re-scores an unscored cache against the active config and computes stats", () => {
    const root = makeRoot({ yml: VALID_YAML });
    writeCache(root, {
      generatedAt: "2026-06-01T00:00:00.000Z",
      jobs: [STRONG_JOB],
      // no `scored: true` => must (re)score via normalizeJob
    });
    const d = jobDashboard(root);
    expect(d.generatedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(d.jobs).toHaveLength(1);
    expect(d.jobs[0].score).toBe(9); // proves it scored (raw jobs have no score)
    expect(d.stats.total).toBe(1);
    expect(d.stats.excellent).toBe(1); // score >= 8
    expect(d.stats.sources).toBe(0);
    expect(d.searchConfig.valid).toBe(true);
    expect(d.searchPlan?.queries).toBeGreaterThan(0);
  });

  it("passes through an already-scored cache verbatim (no re-scoring)", () => {
    const root = makeRoot({ yml: VALID_YAML });
    // A pre-scored job with a sentinel score the scorer would never produce
    // from this empty-text job; if it survives, the cache was trusted.
    const preScored = { id: "x1", type: "job", title: "Whatever", score: 9, foo: "bar" };
    writeCache(root, { scored: true, jobs: [preScored] });
    const d = jobDashboard(root);
    expect(d.jobs[0]).toMatchObject({ id: "x1", score: 9, foo: "bar" });
    expect(d.stats.total).toBe(1);
    expect(d.stats.excellent).toBe(1); // 9 >= 8
  });

  it("counts searchLead entries as sources and excludes them from total/excellent", () => {
    const root = makeRoot({ yml: VALID_YAML });
    writeCache(root, {
      scored: true,
      jobs: [
        { id: "s1", type: "searchLead", score: 3 },
        { id: "j1", type: "job", score: 8 },
        { id: "j2", type: "job", score: 5 },
      ],
    });
    const d = jobDashboard(root);
    expect(d.stats.sources).toBe(1);
    expect(d.stats.total).toBe(2); // only the two real jobs
    expect(d.stats.excellent).toBe(1); // only j1 (8 >= 8)
  });

  it("returns an empty dashboard when the cache file is missing", () => {
    const root = makeRoot({ yml: VALID_YAML });
    const d = jobDashboard(root);
    expect(d.generatedAt).toBeNull();
    expect(d.jobs).toEqual([]);
    expect(d.stats).toEqual({ total: 0, excellent: 0, sources: 0 });
    expect(d.searchConfig.valid).toBe(true);
    // valid config + no cache note => the default profile-driven note is used
    expect(d.diagnostics.note).toContain("Profile-driven scoring is active");
    expect(d.diagnostics.feedErrors).toEqual([]);
  });

  it("yields no jobs when the config is invalid, and a 'needs review' note", () => {
    const root = makeRoot({ yml: INVALID_YAML });
    writeCache(root, { jobs: [STRONG_JOB] }); // present but unusable: config invalid
    const d = jobDashboard(root);
    expect(d.jobs).toEqual([]);
    expect(d.searchConfig.valid).toBe(false);
    expect(d.searchPlan).toBeNull();
    expect(d.diagnostics.note).toContain("Job-search configuration needs review");
  });

  it("treats malformed cache JSON as absent (no throw, empty jobs)", () => {
    const root = makeRoot({ yml: VALID_YAML });
    writeCache(root, "{ this is not valid json ");
    const d = jobDashboard(root);
    expect(d.jobs).toEqual([]);
    expect(d.generatedAt).toBeNull();
    expect(d.stats.total).toBe(0);
  });

  it("treats a cache whose `jobs` is not an array as empty", () => {
    const root = makeRoot({ yml: VALID_YAML });
    writeCache(root, { generatedAt: "2026-06-02T00:00:00.000Z", jobs: "nope" });
    const d = jobDashboard(root);
    expect(d.jobs).toEqual([]);
    // generatedAt still surfaces from the (parseable) cache object
    expect(d.generatedAt).toBe("2026-06-02T00:00:00.000Z");
  });

  it("prefers an explicit cache diagnostics note and surfaces feedErrors", () => {
    const root = makeRoot({ yml: VALID_YAML });
    writeCache(root, {
      scored: true,
      jobs: [],
      diagnostics: { note: "custom note from feed", feedErrors: [{ source: "greenhouse", error: "timeout" }] },
    });
    const d = jobDashboard(root);
    expect(d.diagnostics.note).toBe("custom note from feed");
    expect(d.diagnostics.feedErrors).toEqual([{ source: "greenhouse", error: "timeout" }]);
  });

  it("coerces non-numeric `score` to NaN for the excellent count (Number(undefined) >= 8 is false)", () => {
    const root = makeRoot({ yml: VALID_YAML });
    writeCache(root, {
      scored: true,
      jobs: [
        { id: "a", type: "job" }, // no score => Number(undefined)=NaN, not excellent
        { id: "b", type: "job", score: "8" }, // numeric string coerces to 8
      ],
    });
    const d = jobDashboard(root);
    expect(d.stats.total).toBe(2);
    expect(d.stats.excellent).toBe(1); // only "b"
  });
});

