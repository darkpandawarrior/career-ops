import { describe, it, expect } from "vitest";
import { serializeDataBlock, buildProfileTs, buildSystemPrompt, fillIndexHtml, buildProjectFiles } from "./scaffold";
import type { PortfolioData } from "./schema";

const data: PortfolioData = {
  name: "Ada Lovelace",
  title: "Staff Engineer",
  tagline: "I turn ideas into shipped systems.",
  email: "ada@example.com",
  github: "https://github.com/ada",
  intro: "First computer programmer.",
  metrics: [{ value: "10x", label: "throughput", detail: "rewrote the engine" }],
  competencies: ["Algorithms", "Compilers"],
  experience: [{ company: "Analytical Co", role: "Lead", period: "1843", points: [{ label: "Vision", text: "Wrote the first algorithm." }] }],
  caseStudies: [{ title: "Bernoulli engine", metric: "first program", summary: "Computed Bernoulli numbers.", problem: "no machine yet", approach: ["notes", "loops"], outcome: "the first algorithm", tags: ["Math"] }],
  skills: [{ group: "Core", items: ["Logic", "Math"] }],
  education: { school: "Home", degree: "Self-taught", period: "1830s" },
};

describe("serializeDataBlock", () => {
  it("emits every export the template's components import", () => {
    const ts = serializeDataBlock(data);
    for (const name of ["profile", "education", "metrics", "competencies", "experience", "caseStudies", "languages", "skills", "resumeSkills", "projects", "openSource", "recentGrowth"]) {
      expect(ts).toContain(`export const ${name}`);
    }
    // caseStudies gains a slug + fills required fields with safe defaults.
    expect(ts).toContain('"slug": "bernoulli-engine"');
    expect(ts).toContain('"resumeTitle": "Staff Engineer"');
  });
});

describe("buildProfileTs", () => {
  it("keeps the interface block (above the marker) and appends the generated data", () => {
    const tpl = "export interface CaseStudy { slug: string; }\n\n// === DATA (generated) ===\nexport const profile = {};\n";
    const out = buildProfileTs(data, tpl);
    expect(out).toContain("export interface CaseStudy");
    expect(out).toContain('"name": "Ada Lovelace"');
    expect(out).not.toContain("export const profile = {};"); // placeholder data replaced
  });
});

describe("buildSystemPrompt", () => {
  it("builds a first-person persona grounded in the data", () => {
    const sp = buildSystemPrompt(data);
    expect(sp).toContain("export const SYSTEM_PROMPT");
    expect(sp).toContain("Ada");
    expect(sp).toContain("Bernoulli engine");
  });
});

describe("fillIndexHtml", () => {
  it("replaces the identity tokens", () => {
    const html = fillIndexHtml("<title>__NAME__ | __TITLE__</title><meta content=\"__DESC__\"><text>__INITIAL__</text>", data);
    expect(html).toContain("Ada Lovelace | Staff Engineer");
    expect(html).toContain("I turn ideas into shipped systems.");
    expect(html).toContain("<text>A</text>");
    expect(html).not.toContain("__NAME__");
  });
});

describe("buildProjectFiles (reads the real bundled template)", () => {
  it("returns the full project with the candidate-specific files injected", () => {
    const files = buildProjectFiles(data);
    const byName = Object.fromEntries(files.map((f) => [f.name, f.content]));
    // core project files exist
    expect(byName["package.json"]).toBeTruthy();
    expect(byName["src/App.tsx"]).toBeTruthy();
    expect(byName["api/chat.ts"]).toBeTruthy();
    // generated files carry this candidate's data
    expect(byName["src/data/profile.ts"]).toContain('"name": "Ada Lovelace"');
    expect(byName["src/data/profile.ts"]).toContain("export interface CaseStudy"); // interfaces preserved
    expect(byName["api/_lib/system-prompt.ts"]).toContain("Ada");
    expect(byName["index.html"]).toContain("Ada Lovelace");
    expect(byName["index.html"]).not.toContain("__NAME__");
    // no other candidate's identity leaked in from the template
    expect(JSON.stringify(files)).not.toMatch(/Siddharth|darkpandawarrior/);
  });
});
