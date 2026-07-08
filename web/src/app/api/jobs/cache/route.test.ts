import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as yaml from "js-yaml";

// A throwaway profile root. requestRoot() (from profile-registry) is mocked to
// return it directly so the route reads data/job-dashboard.json + config/
// job-search.yml from this hermetic tmp tree — never the user's real data.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "co-jobs-cache-route-"));

vi.mock("@/lib/profile-registry", () => ({ requestRoot: vi.fn(async () => TMP) }));

import { GET } from "./route";

const dashPath = () => path.join(TMP, "data", "job-dashboard.json");
const configPath = () => path.join(TMP, "config", "job-search.yml");

// A minimal config that passes validateJobSearchConfig (one demonstrated skill;
// search scopes default to local+remote so no international_locations needed).
function writeValidConfig() {
  fs.mkdirSync(path.join(TMP, "config"), { recursive: true });
  fs.writeFileSync(
    configPath(),
    yaml.dump({
      titles: { strong: ["Senior Android Engineer"] },
      skills: { demonstrated: ["Kotlin", "Jetpack Compose"] },
      location: { home_country: "India", preferred_locations: ["Pune"] },
      seniority: { minimum_years: 5 },
    }),
    "utf8",
  );
}

function writeCache(payload: unknown) {
  fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
  fs.writeFileSync(dashPath(), JSON.stringify(payload), "utf8");
}

beforeEach(() => {
  // Start each test from a clean profile tree.
  fs.rmSync(path.join(TMP, "data"), { recursive: true, force: true });
  fs.rmSync(path.join(TMP, "config"), { recursive: true, force: true });
});

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("GET /api/jobs/cache", () => {
  it("scores cached jobs and returns headline stats with a valid config", async () => {
    writeValidConfig();
    writeCache({
      generatedAt: "2026-06-30T00:00:00.000Z",
      jobs: [
        { title: "Senior Android Engineer", company: "Acme", url: "https://acme.test/a", snippet: "Kotlin Jetpack Compose 5 years" },
        { title: "Backend Engineer", company: "Beta", url: "https://beta.test/b", snippet: "Go microservices" },
        { type: "searchLead", title: "LinkedIn search", url: "https://linkedin.test/s" },
      ],
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.generatedAt).toBe("2026-06-30T00:00:00.000Z");
    expect(body.searchConfig.valid).toBe(true);
    // jobs array carries every entry (real jobs + the searchLead).
    expect(body.jobs).toHaveLength(3);
    // Each scored job got an id + numeric score from the scorer.
    for (const j of body.jobs) {
      expect(typeof j.id).toBe("string");
      expect(typeof j.score).toBe("number");
    }
    // Stats exclude the searchLead from the real-job total and count it as a source.
    expect(body.stats.total).toBe(2);
    expect(body.stats.sources).toBe(1);
    expect(typeof body.stats.excellent).toBe("number");
    expect(body.stats.excellent).toBeLessThanOrEqual(body.stats.total);
  });

  it("returns empty jobs + zeroed stats when the cache file is missing", async () => {
    writeValidConfig();
    // No data/job-dashboard.json written.

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.jobs).toEqual([]);
    expect(body.stats).toEqual({ total: 0, excellent: 0, sources: 0 });
    expect(body.generatedAt).toBeNull();
    // Config is valid so no errors surfaced.
    expect(body.searchConfig.valid).toBe(true);
    expect(body.searchConfig.errors).toEqual([]);
  });

  it("returns empty jobs for an empty jobs array", async () => {
    writeValidConfig();
    writeCache({ generatedAt: null, jobs: [] });

    const res = await GET();
    const body = await res.json();

    expect(body.jobs).toEqual([]);
    expect(body.stats).toEqual({ total: 0, excellent: 0, sources: 0 });
  });

  it("honors a pre-scored cache (scored:true) — does not re-score, passes jobs through", async () => {
    writeValidConfig();
    const preScored = [
      { id: "x1", type: "job", title: "Pre-scored role", company: "C", url: "u", score: 9, level: "Excellent" },
    ];
    writeCache({ generatedAt: "t", jobs: preScored, scored: true });

    const res = await GET();
    const body = await res.json();

    // Passed through verbatim (the synthetic score:9 survives because scored:true).
    expect(body.jobs).toEqual(preScored);
    expect(body.stats.total).toBe(1);
    expect(body.stats.excellent).toBe(1); // score 9 >= 8
  });

  it("forwards cache diagnostics (note + feedErrors) when present", async () => {
    writeValidConfig();
    writeCache({
      generatedAt: "t",
      jobs: [],
      diagnostics: { note: "custom note from feed", feedErrors: [{ source: "x", error: "timeout" }] },
    });

    const res = await GET();
    const body = await res.json();

    expect(body.diagnostics.note).toBe("custom note from feed");
    expect(body.diagnostics.feedErrors).toEqual([{ source: "x", error: "timeout" }]);
  });

  it("yields empty jobs and surfaces errors when the config is invalid", async () => {
    // Config present but missing the required skills -> validation fails.
    fs.mkdirSync(path.join(TMP, "config"), { recursive: true });
    fs.writeFileSync(configPath(), yaml.dump({ titles: { strong: ["X"] } }), "utf8");
    writeCache({
      generatedAt: "t",
      jobs: [{ title: "Role", company: "C", url: "https://c.test/1" }],
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.searchConfig.valid).toBe(false);
    expect(body.searchConfig.errors.length).toBeGreaterThan(0);
    // Invalid config => no jobs scored even though the cache had one.
    expect(body.jobs).toEqual([]);
    expect(body.stats.total).toBe(0);
  });

  it("treats a malformed (non-JSON) cache file as no cache", async () => {
    writeValidConfig();
    fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
    fs.writeFileSync(dashPath(), "{ not valid json", "utf8");

    const res = await GET();
    const body = await res.json();

    expect(body.jobs).toEqual([]);
    expect(body.generatedAt).toBeNull();
  });

  it("is profile-scoped: reads from the requestRoot tmp tree only", async () => {
    // Sanity: the route must read the mocked TMP root, not any real profile.
    writeValidConfig();
    writeCache({ generatedAt: "scoped", jobs: [] });
    const res = await GET();
    const body = await res.json();
    expect(body.generatedAt).toBe("scoped");
    expect(fs.existsSync(dashPath())).toBe(true);
  });
});
