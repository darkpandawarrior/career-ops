import { describe, it, expect } from "vitest";
import { coercePortfolio, extractPortfolioJson } from "./schema";

describe("coercePortfolio", () => {
  it("returns null without a usable name", () => {
    expect(coercePortfolio(null)).toBeNull();
    expect(coercePortfolio({})).toBeNull();
    expect(coercePortfolio({ name: "   " })).toBeNull();
    expect(coercePortfolio("nope")).toBeNull();
  });

  it("keeps required fields and trims strings", () => {
    const d = coercePortfolio({ name: "  Ada Lovelace ", title: " Engineer ", tagline: "I build things." })!;
    expect(d.name).toBe("Ada Lovelace");
    expect(d.title).toBe("Engineer");
    expect(d.tagline).toBe("I build things.");
  });

  it("drops malformed metrics and clamps to 6", () => {
    const metrics = Array.from({ length: 10 }, (_, i) => ({ value: `${i}`, label: `m${i}` }));
    metrics.push({ value: "", label: "x" } as never); // dropped (no value)
    const d = coercePortfolio({ name: "X", metrics })!;
    expect(d.metrics!.length).toBe(6);
    expect(d.metrics!.every((m) => m.value && m.label)).toBe(true);
  });

  it("normalizes experience points (string or {label,text}) and drops empties", () => {
    const d = coercePortfolio({
      name: "X",
      experience: [
        { company: "Co", role: "Dev", period: "2024", points: ["did a thing", { label: "Lead", text: "led" }, { text: "" }] },
        { points: [] }, // dropped (no company/role)
      ],
    })!;
    expect(d.experience!).toHaveLength(1);
    expect(d.experience![0].points).toEqual([{ text: "did a thing" }, { label: "Lead", text: "led" }]);
  });

  it("keeps only well-formed skills and case studies", () => {
    const d = coercePortfolio({
      name: "X",
      skills: [{ group: "Arch", items: ["a", "", "b"] }, { group: "", items: ["x"] }],
      caseStudies: [{ title: "Win", blurb: "did it", tags: ["k", "j"] }, { title: "No summary" }],
    })!;
    expect(d.skills).toEqual([{ group: "Arch", items: ["a", "b"] }]);
    // 'blurb' is tolerated as a legacy alias for 'summary'; a case study with no
    // summary at all is dropped.
    expect(d.caseStudies).toHaveLength(1);
    expect(d.caseStudies![0]).toMatchObject({ title: "Win", summary: "did it", tags: ["k", "j"] });
  });
});

describe("extractPortfolioJson", () => {
  it("parses a ```json fenced block", () => {
    expect(extractPortfolioJson('chatter\n```json\n{"name":"A"}\n```\nbye')).toEqual({ name: "A" });
  });
  it("parses the first balanced object from chatty output", () => {
    expect(extractPortfolioJson('Here you go: {"name":"A","x":{"y":1}} done')).toEqual({ name: "A", x: { y: 1 } });
  });
  it("returns null when there's no valid JSON", () => {
    expect(extractPortfolioJson("no json here")).toBeNull();
    expect(extractPortfolioJson("")).toBeNull();
  });
});
