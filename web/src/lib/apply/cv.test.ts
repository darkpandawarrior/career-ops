import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { companyFromTitle, resolveTailoredCv } from "./cv";

// ─────────────────────────────────────────────────────────────────────────────
// companyFromTitle — PURE: extract a company name from an ATS page/form title.
// ─────────────────────────────────────────────────────────────────────────────
describe("companyFromTitle", () => {
  it("pulls the company after a trailing '@ Company' (Ashby form titles)", () => {
    expect(companyFromTitle("Senior Engineer - Remote @ Acme Corp")).toBe("Acme Corp");
  });

  it("trims surrounding whitespace from the @ capture", () => {
    expect(companyFromTitle("Role @   Globex  ")).toBe("Globex");
  });

  it("stops the @ capture at an earlier @ / | (only the final segment)", () => {
    // [^|@]+? excludes pipes and ats, so only the text after the LAST @ is taken.
    expect(companyFromTitle("Role | Region @ Initech")).toBe("Initech");
  });

  it("matches the 'Role at Company' word form when Company is capitalised", () => {
    expect(companyFromTitle("Android Engineer at Dice")).toBe("Dice");
  });

  it("allows &, ., - and spaces inside the 'at Company' capture", () => {
    expect(companyFromTitle("PM at Smith & Co.")).toBe("Smith & Co.");
  });

  it("prefers the @ form over the 'at' word form", () => {
    // The @ regex is tried first; here it captures the whole tail after @.
    expect(companyFromTitle("Job at Foo @ Bar")).toBe("Bar");
  });

  it("returns '' when no recognisable pattern is present", () => {
    expect(companyFromTitle("Company — Senior Role")).toBe(""); // 'Company —' is a prefix, not a tail pattern
    expect(companyFromTitle("Just a plain title")).toBe("");
  });

  it("does NOT match a lowercase company after 'at' (regex requires [A-Z] start)", () => {
    expect(companyFromTitle("Engineer at acme")).toBe("");
  });

  it("returns '' for empty / undefined input", () => {
    expect(companyFromTitle("")).toBe("");
    expect(companyFromTitle(undefined)).toBe("");
    expect(companyFromTitle("   ")).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveTailoredCv — fs-backed. It reads <root>/output for *.pdf and matches
// by company slug. `root` is passed explicitly by the caller (the requesting
// profile's own root) so we point it at a throwaway tree — no mocking, no
// touching the user's real output/, and no risk of one profile's CV leaking
// into another's (see cv.ts's doc comment).
// ─────────────────────────────────────────────────────────────────────────────
describe("resolveTailoredCv", () => {
  let ROOT: string;
  let OUTPUT: string;

  const writePdf = (name: string, when?: number) => {
    const p = path.join(OUTPUT, name);
    fs.writeFileSync(p, "%PDF-1.4 fake");
    if (when !== undefined) fs.utimesSync(p, when / 1000, when / 1000);
    return p;
  };

  beforeEach(() => {
    ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-cv-"));
    OUTPUT = path.join(ROOT, "output");
    fs.mkdirSync(OUTPUT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
  });

  it("returns null for an empty / missing company (no guessing)", () => {
    writePdf("cv-acme-2026-09-02.pdf");
    expect(resolveTailoredCv(ROOT, "")).toBeNull();
    expect(resolveTailoredCv(ROOT, "   ")).toBeNull();
    expect(resolveTailoredCv(ROOT, undefined)).toBeNull();
  });

  it("returns null when the output/ dir does not exist (readdir throws)", () => {
    fs.rmSync(OUTPUT, { recursive: true, force: true });
    expect(resolveTailoredCv(ROOT, "Acme")).toBeNull();
  });

  it("resolves a PDF whose name contains the full company slug", () => {
    const p = writePdf("cv-alex-acme-corp-2026-09-02.pdf");
    expect(resolveTailoredCv(ROOT, "Acme Corp")).toBe(p);
  });

  it("does NOT match on the first slug token alone", () => {
    // Was the opposite assertion until #2156/#3214. "Acme Corp" -> first token "acme"
    // resolved an unrelated "Acme Bank" file and attached it to a real application.
    // matchesTailoredCv now requires the cv- prefix AND a token boundary on the FULL
    // slug, so a first-token near-miss must find nothing rather than the wrong CV.
    writePdf("cv-acme-2026-09-02.pdf");
    expect(resolveTailoredCv(ROOT, "Acme Corp")).toBeNull();
  });

  it("does NOT fall back to a short (<=2 char) first token", () => {
    // company "Hi There" -> first token "hi" (len 2) — too short to fuzzy-match.
    writePdf("cv-hi-everyone-2026-09-02.pdf");
    expect(resolveTailoredCv(ROOT, "Hi There")).toBeNull();
  });

  it("only considers .pdf files (ignores other extensions)", () => {
    writePdf("acme.txt" as string); // not a pdf
    fs.writeFileSync(path.join(OUTPUT, "acme.txt"), "x");
    expect(resolveTailoredCv(ROOT, "Acme")).toBeNull();
  });

  it("returns null when no file matches the company at all (never the wrong CV)", () => {
    writePdf("cv-globex-2026-09-02.pdf");
    expect(resolveTailoredCv(ROOT, "Acme")).toBeNull();
  });

  it("returns the NEWEST match when several files match (mtime desc)", () => {
    const base = Date.now();
    writePdf("cv-acme-old.pdf", base - 100_000);
    const newest = writePdf("cv-acme-new.pdf", base);
    writePdf("cv-acme-mid.pdf", base - 50_000);
    expect(resolveTailoredCv(ROOT, "Acme")).toBe(newest);
  });

  it("is case-insensitive on the company name", () => {
    const p = writePdf("cv-acme-2026-09-02.pdf");
    expect(resolveTailoredCv(ROOT, "ACME")).toBe(p);
  });

  it("never resolves a different profile's output/ directory (cross-profile isolation)", () => {
    writePdf("acme-cv.pdf");
    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), "co-cv-other-"));
    fs.mkdirSync(path.join(otherRoot, "output"), { recursive: true });
    try {
      expect(resolveTailoredCv(otherRoot, "Acme")).toBeNull();
    } finally {
      fs.rmSync(otherRoot, { recursive: true, force: true });
    }
  });
});
