import { describe, it, expect } from "vitest";
import { profileModuleToPortfolio } from "./import";

// A portfolio-site-shaped data module (the `src/data/profile.ts` export surface),
// using fictional data only.
const mod = {
  profile: {
    name: "Ada Lovelace",
    title: "Staff Engineer",
    resumeTitle: "Staff Engineer — Compilers & Tooling",
    tagline: "I turn ideas into shipped systems.",
    location: "London",
    email: "ada@example.com",
    github: "https://github.com/ada",
    linkedin: "https://linkedin.com/in/ada",
    portfolio: "https://ada.example.com",
    intro: "First programmer.",
    summary: "Long ATS-friendly summary.",
    availability: "Open to remote.",
  },
  education: { school: "Home", degree: "Self-taught", period: "1830s" },
  metrics: [{ value: "10x", label: "throughput", detail: "rewrote the engine" }],
  competencies: ["Algorithms", "Compilers"],
  experience: [
    {
      company: "Analytical Co",
      role: "Lead",
      period: "1843",
      points: [{ label: "Vision", text: "Wrote the first algorithm." }, { text: "Plain bullet." }],
    },
  ],
  caseStudies: [
    { slug: "bernoulli", title: "Bernoulli engine", metric: "first program", summary: "Computed Bernoulli numbers.", problem: "no machine", approach: ["notes", "loops"], outcome: "the first algorithm", tags: ["Math"] },
  ],
  skills: [{ group: "Core", items: ["Logic", "Math"] }],
  projects: [
    {
      slug: "loom",
      name: "Loom",
      tagline: "A weaving pattern compiler.",
      description: "Longer description.",
      links: [{ label: "GitHub", url: "https://github.com/ada/loom" }],
      badges: ["Compilers", "OSS"],
    },
  ],
};

describe("profileModuleToPortfolio", () => {
  it("maps profile identity, preferring resumeTitle and portfolio→website", () => {
    const d = profileModuleToPortfolio(mod);
    expect(d.name).toBe("Ada Lovelace");
    expect(d.title).toBe("Staff Engineer — Compilers & Tooling"); // resumeTitle preferred
    expect(d.tagline).toBe("I turn ideas into shipped systems.");
    expect(d.website).toBe("https://ada.example.com"); // profile.portfolio → website
    expect(d.email).toBe("ada@example.com");
    expect(d.summary).toBe("Long ATS-friendly summary.");
  });

  it("falls back to profile.title when resumeTitle is absent", () => {
    const d = profileModuleToPortfolio({ profile: { name: "X", title: "Designer" } });
    expect(d.title).toBe("Designer");
  });

  it("carries metrics, competencies, skills, education through", () => {
    const d = profileModuleToPortfolio(mod);
    expect(d.metrics).toEqual([{ value: "10x", label: "throughput", detail: "rewrote the engine" }]);
    expect(d.competencies).toEqual(["Algorithms", "Compilers"]);
    expect(d.skills).toEqual([{ group: "Core", items: ["Logic", "Math"] }]);
    expect(d.education).toEqual({ school: "Home", degree: "Self-taught", period: "1830s" });
  });

  it("maps experience points (labelled + plain)", () => {
    const d = profileModuleToPortfolio(mod);
    expect(d.experience?.[0]).toMatchObject({ company: "Analytical Co", role: "Lead" });
    expect(d.experience?.[0].points).toEqual([
      { label: "Vision", text: "Wrote the first algorithm." },
      { label: undefined, text: "Plain bullet." },
    ]);
  });

  it("drops case-study slugs and keeps the narrative fields", () => {
    const d = profileModuleToPortfolio(mod);
    const c = d.caseStudies?.[0] as Record<string, unknown>;
    expect(c).not.toHaveProperty("slug");
    expect(c.title).toBe("Bernoulli engine");
    expect(c.approach).toEqual(["notes", "loops"]);
  });

  it("maps rich projects → portable shape (tagline→description, links[0]→link, badges→tags)", () => {
    const d = profileModuleToPortfolio(mod);
    expect(d.projects?.[0]).toEqual({
      name: "Loom",
      description: "A weaving pattern compiler.", // tagline preferred over description
      link: "https://github.com/ada/loom",
      tags: ["Compilers", "OSS"],
    });
  });

  it("is tolerant of junk / empties (never throws, yields a name-only shape)", () => {
    expect(profileModuleToPortfolio(null).name).toBe("");
    expect(profileModuleToPortfolio({ profile: { name: "Solo" } })).toMatchObject({ name: "Solo", metrics: [], projects: [] });
  });
});
