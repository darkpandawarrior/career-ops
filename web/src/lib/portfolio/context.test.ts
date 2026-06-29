import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPortfolio, writePortfolio, deletePortfolio, buildPortfolioContext, DEPLOY_README } from "./context";
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

  it("snapshots a version when a stamp is supplied", () => {
    writePortfolio(data, ROOT, "2026-06-30T00-00-00-000Z");
    const s = readPortfolio(ROOT);
    expect(s.versions).toEqual(["2026-06-30T00-00-00-000Z.html"]);
  });

  it("writes under the PASSED root (per-profile isolation)", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "co-portfolio-other-"));
    writePortfolio(data, ROOT);
    expect(readPortfolio(other).exists).toBe(false); // sibling root untouched
    fs.rmSync(other, { recursive: true, force: true });
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
  it("reads cv.md + config/profile.yml from the root, defaulting to empty", () => {
    expect(buildPortfolioContext(ROOT)).toEqual({ cv: "", profile: "" });
    fs.writeFileSync(path.join(ROOT, "cv.md"), "# My CV");
    fs.mkdirSync(path.join(ROOT, "config"));
    fs.writeFileSync(path.join(ROOT, "config", "profile.yml"), "name: Ada");
    expect(buildPortfolioContext(ROOT)).toEqual({ cv: "# My CV", profile: "name: Ada" });
  });
});

describe("DEPLOY_README", () => {
  it("mentions the common deploy targets", () => {
    expect(DEPLOY_README).toMatch(/Netlify/);
    expect(DEPLOY_README).toMatch(/GitHub Pages/);
  });
});
