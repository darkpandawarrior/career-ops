import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { InboxJob, Application } from "@/lib/career-ops";

// A throwaway "engine" root used as the default careerOpsRoot() so we can prove
// assembleDedupContext reads from the PASSED root, not the default.
const ENGINE = fs.mkdtempSync(path.join(os.tmpdir(), "co-discover-engine-"));

// readInbox / readApplications are mocked so the test never touches real data
// and so we can assert assembleDedupContext forwards the PASSED root to them.
// careerOpsRoot() is mocked to a sentinel engine root (the default arg).
const inboxByRoot = new Map<string, InboxJob[]>();
const appsByRoot = new Map<string, Application[]>();

vi.mock("@/lib/career-ops", () => ({
  careerOpsRoot: () => ENGINE,
  readInbox: vi.fn((root: string) => inboxByRoot.get(root) ?? []),
  readApplications: vi.fn((root: string) => appsByRoot.get(root) ?? []),
}));

import { assembleDedupContext } from "./discover";
import { readInbox, readApplications } from "@/lib/career-ops";
import { canon } from "@/lib/explore-ai";

// Make a fresh tmp profile root, optionally seeding data/scan-history.tsv.
function makeRoot(tsv?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-discover-root-"));
  if (tsv !== undefined) {
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", "scan-history.tsv"), tsv, "utf8");
  }
  return root;
}

const createdRoots: string[] = [];
function root(tsv?: string): string {
  const r = makeRoot(tsv);
  createdRoots.push(r);
  return r;
}

beforeEach(() => {
  inboxByRoot.clear();
  appsByRoot.clear();
  vi.mocked(readInbox).mockClear();
  vi.mocked(readApplications).mockClear();
});

afterAll(() => {
  for (const r of createdRoots) fs.rmSync(r, { recursive: true, force: true });
  fs.rmSync(ENGINE, { recursive: true, force: true });
});

describe("assembleDedupContext — scan-history.tsv parsing", () => {
  it("reads URLs from col 0, skipping the header row", () => {
    const r = root(
      [
        "url\tcompany\trole", // header — skipped
        "https://acme.com/jobs/1\tAcme\tEngineer",
        "https://beta.io/careers/42\tBeta\tSDE",
      ].join("\n"),
    );
    const { urls } = assembleDedupContext(r);
    expect(urls.has(canon("https://acme.com/jobs/1"))).toBe(true);
    expect(urls.has(canon("https://beta.io/careers/42"))).toBe(true);
    expect(urls.size).toBe(2);
  });

  it("canonicalizes host case and trailing slash, but keeps path case distinct", () => {
    const r = root(
      [
        "url",
        "https://Acme.com/Jobs/1", // mixed case IN THE PATH — a distinct key, not folded
        "https://acme.com/jobs/1/", // trailing slash — collapses onto the exact form
        "https://acme.com/jobs/1", // exact
      ].join("\n"),
    );
    const { urls } = assembleDedupContext(r);
    // canon() lowercases the HOST and strips a trailing slash, but deliberately
    // keeps path case (see core/url-key.mjs's docstring) — over-normalizing the
    // path is what previously collapsed two distinct postings onto one key. So
    // the trailing-slash pair collapses to one key, but the path-case variant
    // stays a second, distinct key.
    expect(urls.size).toBe(2);
    expect(urls.has(canon("https://acme.com/jobs/1"))).toBe(true);
    expect(urls.has(canon("https://Acme.com/Jobs/1"))).toBe(true);
  });

  it("ignores rows whose col 0 is not an http(s) URL", () => {
    const r = root(
      [
        "url",
        "not-a-url",
        "ftp://files.example.com/x",
        "\tonly-a-tab-then-company",
        "", // blank line
        "https://good.com/job",
      ].join("\n"),
    );
    const { urls } = assembleDedupContext(r);
    expect(urls.size).toBe(1);
    expect(urls.has(canon("https://good.com/job"))).toBe(true);
  });

  it("trims whitespace around the URL before testing/canonicalizing", () => {
    const r = root(["url", "  https://spaced.com/job  \tCo\tRole"].join("\n"));
    const { urls } = assembleDedupContext(r);
    expect(urls.has(canon("https://spaced.com/job"))).toBe(true);
    expect(urls.size).toBe(1);
  });

  it("handles a history file with only a header row (no data) as empty", () => {
    const r = root("url\tcompany\trole");
    const { urls, lines } = assembleDedupContext(r);
    expect(urls.size).toBe(0);
    // Only the URL-count line is present (no companies/roles seeded).
    expect(lines).toEqual(["(0 posting URLs are already known and will be auto-filtered, so don't worry about matching exact URLs — just skip the companies above.)"]);
  });

  it("treats a missing scan-history.tsv as no history (no throw)", () => {
    const r = root(); // no data/ dir at all
    expect(() => assembleDedupContext(r)).not.toThrow();
    const { urls } = assembleDedupContext(r);
    expect(urls.size).toBe(0);
  });
});

describe("assembleDedupContext — inbox + applications integration", () => {
  it("merges inbox URLs (canonicalized) with history URLs and dedups across sources", () => {
    const r = root(["url", "https://acme.com/jobs/1"].join("\n"));
    inboxByRoot.set(r, [
      { url: "https://ACME.com/jobs/1/", company: "Acme", role: "Eng", done: false }, // dup of history
      { url: "https://newco.com/openings/9", company: "NewCo", role: "Lead", done: false },
      { url: "notaurl", company: "NoUrlCo", role: "X", done: false }, // url ignored, company kept
      { url: "https://nocompany.com/job", company: "", role: "Y", done: false }, // falsy company guard
    ]);
    const { urls, lines } = assembleDedupContext(r);
    expect(urls.size).toBe(3);
    expect(urls.has(canon("https://acme.com/jobs/1"))).toBe(true);
    expect(urls.has(canon("https://newco.com/openings/9"))).toBe(true);
    expect(urls.has(canon("https://nocompany.com/job"))).toBe(true);
    // Companies from inbox are collected even when the URL is invalid.
    expect(lines[0]).toContain("Acme");
    expect(lines[0]).toContain("NewCo");
    expect(lines[0]).toContain("NoUrlCo");
  });

  it("collects companies from inbox + applications and roles from applications, trimmed", () => {
    const r = root();
    inboxByRoot.set(r, [
      { url: "", company: "  InboxCorp  ", role: "ignored-here", done: false },
    ]);
    appsByRoot.set(r, [
      { n: "1", date: "", company: "  AppCorp  ", role: "  Staff Engineer  ", score: "", status: "", pdf: "", report: "", notes: "", location: "", applyLink: "", followUp: "", url: "" },
    ]);
    const { lines } = assembleDedupContext(r);
    const companiesLine = lines.find((l) => l.startsWith("Companies already"));
    const rolesLine = lines.find((l) => l.startsWith("Roles already"));
    expect(companiesLine).toContain("InboxCorp");
    expect(companiesLine).toContain("AppCorp");
    expect(companiesLine).not.toContain("  InboxCorp  "); // trimmed
    expect(rolesLine).toBe("Roles already tracked: Staff Engineer.");
    // inbox role is NOT collected (only application roles are).
    expect(rolesLine).not.toContain("ignored-here");
  });

  it("skips applications with no company and no role (falsy guards)", () => {
    const r = root();
    appsByRoot.set(r, [
      { n: "1", date: "", company: "", role: "", score: "", status: "", pdf: "", report: "", notes: "", location: "", applyLink: "", followUp: "", url: "" },
      { n: "2", date: "", company: "RealCo", role: "", score: "", status: "", pdf: "", report: "", notes: "", location: "", applyLink: "", followUp: "", url: "" },
    ]);
    const { lines } = assembleDedupContext(r);
    const companiesLine = lines.find((l) => l.startsWith("Companies already"));
    const rolesLine = lines.find((l) => l.startsWith("Roles already"));
    expect(companiesLine).toBe("Companies already in the user's pipeline/tracker (don't re-propose these): RealCo.");
    // No application supplied a role -> the roles line is omitted entirely.
    expect(rolesLine).toBeUndefined();
  });

  it("dedups companies/roles via Set semantics", () => {
    const r = root();
    appsByRoot.set(r, [
      { n: "1", date: "", company: "Dup", role: "Same", score: "", status: "", pdf: "", report: "", notes: "", location: "", applyLink: "", followUp: "", url: "" },
      { n: "2", date: "", company: "Dup", role: "Same", score: "", status: "", pdf: "", report: "", notes: "", location: "", applyLink: "", followUp: "", url: "" },
    ]);
    const { lines } = assembleDedupContext(r);
    expect(lines[0]).toBe("Companies already in the user's pipeline/tracker (don't re-propose these): Dup.");
    expect(lines[1]).toBe("Roles already tracked: Same.");
  });
});

describe("assembleDedupContext — list caps", () => {
  it("caps companies at 120 and roles at 60", () => {
    const r = root();
    const apps: Application[] = [];
    for (let i = 0; i < 200; i++) {
      apps.push({ n: String(i), date: "", company: `Company${i}`, role: `Role${i}`, score: "", status: "", pdf: "", report: "", notes: "", location: "", applyLink: "", followUp: "", url: "" });
    }
    appsByRoot.set(r, apps);
    const { lines } = assembleDedupContext(r);
    const companiesLine = lines.find((l) => l.startsWith("Companies already"))!;
    const rolesLine = lines.find((l) => l.startsWith("Roles already"))!;
    // 120 companies -> 119 commas inside the list portion.
    const compNames = companiesLine.split(": ")[1].replace(/\.$/, "").split(", ");
    expect(compNames.length).toBe(120);
    expect(compNames[0]).toBe("Company0");
    expect(compNames[119]).toBe("Company119");
    const roleNames = rolesLine.split(": ")[1].replace(/\.$/, "").split(", ");
    expect(roleNames.length).toBe(60);
    expect(roleNames[0]).toBe("Role0");
    expect(roleNames[59]).toBe("Role59");
  });

  it("URL set is uncapped (history can hold many)", () => {
    const lines = ["url"];
    for (let i = 0; i < 250; i++) lines.push(`https://co${i}.com/job/${i}`);
    const r = root(lines.join("\n"));
    const { urls } = assembleDedupContext(r);
    expect(urls.size).toBe(250);
  });
});

describe("assembleDedupContext — lines assembly & empty state", () => {
  it("emits only the URL-count line when there are no companies or roles", () => {
    const r = root(["url", "https://x.com/a", "https://y.com/b"].join("\n"));
    const { lines } = assembleDedupContext(r);
    expect(lines).toEqual(["(2 posting URLs are already known and will be auto-filtered, so don't worry about matching exact URLs — just skip the companies above.)"]);
  });

  it("returns empty url set and only the count line for a completely empty profile", () => {
    const r = root(); // no history, no inbox/apps seeded
    const { urls, lines } = assembleDedupContext(r);
    expect(urls.size).toBe(0);
    expect(lines).toEqual(["(0 posting URLs are already known and will be auto-filtered, so don't worry about matching exact URLs — just skip the companies above.)"]);
  });

  it("orders lines: companies, then roles, then URL count", () => {
    const r = root(["url", "https://x.com/a"].join("\n"));
    inboxByRoot.set(r, [{ url: "", company: "C", role: "", done: false }]);
    appsByRoot.set(r, [
      { n: "1", date: "", company: "", role: "R", score: "", status: "", pdf: "", report: "", notes: "", location: "", applyLink: "", followUp: "", url: "" },
    ]);
    const { lines } = assembleDedupContext(r);
    expect(lines[0].startsWith("Companies already")).toBe(true);
    expect(lines[1].startsWith("Roles already")).toBe(true);
    expect(lines[2].startsWith("(1 posting URLs")).toBe(true);
  });
});

describe("assembleDedupContext — reads from the PASSED root", () => {
  it("forwards the explicit root to readInbox/readApplications (not the default engine root)", () => {
    const r = root(["url", "https://passed.com/job"].join("\n"));
    assembleDedupContext(r);
    expect(vi.mocked(readInbox)).toHaveBeenCalledWith(r);
    expect(vi.mocked(readApplications)).toHaveBeenCalledWith(r);
    expect(vi.mocked(readInbox)).not.toHaveBeenCalledWith(ENGINE);
  });

  it("does not leak history across roots: a second root with its own TSV is independent", () => {
    const rA = root(["url", "https://a.com/1"].join("\n"));
    const rB = root(["url", "https://b.com/2"].join("\n"));
    const a = assembleDedupContext(rA);
    const b = assembleDedupContext(rB);
    expect(a.urls.has(canon("https://a.com/1"))).toBe(true);
    expect(a.urls.has(canon("https://b.com/2"))).toBe(false);
    expect(b.urls.has(canon("https://b.com/2"))).toBe(true);
    expect(b.urls.has(canon("https://a.com/1"))).toBe(false);
  });

  it("defaults to careerOpsRoot() when no root is passed", () => {
    // ENGINE has no data/scan-history.tsv and no seeded inbox/apps -> empty.
    const { urls, lines } = assembleDedupContext();
    expect(urls.size).toBe(0);
    expect(vi.mocked(readInbox)).toHaveBeenCalledWith(ENGINE);
    expect(vi.mocked(readApplications)).toHaveBeenCalledWith(ENGINE);
    expect(lines).toEqual(["(0 posting URLs are already known and will be auto-filtered, so don't worry about matching exact URLs — just skip the companies above.)"]);
  });
});
