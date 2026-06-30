import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPortfolio, writePortfolio, deletePortfolio, restoreVersion, finalizeVersion, buildPortfolioContext, DEPLOY_README } from "./context";
import type { PortfolioData } from "./schema";

let ROOT: string;
const data: PortfolioData = { name: "Ada Lovelace", title: "Engineer", tagline: "I build things." };

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-portfolio-"));
});
afterEach(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("readPortfolio", () => {
  it("reports no draft for a fresh root", () => {
    const s = readPortfolio(ROOT);
    expect(s.exists).toBe(false);
    expect(s.data).toBeNull();
    expect(s.html).toBe("");
    expect(s.versions).toEqual([]);
  });
});

describe("writePortfolio + readPortfolio round trip", () => {
  it("persists data.json + rendered draft.html and reads them back", () => {
    const { html } = writePortfolio(data, ROOT);
    expect(html).toContain("Ada Lovelace");
    expect(fs.existsSync(path.join(ROOT, ".career-ops-web", "portfolio", "data.json"))).toBe(true);

    const s = readPortfolio(ROOT);
    expect(s.exists).toBe(true);
    expect(s.data?.name).toBe("Ada Lovelace");
    expect(s.html).toContain("Ada Lovelace");
  });

  it("snapshots versions (newest first) when a stamp is supplied", () => {
    writePortfolio(data, ROOT, "2026-06-30T00-00-00-000Z");
    writePortfolio({ ...data, tagline: "v2" }, ROOT, "2026-06-30T01-00-00-000Z");
    const s = readPortfolio(ROOT);
    expect(s.versions.map((v) => v.stamp)).toEqual([
      "2026-06-30T01-00-00-000Z",
      "2026-06-30T00-00-00-000Z",
    ]);
    expect(s.versions.every((v) => !v.isFinal)).toBe(true);
    expect(s.final).toBeNull();
  });

  it("writes under the PASSED root (per-profile isolation)", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "co-portfolio-other-"));
    writePortfolio(data, ROOT);
    expect(readPortfolio(other).exists).toBe(false); // sibling root untouched
    fs.rmSync(other, { recursive: true, force: true });
  });
});

describe("restoreVersion", () => {
  it("makes a past version the current draft and re-renders its html", () => {
    writePortfolio({ ...data, tagline: "ORIGINAL" }, ROOT, "v1");
    writePortfolio({ ...data, tagline: "LATER" }, ROOT, "v2");
    expect(readPortfolio(ROOT).data?.tagline).toBe("LATER");

    const r = restoreVersion("v1", ROOT)!;
    expect(r.data.tagline).toBe("ORIGINAL");
    expect(r.html).toContain("ORIGINAL");
    expect(readPortfolio(ROOT).data?.tagline).toBe("ORIGINAL"); // current draft updated
  });
  it("returns null for an unknown version", () => {
    writePortfolio(data, ROOT, "v1");
    expect(restoreVersion("ghost", ROOT)).toBeNull();
  });
});

describe("finalizeVersion", () => {
  it("bookmarks a version as production (reflected in readPortfolio), clearable", () => {
    writePortfolio(data, ROOT, "v1");
    expect(finalizeVersion("v1", ROOT)).toBe(true);
    const s = readPortfolio(ROOT);
    expect(s.final).toBe("v1");
    expect(s.versions.find((v) => v.stamp === "v1")?.isFinal).toBe(true);
    // clearing
    finalizeVersion("", ROOT);
    expect(readPortfolio(ROOT).final).toBeNull();
  });
  it("rejects finalizing an unknown version", () => {
    writePortfolio(data, ROOT, "v1");
    expect(finalizeVersion("ghost", ROOT)).toBe(false);
  });
});

describe("deletePortfolio", () => {
  it("removes the draft + versions", () => {
    writePortfolio(data, ROOT, "v1");
    expect(readPortfolio(ROOT).exists).toBe(true);
    deletePortfolio(ROOT);
    expect(readPortfolio(ROOT).exists).toBe(false);
  });
  it("is a no-op when there's nothing to delete", () => {
    expect(() => deletePortfolio(ROOT)).not.toThrow();
  });
});

describe("buildPortfolioContext", () => {
  it("returns empty cv + extra for a bare root", () => {
    expect(buildPortfolioContext(ROOT)).toEqual({ cv: "", extra: "" });
  });

  it("reads cv.md separately and folds the deeper sources into extra", () => {
    fs.writeFileSync(path.join(ROOT, "cv.md"), "# My CV");
    fs.mkdirSync(path.join(ROOT, "config"));
    fs.writeFileSync(path.join(ROOT, "config", "profile.yml"), "name: Ada");
    fs.mkdirSync(path.join(ROOT, "modes"));
    fs.writeFileSync(path.join(ROOT, "modes", "_profile.md"), "voice: dry wit");
    fs.writeFileSync(path.join(ROOT, "coaching_state.md"), "## Storybank\n| ID | Title |\n| S1 | A big win |");

    const ctx = buildPortfolioContext(ROOT);
    expect(ctx.cv).toBe("# My CV");
    expect(ctx.extra).toContain("name: Ada");
    expect(ctx.extra).toContain("voice: dry wit");
    expect(ctx.extra).toContain("Storybank");
    expect(ctx.extra).toContain("A big win");
  });
});

describe("DEPLOY_README", () => {
  it("mentions the common deploy targets", () => {
    expect(DEPLOY_README).toMatch(/Netlify/);
    expect(DEPLOY_README).toMatch(/GitHub Pages/);
  });
});
