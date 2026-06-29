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
// resolveTailoredCv — fs-backed. It reads <careerOpsRoot()>/output for *.pdf and
// matches by company slug. careerOpsRoot() honours CAREER_OPS_ROOT, so we point
// it at a throwaway tree — no mocking, no touching the user's real output/.
// ─────────────────────────────────────────────────────────────────────────────
describe("resolveTailoredCv", () => {
  let ROOT: string;
  let OUTPUT: string;
  let prevEnv: string | undefined;

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
    prevEnv = process.env.CAREER_OPS_ROOT;
    process.env.CAREER_OPS_ROOT = ROOT;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prevEnv;
    fs.rmSync(ROOT, { recursive: true, force: true });
  });

  it("returns null for an empty / missing company (no guessing)", () => {
    writePdf("acme-cv.pdf");
    expect(resolveTailoredCv("")).toBeNull();
    expect(resolveTailoredCv("   ")).toBeNull();
    expect(resolveTailoredCv(undefined)).toBeNull();
  });

  it("returns null when the output/ dir does not exist (readdir throws)", () => {
    fs.rmSync(OUTPUT, { recursive: true, force: true });
    expect(resolveTailoredCv("Acme")).toBeNull();
  });

  it("resolves a PDF whose name contains the full company slug", () => {
    const p = writePdf("siddharth-acme-corp-cv.pdf");
    expect(resolveTailoredCv("Acme Corp")).toBe(p);
  });

  it("matches on the first slug token when it is >2 chars and the full slug is absent", () => {
    // company "Acme Corp" -> slug "acme-corp", first token "acme". File only has "acme".
    const p = writePdf("acme-resume.pdf");
    expect(resolveTailoredCv("Acme Corp")).toBe(p);
  });

  it("does NOT fall back to a short (<=2 char) first token", () => {
    // company "Hi There" -> first token "hi" (len 2) — too short to fuzzy-match.
    writePdf("hi-everyone.pdf");
    expect(resolveTailoredCv("Hi There")).toBeNull();
  });

  it("only considers .pdf files (ignores other extensions)", () => {
    writePdf("acme.txt" as string); // not a pdf
    fs.writeFileSync(path.join(OUTPUT, "acme.txt"), "x");
    expect(resolveTailoredCv("Acme")).toBeNull();
  });

  it("returns null when no file matches the company at all (never the wrong CV)", () => {
    writePdf("globex-cv.pdf");
    expect(resolveTailoredCv("Acme")).toBeNull();
  });

  it("returns the NEWEST match when several files match (mtime desc)", () => {
    const base = Date.now();
    writePdf("acme-old.pdf", base - 100_000);
    const newest = writePdf("acme-new.pdf", base);
    writePdf("acme-mid.pdf", base - 50_000);
    expect(resolveTailoredCv("Acme")).toBe(newest);
  });

  it("is case-insensitive on the company name", () => {
    const p = writePdf("acme-cv.pdf");
    expect(resolveTailoredCv("ACME")).toBe(p);
  });
});
