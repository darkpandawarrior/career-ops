import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A throwaway profile root. requestRoot() (from profile-registry) is mocked to
// return this dir so the route reads our fixture coaching_state.md, never the
// user's real interview-coach data.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "co-coach-route-"));

vi.mock("@/lib/profile-registry", () => ({
  requestRoot: vi.fn(async () => TMP),
}));

// careerOpsRoot is mocked away from the user's real engine root so the coach
// module's global-sibling fallback (only fires when root === careerOpsRoot())
// is never triggered against real disk. TMP !== this value, so our profile-local
// resolution path is the one under test.
vi.mock("@/lib/career-ops", () => ({
  careerOpsRoot: () => path.join(TMP, "__engine_root_never_equals_tmp__"),
}));

import { GET } from "./route";

const statePath = () => path.join(TMP, "coaching_state.md");

function clearState() {
  fs.rmSync(statePath(), { force: true });
}

beforeEach(() => {
  clearState();
});

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

// A coaching_state.md that exercises every parsed section.
const FULL_STATE = `# Coaching State

## Profile
- 5+ years Android
- Targets Lead roles

## Storybank
| ID | Title | Skill | Skill2 | Metric | Strength |
| --- | --- | --- | --- | --- | --- |
| S1 | GPS rewrite | Location | Sensors | 50->95% | high |
| S2 | Theme engine | Compose | DI | 60% friction | medium |

#### S1 — GPS rewrite
Drove accuracy from 50% to 95% using dead reckoning.
Foreground service + floating bubble.

#### S2 — Theme engine
Cut UI dev friction 60% with a custom theme engine.

## Outcome Log
| Date | Company | Role | Round | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-06-01 | Plum | SDE-2 | R1 | pass | strong system design |
| 2026-06-10 | Upstox | Lead | R1 | pending | fit call |

## Interview Intelligence

### Question Bank
| Date | Company | Type | Round | Question | Competency | Signal | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-06-01 | Plum | tech | R1 | Explain StateFlow vs SharedFlow | coroutines | clear | pass |

### Effective Patterns (what works for this candidate)
- Leading with metrics
- Connecting to production codebase

### Ineffective Patterns (what keeps not working)
- Over-explaining trivia

#### Plum
Focuses on system design depth and offline-first.

#### Upstox
Heavy on Kotlin internals.

## Interview Loops (active)
- Plum R2 awaiting
- Upstox R1 today

## Active Coaching Strategy
- Drill flows weekly
- Quiz after every topic

## Coaching Notes
- Candidate prefers Lead-level depth

## Session Log
| 2026-06-01 | quiz, drill | passed flow gate |
| 2026-06-10 | story review | tightened S1 |

## Drill Progression
Current stage: stage-3
Revisit queue: coroutines, hilt
Gates passed: flows, compose
`;

describe("GET /api/coach — no state", () => {
  it("returns {available:false, coach:null} when no coaching_state.md exists", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ available: false, coach: null });
  });
});

describe("GET /api/coach — with state", () => {
  beforeEach(() => {
    fs.writeFileSync(statePath(), FULL_STATE, "utf8");
  });

  it("reports available:true and a non-null coach object", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.coach).not.toBeNull();
  });

  it("parses the Storybank table (5th column skipped, strength is last)", async () => {
    const { coach } = await (await GET()).json();
    expect(coach.stories).toEqual([
      { id: "S1", title: "GPS rewrite", skill: "Location", skill2: "Sensors", strength: "high" },
      { id: "S2", title: "Theme engine", skill: "Compose", skill2: "DI", strength: "medium" },
    ]);
  });

  it("parses per-story details keyed by story id", async () => {
    const { coach } = await (await GET()).json();
    expect(Object.keys(coach.details).sort()).toEqual(["S1", "S2"]);
    expect(coach.details.S1.title).toBe("GPS rewrite");
    expect(coach.details.S1.body).toContain("dead reckoning");
    expect(coach.details.S2.body).toContain("theme engine");
  });

  it("parses the Outcome Log rows and skips header/separator", async () => {
    const { coach } = await (await GET()).json();
    expect(coach.outcomes).toEqual([
      { date: "2026-06-01", company: "Plum", role: "SDE-2", round: "R1", result: "pass", notes: "strong system design" },
      { date: "2026-06-10", company: "Upstox", role: "Lead", round: "R1", result: "pending", notes: "fit call" },
    ]);
  });

  it("parses the Question Bank (date, company, round=col3, question, competency, outcome=col7)", async () => {
    const { coach } = await (await GET()).json();
    expect(coach.questions).toEqual([
      {
        date: "2026-06-01",
        company: "Plum",
        round: "R1",
        question: "Explain StateFlow vs SharedFlow",
        competency: "coroutines",
        outcome: "pass",
      },
    ]);
  });

  it("parses company patterns from #### blocks under Interview Intelligence", async () => {
    const { coach } = await (await GET()).json();
    const companies = coach.companyPatterns.map((c: { company: string }) => c.company);
    expect(companies).toContain("Plum");
    expect(companies).toContain("Upstox");
    const plum = coach.companyPatterns.find((c: { company: string }) => c.company === "Plum");
    expect(plum.body).toContain("offline-first");
  });

  it("parses the Session Log rows (date must start with 4 digits)", async () => {
    const { coach } = await (await GET()).json();
    expect(coach.sessionLog).toEqual([
      { date: "2026-06-01", commands: "quiz, drill", outcomes: "passed flow gate" },
      { date: "2026-06-10", commands: "story review", outcomes: "tightened S1" },
    ]);
  });

  it("parses bullet-based sections (loops, profile, strategy, notes)", async () => {
    const { coach } = await (await GET()).json();
    expect(coach.loops).toEqual(["Plum R2 awaiting", "Upstox R1 today"]);
    expect(coach.profileBullets).toEqual(["5+ years Android", "Targets Lead roles"]);
    expect(coach.strategy).toEqual(["Drill flows weekly", "Quiz after every topic"]);
    expect(coach.coachingNotes).toEqual(["Candidate prefers Lead-level depth"]);
  });

  it("parses effective/ineffective patterns from Interview Intelligence subsections", async () => {
    const { coach } = await (await GET()).json();
    expect(coach.effectivePatterns).toEqual(["Leading with metrics", "Connecting to production codebase"]);
    expect(coach.ineffectivePatterns).toEqual(["Over-explaining trivia"]);
  });

  it("parses the Drill Progression stage/queue/gates", async () => {
    const { coach } = await (await GET()).json();
    expect(coach.drillStage).toBe("stage-3");
    expect(coach.drillQueue).toBe("coroutines, hilt");
    expect(coach.gatesPassed).toBe("flows, compose");
  });
});

describe("GET /api/coach — sparse / edge state", () => {
  it("returns available:true with empty collections for a near-empty file", async () => {
    fs.writeFileSync(statePath(), "# Coaching State\n\nNo sections here.\n", "utf8");
    const { available, coach } = await (await GET()).json();
    expect(available).toBe(true);
    expect(coach.stories).toEqual([]);
    expect(coach.outcomes).toEqual([]);
    expect(coach.questions).toEqual([]);
    expect(coach.companyPatterns).toEqual([]);
    expect(coach.sessionLog).toEqual([]);
    expect(coach.loops).toEqual([]);
    expect(coach.profileBullets).toEqual([]);
    // Drill defaults when the section is absent.
    expect(coach.drillStage).toBe("?");
    expect(coach.drillQueue).toBe("");
    expect(coach.gatesPassed).toBe("");
  });

  it("strips ~~strikethrough~~ markers from story title/skill cells", async () => {
    fs.writeFileSync(
      statePath(),
      [
        "## Storybank",
        "| ID | Title | Skill | Skill2 | Metric | Strength |",
        "| --- | --- | --- | --- | --- | --- |",
        "| S9 | ~~Old story~~ | ~~Legacy~~ | DI | x | low |",
        "",
      ].join("\n"),
      "utf8",
    );
    const { coach } = await (await GET()).json();
    expect(coach.stories[0]).toEqual({
      id: "S9",
      title: "Old story",
      skill: "Legacy",
      skill2: "DI",
      strength: "low",
    });
  });
});
