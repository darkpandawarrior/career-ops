import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

/**
 * Interview-coach state — ports dashboard-web/server.mjs#parseCoachState.
 *
 * Resolution order (per profile root):
 *   1. <profile_root>/coaching_state.md  — profile-local (federation absorb writes here)
 *   2. <engine_root>/../interview-coach-skill/coaching_state.md  — global, only for the
 *      engine-root profile (Siddharth). Other profiles get null if no local file exists.
 */

export type CoachStory = { id: string; title: string; skill: string; skill2: string; strength: string };
export type CoachOutcome = { date: string; company: string; role: string; round: string; result: string; notes: string };
export type CoachQuestion = { date: string; company: string; round: string; question: string; competency: string; outcome: string };
export type CoachCompany = { company: string; body: string };
export type CoachSession = { date: string; commands: string; outcomes: string };

export type CoachState = {
  stories: CoachStory[];
  details: Record<string, { title: string; body: string }>;
  outcomes: CoachOutcome[];
  questions: CoachQuestion[];
  companyPatterns: CoachCompany[];
  sessionLog: CoachSession[];
  loops: string[];
  profileBullets: string[];
  strategy: string[];
  coachingNotes: string[];
  effectivePatterns: string[];
  ineffectivePatterns: string[];
  drillStage: string;
  drillQueue: string;
  gatesPassed: string;
};

function coachStatePath(root: string): string | null {
  // 1. Profile-local file (federation absorb writes here; any profile can have one)
  const local = path.join(root, "coaching_state.md");
  if (fs.existsSync(local)) return local;
  // 2. Global sibling checkout — only valid for the engine-root profile
  if (path.resolve(root) === path.resolve(careerOpsRoot())) {
    const global_ = path.resolve(careerOpsRoot(), "..", "interview-coach-skill", "coaching_state.md");
    if (fs.existsSync(global_)) return global_;
  }
  return null;
}

function sectionOf(text: string, name: string): string {
  const re = new RegExp(`^## ${name}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$(?![\\s\\S]))`, "m");
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

const bullets = (s: string) => s.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));

/** Read + parse coaching_state.md for the given profile root, or null when absent. */
export function readCoachState(root: string = careerOpsRoot()): CoachState | null {
  const statePath = coachStatePath(root);
  if (!statePath) return null;
  let text: string;
  try {
    text = fs.readFileSync(statePath, "utf8");
  } catch {
    return null;
  }

  const stories: CoachStory[] = [];
  for (const m of sectionOf(text, "Storybank").matchAll(
    /^\| (S\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| [^|]+ \| ([^|]+) \|/gm,
  )) {
    stories.push({
      id: m[1],
      title: m[2].trim().replace(/~~/g, ""),
      skill: m[3].trim().replace(/~~/g, ""),
      skill2: m[4].trim().replace(/~~/g, ""),
      strength: m[5].trim(),
    });
  }

  const details: Record<string, { title: string; body: string }> = {};
  for (const m of text.matchAll(/^#### (S\d+) — ([^\n]+)\n([\s\S]*?)(?=\n#### |\n## )/gm)) {
    details[m[1]] = { title: m[2].trim(), body: m[3].trim() };
  }

  const outcomes: CoachOutcome[] = [];
  for (const m of sectionOf(text, "Outcome Log").matchAll(
    /^\| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm,
  )) {
    const c = [m[1], m[2], m[3], m[4], m[5], m[6]].map((s) => s.trim());
    if (c[0] === "Date" || /^-+$/.test(c[0])) continue;
    outcomes.push({ date: c[0], company: c[1], role: c[2], round: c[3], result: c[4], notes: c[5] });
  }

  const intel = sectionOf(text, "Interview Intelligence");
  const sub = (name: string) => {
    const m = intel.match(new RegExp(`### ${name}[^\\n]*\\n([\\s\\S]*?)(?=\\n### |$(?![\\s\\S]))`));
    return m ? m[1].trim() : "";
  };

  const questions: CoachQuestion[] = [];
  for (const m of sub("Question Bank").matchAll(
    /^\| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm,
  )) {
    const c = m.slice(1).map((s) => s.trim());
    if (c[0] === "Date" || /^-+$/.test(c[0])) continue;
    questions.push({ date: c[0], company: c[1], round: c[3], question: c[4], competency: c[5], outcome: c[7] });
  }

  const companyPatterns: CoachCompany[] = [];
  for (const m of intel.matchAll(/^#### ([^\n]+)\n([\s\S]*?)(?=\n#### |\n### |$(?![\s\S]))/gm)) {
    companyPatterns.push({ company: m[1].trim(), body: m[2].trim() });
  }

  const sessionLog: CoachSession[] = [];
  for (const m of sectionOf(text, "Session Log").matchAll(/^\| (\d{4}[^|]*) \| ([^|]+) \| ([^|]+) \|$/gm)) {
    sessionLog.push({ date: m[1].trim(), commands: m[2].trim(), outcomes: m[3].trim() });
  }

  const drill = sectionOf(text, "Drill Progression");

  return {
    stories,
    details,
    outcomes,
    questions,
    companyPatterns,
    sessionLog,
    loops: sectionOf(text, "Interview Loops \\(active\\)").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.replace(/^- /, "")),
    profileBullets: bullets(sectionOf(text, "Profile")),
    strategy: bullets(sectionOf(text, "Active Coaching Strategy")),
    coachingNotes: bullets(sectionOf(text, "Coaching Notes")),
    effectivePatterns: bullets(sub("Effective Patterns \\(what works for this candidate\\)")),
    ineffectivePatterns: bullets(sub("Ineffective Patterns \\(what keeps not working\\)")),
    drillStage: (drill.match(/Current stage: (\S+)/) || [])[1] || "?",
    drillQueue: (drill.match(/Revisit queue: (.+)/) || [])[1] || "",
    gatesPassed: (drill.match(/Gates passed: (.+)/) || [])[1] || "",
  };
}
