import { describe, it, expect } from "vitest";
import { THEMES, DEFAULT_THEME, resolveTheme, themeOptions } from "./themes";
import { renderPortfolio } from "./render";
import type { PortfolioData } from "./schema";

describe("themes registry", () => {
  it("every theme has a full var set + a key matching its map entry", () => {
    for (const [key, t] of Object.entries(THEMES)) {
      expect(t.key).toBe(key);
      for (const v of ["bg", "surface", "border", "fg", "muted", "faint", "accent", "accentSoft", "accentFg"]) {
        expect(t.vars).toHaveProperty(v);
        expect(typeof (t.vars as Record<string, string>)[v]).toBe("string");
      }
    }
    expect(THEMES[DEFAULT_THEME]).toBeTruthy();
  });

  it("resolveTheme falls back to the default for unknown/empty keys", () => {
    expect(resolveTheme("ghost").key).toBe(DEFAULT_THEME);
    expect(resolveTheme(undefined).key).toBe(DEFAULT_THEME);
    expect(resolveTheme("aurora").key).toBe("aurora");
  });

  it("themeOptions lists every theme as {key,label}", () => {
    expect(themeOptions().length).toBe(Object.keys(THEMES).length);
    expect(themeOptions().every((o) => o.key && o.label)).toBe(true);
  });
});

describe("renderPortfolio applies the chosen theme", () => {
  const base: PortfolioData = { name: "Ada", title: "Designer", tagline: "I design things." };
  it("injects the theme's accent + background into the CSS", () => {
    expect(renderPortfolio({ ...base, theme: "aurora" })).toContain(THEMES.aurora.vars.accent);
    expect(renderPortfolio({ ...base, theme: "paper" })).toContain(THEMES.paper.vars.bg);
  });
  it("omits the Google Fonts link when a theme requests none — n/a here, but falls back cleanly for an unknown theme", () => {
    expect(renderPortfolio({ ...base, theme: "nope" })).toContain(THEMES[DEFAULT_THEME].vars.accent);
  });
});

describe("renderPortfolio renders projects (role-neutral)", () => {
  it("renders a Projects section with name, description, tags, and a View link", () => {
    const html = renderPortfolio({
      name: "Ada",
      title: "Researcher",
      tagline: "I study things.",
      projects: [{ name: "Bernoulli study", description: "Computed the numbers.", link: "https://example.com/paper", tags: ["Math"] }],
    });
    expect(html).toContain('id="projects"');
    expect(html).toContain("Bernoulli study");
    expect(html).toContain('href="https://example.com/paper"');
  });
  it("omits the Projects section when there are none", () => {
    expect(renderPortfolio({ name: "Ada", title: "X", tagline: "y" })).not.toContain('id="projects"');
  });
});
