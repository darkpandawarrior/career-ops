import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A throwaway engine root. careerOpsRoot() is mocked to point here so coach.ts'
// global-fallback branch (only valid for the engine-root profile) can be exercised
// deterministically against a known tree.
const ENGINE = fs.mkdtempSync(path.join(os.tmpdir(), "co-coach-engine-"));
vi.mock("@/lib/career-ops", () => ({ careerOpsRoot: () => ENGINE }));

import { readCoachState } from "./coach";

// A fully-populated coaching_state.md fixture. Section headers match exactly what
// coach.ts parses. NOTE: the LAST section in the file is "Coaching Notes" — this
// exercises the sectionOf() end-of-file lookahead `$(?![\s\S])`.
const FULL_STATE = `# Coaching State

## Profile
- 5+ years Android, targeting Lead
- Strong on Compose + Room
- Weak on system design under pressure

## Storybank

| ID | Title | Skill | Skill2 | Extra | Strength |
| --- | --- | --- | --- | --- | --- |
| S1 | Dead Reckoning | Location | Sensors | meta | strong |
| S2 | ~~Theme Engine~~ | ~~Compose~~ | ~~Design~~ | meta | medium |
| S3 | Room Migrations | Room | SQL | meta | strong |

#### S1 — Predictive Dead Reckoning
Drove GPS accuracy from 50% to 95% using sensor fusion.
Multi-line body for S1.

#### S2 — Theme Engine
Cut UI friction 60% with a custom theme engine.

## Outcome Log

| Date | Company | Role | Round | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-01-10 | Plum | SDE-2 | R1 | pass | clean DSA |
| 2026-02-14 | Upstox | Lead | R1 | pending | fit call |

## Interview Loops (active)
- Plum — awaiting R2
- Upstox — R1 fit call

## Active Coaching Strategy
- Lead with metrics in every story
- Slow down on system design

## Interview Intelligence

### Question Bank

| Date | Company | Role | Round | Question | Competency | Difficulty | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-01-10 | Plum | SDE-2 | R1 | Explain StateFlow vs SharedFlow | Coroutines | med | nailed |
| 2026-02-14 | Upstox | Lead | R2 | Design offline-first sync | System Design | hard | struggled |

### Effective Patterns (what works for this candidate)
- Quizzing after teaching
- Connecting to production codebase

### Ineffective Patterns (what keeps not working)
- Rushing the answer
- Skipping the why

#### Plum
Heavy on DSA in R1. Friendly panel.

#### Upstox
Fit-call gates the loop. Stories matter.

## Session Log

| Date | Commands | Outcomes |
| --- | --- | --- |
| 2026-06-01 | /drill | passed gate 1 |
| 2026-06-15 sprint | /mock | mixed |

## Drill Progression

Current stage: stage-3
Revisit queue: S2, S5
Gates passed: 1, 2

## Coaching Notes
- Candidate prefers Lead-level depth
- Always quiz after teaching
`;

beforeEach(() => {
  // Clean any leftover state files between tests.
  for (const p of [
    path.join(ENGINE, "coaching_state.md"),
    path.resolve(ENGINE, "..", "interview-coach-skill", "coaching_state.md"),
  ]) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
});

afterAll(() => {
  fs.rmSync(ENGINE, { recursive: true, force: true });
  fs.rmSync(path.resolve(ENGINE, "..", "interview-coach-skill"), { recursive: true, force: true });
});

/** Write a profile-local coaching_state.md under a fresh tmp profile root. */
function writeProfileRoot(content: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-coach-profile-"));
  fs.writeFileSync(path.join(root, "coaching_state.md"), content);
  return root;
}

describe("readCoachState — full parse (explicit root)", () => {
  let root: string;
  beforeEach(() => {
    root = writeProfileRoot(FULL_STATE);
  });

  it("parses the Storybank table (skips the 5th column, strips ~~strikethrough~~)", () => {
    const state = readCoachState(root)!;
    expect(state).not.toBeNull();
    expect(state.stories).toEqual([
      { id: "S1", title: "Dead Reckoning", skill: "Location", skill2: "Sensors", strength: "strong" },
      { id: "S2", title: "Theme Engine", skill: "Compose", skill2: "Design", strength: "medium" },
      { id: "S3", title: "Room Migrations", skill: "Room", skill2: "SQL", strength: "strong" },
    ]);
  });

  it("parses story details (#### Sn — Title) with multi-line bodies", () => {
    const state = readCoachState(root)!;
    expect(Object.keys(state.details).sort()).toEqual(["S1", "S2"]);
    expect(state.details.S1.title).toBe("Predictive Dead Reckoning");
    expect(state.details.S1.body).toBe(
      "Drove GPS accuracy from 50% to 95% using sensor fusion.\nMulti-line body for S1.",
    );
    expect(state.details.S2.title).toBe("Theme Engine");
    expect(state.details.S2.body).toBe("Cut UI friction 60% with a custom theme engine.");
  });

  it("parses the Outcome Log table (drops header + separator rows)", () => {
    const state = readCoachState(root)!;
    expect(state.outcomes).toEqual([
      { date: "2026-01-10", company: "Plum", role: "SDE-2", round: "R1", result: "pass", notes: "clean DSA" },
      { date: "2026-02-14", company: "Upstox", role: "Lead", round: "R1", result: "pending", notes: "fit call" },
    ]);
  });

  it("parses the Question Bank (date/company/round/question/competency/outcome; skips skill2+difficulty cols)", () => {
    const state = readCoachState(root)!;
    expect(state.questions).toEqual([
      {
        date: "2026-01-10",
        company: "Plum",
        round: "R1",
        question: "Explain StateFlow vs SharedFlow",
        competency: "Coroutines",
        outcome: "nailed",
      },
      {
        date: "2026-02-14",
        company: "Upstox",
        round: "R2",
        question: "Design offline-first sync",
        competency: "System Design",
        outcome: "struggled",
      },
    ]);
  });

  it("parses company patterns (#### blocks inside Interview Intelligence)", () => {
    const state = readCoachState(root)!;
    expect(state.companyPatterns).toEqual([
      { company: "Plum", body: "Heavy on DSA in R1. Friendly panel." },
      { company: "Upstox", body: "Fit-call gates the loop. Stories matter." },
    ]);
  });

  it("parses the Session Log (date must start with 4 digits)", () => {
    const state = readCoachState(root)!;
    expect(state.sessionLog).toEqual([
      { date: "2026-06-01", commands: "/drill", outcomes: "passed gate 1" },
      { date: "2026-06-15 sprint", commands: "/mock", outcomes: "mixed" },
    ]);
  });

  it("parses Interview Loops (active) bullets, stripping the leading '- '", () => {
    const state = readCoachState(root)!;
    expect(state.loops).toEqual(["Plum — awaiting R2", "Upstox — R1 fit call"]);
  });

  it("parses Profile and Active Coaching Strategy bullets", () => {
    const state = readCoachState(root)!;
    expect(state.profileBullets).toEqual([
      "5+ years Android, targeting Lead",
      "Strong on Compose + Room",
      "Weak on system design under pressure",
    ]);
    expect(state.strategy).toEqual(["Lead with metrics in every story", "Slow down on system design"]);
  });

  it("parses Effective / Ineffective patterns (### subsections of Interview Intelligence)", () => {
    const state = readCoachState(root)!;
    expect(state.effectivePatterns).toEqual([
      "Quizzing after teaching",
      "Connecting to production codebase",
    ]);
    expect(state.ineffectivePatterns).toEqual(["Rushing the answer", "Skipping the why"]);
  });

  it("parses the Coaching Notes section even though it is LAST in the file (end-of-file lookahead)", () => {
    const state = readCoachState(root)!;
    expect(state.coachingNotes).toEqual([
      "Candidate prefers Lead-level depth",
      "Always quiz after teaching",
    ]);
  });

  it("parses Drill Progression stage / queue / gates", () => {
    const state = readCoachState(root)!;
    expect(state.drillStage).toBe("stage-3");
    expect(state.drillQueue).toBe("S2, S5");
    expect(state.gatesPassed).toBe("1, 2");
  });
});

describe("readCoachState — trailing-newline / no-trailing-newline variants of the last section", () => {
  it("parses the last section when the file has NO trailing newline", () => {
    // Drop the trailing newline so the last bullet sits at the true end of string.
    const root = writeProfileRoot(FULL_STATE.replace(/\n+$/, ""));
    const state = readCoachState(root)!;
    expect(state.coachingNotes).toEqual([
      "Candidate prefers Lead-level depth",
      "Always quiz after teaching",
    ]);
  });
});

describe("readCoachState — edge cases / missing sections", () => {
  it("returns empty collections (not null) for a file with only a heading", () => {
    const root = writeProfileRoot("# Coaching State\n\nNothing structured here.\n");
    const state = readCoachState(root)!;
    expect(state).not.toBeNull();
    expect(state.stories).toEqual([]);
    expect(state.details).toEqual({});
    expect(state.outcomes).toEqual([]);
    expect(state.questions).toEqual([]);
    expect(state.companyPatterns).toEqual([]);
    expect(state.sessionLog).toEqual([]);
    expect(state.loops).toEqual([]);
    expect(state.profileBullets).toEqual([]);
    expect(state.strategy).toEqual([]);
    expect(state.coachingNotes).toEqual([]);
    expect(state.effectivePatterns).toEqual([]);
    expect(state.ineffectivePatterns).toEqual([]);
  });

  it("defaults drill fields to sentinels ('?' stage, '' queue/gates) when Drill Progression is absent", () => {
    const root = writeProfileRoot("# Coaching State\n");
    const state = readCoachState(root)!;
    expect(state.drillStage).toBe("?");
    expect(state.drillQueue).toBe("");
    expect(state.gatesPassed).toBe("");
  });

  it("does not crash on an empty file (returns a state with empty collections)", () => {
    const root = writeProfileRoot("");
    const state = readCoachState(root)!;
    expect(state).not.toBeNull();
    expect(state.stories).toEqual([]);
    expect(state.drillStage).toBe("?");
  });
});

describe("coachStatePath resolution order", () => {
  it("returns null for a non-engine profile root with no local file", () => {
    // A fresh profile root (NOT the engine root) and NO coaching_state.md → null,
    // even if a global sibling checkout exists.
    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), "co-coach-other-"));
    // Seed a global file: it must NOT be picked up for a non-engine profile.
    const globalDir = path.resolve(ENGINE, "..", "interview-coach-skill");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, "coaching_state.md"), FULL_STATE);

    expect(readCoachState(otherRoot)).toBeNull();
    fs.rmSync(otherRoot, { recursive: true, force: true });
  });

  it("prefers the profile-LOCAL file over the global sibling for the engine root", () => {
    // Local file for the engine root with a distinctive Profile bullet.
    fs.writeFileSync(
      path.join(ENGINE, "coaching_state.md"),
      "# Coaching State\n\n## Profile\n- LOCAL engine profile\n",
    );
    // Global sibling with a different bullet — should be ignored when local exists.
    const globalDir = path.resolve(ENGINE, "..", "interview-coach-skill");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, "coaching_state.md"),
      "# Coaching State\n\n## Profile\n- GLOBAL sibling profile\n",
    );

    const state = readCoachState(ENGINE)!;
    expect(state.profileBullets).toEqual(["LOCAL engine profile"]);
  });

  it("falls back to the global sibling for the engine root when no local file exists", () => {
    // No local ENGINE/coaching_state.md; only the global sibling exists.
    const globalDir = path.resolve(ENGINE, "..", "interview-coach-skill");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, "coaching_state.md"),
      "# Coaching State\n\n## Profile\n- GLOBAL sibling profile\n",
    );

    const state = readCoachState(ENGINE)!;
    expect(state.profileBullets).toEqual(["GLOBAL sibling profile"]);
  });

  it("returns null for the engine root when neither local nor global file exists", () => {
    expect(readCoachState(ENGINE)).toBeNull();
  });

  it("defaults root to careerOpsRoot() (the engine root) when called with no argument", () => {
    // With a global sibling present and no local file, the no-arg call resolves
    // to the mocked engine root and finds the global fixture.
    const globalDir = path.resolve(ENGINE, "..", "interview-coach-skill");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, "coaching_state.md"),
      "# Coaching State\n\n## Profile\n- default-arg engine profile\n",
    );
    const state = readCoachState()!;
    expect(state.profileBullets).toEqual(["default-arg engine profile"]);
  });
});
