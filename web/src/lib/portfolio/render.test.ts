import { describe, it, expect } from "vitest";
import { renderPortfolio } from "./render";
import type { PortfolioData } from "./schema";

const base: PortfolioData = { name: "Ada Lovelace", title: "Engineer", tagline: "I build things." };

describe("renderPortfolio", () => {
  it("produces a complete self-contained HTML document with the candidate's name", () => {
    const html = renderPortfolio(base);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>Ada Lovelace — Engineer</title>");
    expect(html).toContain("I build things.");
    expect(html).toContain('<span class="mark">A</span>'); // initial
  });

  it("escapes HTML in all interpolated data (no XSS)", () => {
    const html = renderPortfolio({ ...base, name: '<img src=x onerror=alert(1)>', intro: "a & b < c" });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
    expect(html).toContain("a &amp; b &lt; c");
  });

  it("omits sections that have no data", () => {
    const html = renderPortfolio(base);
    expect(html).not.toContain('id="work"');
    expect(html).not.toContain('id="experience"');
    expect(html).not.toContain('id="skills"');
    expect(html).toContain('id="contact"'); // contact always renders
  });

  it("renders work, experience, and skills sections when present", () => {
    const html = renderPortfolio({
      ...base,
      caseStudies: [{ title: "GPS 50→95%", blurb: "sensor fusion", tags: ["Kotlin"] }],
      experience: [{ company: "Dice", role: "SDE-2", period: "2023—now", points: [{ label: "Lead", text: "led arch" }] }],
      skills: [{ group: "Arch", items: ["Compose", "MVVM"] }],
      metrics: [{ value: "95%", label: "accuracy" }],
    });
    expect(html).toContain('id="work"');
    expect(html).toContain("GPS 50→95%");
    expect(html).toContain('id="experience"');
    expect(html).toContain("<strong>Lead:</strong> led arch");
    expect(html).toContain('id="skills"');
    expect(html).toContain("Compose");
    expect(html).toContain('class="metric-value">95%');
  });

  it("normalizes contact links (email→mailto, bare host→https)", () => {
    const html = renderPortfolio({ ...base, email: "a@b.com", linkedin: "linkedin.com/in/ada", github: "https://github.com/ada" });
    expect(html).toContain('href="mailto:a@b.com"');
    expect(html).toContain('href="https://linkedin.com/in/ada"');
    expect(html).toContain('href="https://github.com/ada"');
  });

  it("is deterministic for the same input", () => {
    expect(renderPortfolio(base)).toBe(renderPortfolio(base));
  });
});
