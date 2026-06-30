import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

// A throwaway data root holding config/job-search.yml. The route's scoreJobs()
// reads its config from here (via the real scoring lib), so requestRoot() is
// mocked to resolve this tmp root for every request.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-score-"));

vi.mock("@/lib/profile-registry", () => ({
  requestRoot: vi.fn(async () => ROOT),
}));

import { POST } from "./route";

const configFile = () => path.join(ROOT, "config", "job-search.yml");

// A minimal config that validateJobSearchConfig() accepts: at least one
// demonstrated skill, and search_scopes defaulting to [local, remote].
function writeValidConfig(extra: Record<string, unknown> = {}) {
  fs.mkdirSync(path.join(ROOT, "config"), { recursive: true });
  fs.writeFileSync(
    configFile(),
    yaml.dump({
      skills: { demonstrated: ["kotlin", "android", "compose"] },
      location: { home_country: "India" },
      ...extra,
    }),
    "utf8",
  );
}

const req = (body: unknown) =>
  new Request("http://localhost/api/jobs/score", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  fs.rmSync(path.join(ROOT, "config"), { recursive: true, force: true });
  vi.clearAllMocks();
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("POST /api/jobs/score", () => {
  it("scores a single job passed as `job` against the profile config", async () => {
    writeValidConfig();
    const res = await POST(req({ job: { title: "Android Engineer", company: "Acme", snippet: "Kotlin Compose role" } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.valid).toBe(true);
    expect(Array.isArray(body.jobs)).toBe(true);
    expect(body.jobs).toHaveLength(1);
    // The job came back scored: the scorer attaches a numeric 1..10 score.
    const j = body.jobs[0];
    expect(typeof j.score).toBe("number");
    expect(j.score).toBeGreaterThanOrEqual(1);
    expect(j.score).toBeLessThanOrEqual(10);
    expect(j.company).toBe("Acme");
  });

  it("scores an array of jobs passed as `jobs`, preserving order/count", async () => {
    writeValidConfig();
    const res = await POST(
      req({
        jobs: [
          { title: "Senior Android Dev", company: "Globex", snippet: "Kotlin, Android, Compose" },
          { title: "Backend Engineer", company: "Initech", snippet: "Go microservices" },
        ],
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.valid).toBe(true);
    expect(body.jobs).toHaveLength(2);
    expect(body.jobs.map((j: { company: string }) => j.company)).toEqual(["Globex", "Initech"]);
    // The skill-heavy first job should out-score the unrelated backend role.
    expect(body.jobs[0].score).toBeGreaterThan(body.jobs[1].score);
  });

  it("matched skills surface from the config: a Kotlin/Android job lists them", async () => {
    writeValidConfig();
    const res = await POST(req({ job: { title: "Android role", snippet: "We use Kotlin and Compose daily" } }));
    const body = await res.json();
    expect(body.valid).toBe(true);
    const matched: string[] = body.jobs[0].matchedSkills;
    expect(matched).toEqual(expect.arrayContaining(["kotlin", "compose"]));
  });

  it("returns 422 with validation errors when the profile config is INVALID", async () => {
    // No demonstrated/confirmed_unlisted skill -> validateJobSearchConfig fails.
    fs.mkdirSync(path.join(ROOT, "config"), { recursive: true });
    fs.writeFileSync(configFile(), yaml.dump({ location: { home_country: "India" } }), "utf8");
    const res = await POST(req({ job: { title: "Anything" } }));
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body.valid).toBe(false);
    expect(body.jobs).toEqual([]);
    expect(body.errors.join(" ")).toContain("skills must contain at least one");
  });

  it("treats an absent config file as invalid (missing skills -> 422)", async () => {
    // No config/ dir at all: loadRawJobSearchConfig returns {} -> validation fails.
    const res = await POST(req({ job: { title: "Anything" } }));
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body.valid).toBe(false);
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it("rejects malformed JSON with 400 'bad json'", async () => {
    writeValidConfig();
    const res = await POST(req("{ not valid json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad json" });
  });

  it("rejects a body with neither `job` nor `jobs` with 400", async () => {
    writeValidConfig();
    const res = await POST(req({ foo: "bar" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("provide");
  });

  it("rejects an empty `jobs` array with 400", async () => {
    writeValidConfig();
    const res = await POST(req({ jobs: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("provide");
  });

  it("prefers `jobs` over `job` when both are present", async () => {
    writeValidConfig();
    const res = await POST(
      req({
        jobs: [{ title: "From array", company: "ArrCo" }],
        job: { title: "From single", company: "SingleCo" },
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].company).toBe("ArrCo");
  });

  it("is profile-aware: warnings from config flow through (empty home_country warns)", async () => {
    // Valid (has demonstrated skill) but home_country empty -> a warning, still 200.
    fs.mkdirSync(path.join(ROOT, "config"), { recursive: true });
    fs.writeFileSync(configFile(), yaml.dump({ skills: { demonstrated: ["kotlin"] } }), "utf8");
    const res = await POST(req({ job: { title: "x", snippet: "kotlin" } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.valid).toBe(true);
    expect(body.warnings.join(" ")).toContain("home_country");
  });
});
