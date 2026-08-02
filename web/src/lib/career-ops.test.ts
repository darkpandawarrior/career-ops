import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readInbox,
  readApplications,
  readScanHistory,
  doctorState,
  pipelineSummary,
  readMemory,
  careerOpsRoot,
} from "./career-ops";

// Every reader takes an explicit `root`, so we test against a throwaway tree —
// no mocking, no dependence on the user's real (gitignored) data.
let ROOT: string;
const write = (rel: string, content: string) => {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-careerops-"));
});
afterEach(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("careerOpsRoot", () => {
  it("honours CAREER_OPS_ROOT when set", () => {
    const prev = process.env.CAREER_OPS_ROOT;
    process.env.CAREER_OPS_ROOT = "/tmp/some-root";
    expect(careerOpsRoot()).toBe("/tmp/some-root");
    if (prev === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev;
  });
});

describe("readInbox", () => {
  it("returns [] when pipeline.md is absent", () => {
    expect(readInbox(ROOT)).toEqual([]);
  });

  it("parses `- [ ] URL | Company | Role` lines and the done flag", () => {
    write(
      "data/pipeline.md",
      [
        "# Pipeline",
        "- [ ] https://x.co/1 | Acme | Product Manager",
        "- [x] https://x.co/2 | Globex | Senior PM",
        "not a task line",
        "- [ ] malformed-no-pipes",
      ].join("\n"),
    );
    const inbox = readInbox(ROOT);
    expect(inbox).toEqual([
      { done: false, url: "https://x.co/1", company: "Acme", role: "Product Manager" },
      { done: true, url: "https://x.co/2", company: "Globex", role: "Senior PM" },
    ]);
  });
});

describe("readApplications", () => {
  it("returns [] when applications.md is absent", () => {
    expect(readApplications(ROOT)).toEqual([]);
  });

  it("parses the tracker table, skipping header + separator rows", () => {
    write(
      "data/applications.md",
      [
        "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
        "|---|------|---------|------|-------|--------|-----|--------|-------|",
        "| 1 | 2026-06-01 | Acme | PM | 4.5 | Applied | yes | r1.md | strong |",
        "outside the table",
        "| 2 | 2026-06-02 | Globex | APM | 3.0 | Evaluated | no | r2.md |  |",
      ].join("\n"),
    );
    const apps = readApplications(ROOT);
    expect(apps).toHaveLength(2);
    expect(apps[0]).toMatchObject({ n: "1", company: "Acme", role: "PM", score: "4.5", status: "Applied" });
    expect(apps[1]).toMatchObject({ n: "2", company: "Globex", status: "Evaluated" });
  });

  it("detects a Location column via the SHARED tracker-aliases.json, not a hardcoded copy", () => {
    // The web reader used to carry its own hand-synced HEADER_ALIASES copy, and it
    // had drifted: tracker-aliases.json lists `location`, the copy didn't, so a
    // Location column the CLI parsed fine was invisible here. Seeding the real
    // alias file into the fixture root proves the web path reads that file.
    write("tracker-aliases.json", JSON.stringify({
      "#": "n", num: "n", date: "date", company: "company", empresa: "company",
      via: "via", role: "role", puesto: "role", location: "location",
      score: "score", status: "status", pdf: "pdf", report: "report", notes: "notes",
    }));
    write(
      "data/applications.md",
      [
        "| # | Date | Company | Role | Location | Score | Status | PDF | Report | Notes |",
        "|---|------|---------|------|----------|-------|--------|-----|--------|-------|",
        "| 1 | 2026-06-01 | Acme | PM | Pune | 4.5 | Applied | yes | r1.md | strong |",
      ].join("\n"),
    );
    const apps = readApplications(ROOT);
    expect(apps).toHaveLength(1);
    // Score/Status resolve by HEADER position, not the legacy fixed offset — the
    // extra Location column would have shifted them under the fallback path.
    expect(apps[0]).toMatchObject({ n: "1", company: "Acme", role: "PM", score: "4.5", status: "Applied" });
  });

  it("an alias added to tracker-aliases.json reaches the dashboard with no code change", () => {
    // The whole point of reading the shared file at runtime: a new header alias
    // is picked up by both the CLI and the dashboard from one edit.
    write("tracker-aliases.json", JSON.stringify({
      "#": "n", num: "n", date: "date", empresa: "company", puesto: "role",
      score: "score", status: "status", pdf: "pdf", report: "report", notes: "notes",
      company: "company", role: "role",
    }));
    write(
      "data/applications.md",
      [
        "| # | Date | Empresa | Puesto | Score | Status | PDF | Report | Notes |",
        "|---|------|---------|--------|-------|--------|-----|--------|-------|",
        "| 7 | 2026-06-01 | Iniciativa | Ingeniero | 4.1 | Applied | yes | r7.md |  |",
      ].join("\n"),
    );
    const apps = readApplications(ROOT);
    expect(apps[0]).toMatchObject({ n: "7", company: "Iniciativa", role: "Ingeniero", status: "Applied" });
  });

  it("tolerates an 8-column (no Notes) legacy row", () => {
    write(
      "data/applications.md",
      "| 1 | 2026-06-01 | Acme | PM | 4.5 | Applied | yes | r1.md |",
    );
    const apps = readApplications(ROOT);
    expect(apps).toHaveLength(1);
    expect(apps[0].report).toBe("r1.md");
  });
});

describe("readScanHistory", () => {
  it("returns an empty summary when the file is absent", () => {
    const h = readScanHistory(ROOT);
    expect(h.total).toBe(0);
    expect(h.rows).toEqual([]);
  });

  it("parses TSV rows, counts byStatus, tracks the latest scan, newest-first", () => {
    write(
      "data/scan-history.tsv",
      [
        "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation",
        "https://x.co/1\t2026-06-01\tgreenhouse\tPM\tAcme\tadded\tRemote",
        "https://x.co/2\t2026-06-03\tlever\tAPM\tGlobex\tadded\tIndia",
        "https://x.co/3\t2026-06-02\tashby\tSenior PM\tInitech\tskipped\tUS",
      ].join("\n"),
    );
    const h = readScanHistory(ROOT);
    expect(h.total).toBe(3);
    expect(h.byStatus).toEqual({ added: 2, skipped: 1 });
    expect(h.lastScan).toBe("2026-06-03");
    expect(h.rows[0].url).toBe("https://x.co/3"); // reversed (newest append last → first)
  });
});

describe("doctorState (lifecycle)", () => {
  it("is first-run for a truly empty install (no cv, no data)", () => {
    const s = doctorState(ROOT);
    expect(s.phase).toBe("first-run");
    expect(s.onboardingNeeded).toBe(true);
    expect(s.missing).toContain("cv.md");
  });

  it("is in-between when a CV exists but prereqs are still missing", () => {
    write("cv.md", "# CV");
    const s = doctorState(ROOT);
    expect(s.phase).toBe("in-between");
    expect(s.hasCv).toBe(true);
  });

  it("is established when all four prereqs are present", () => {
    write("cv.md", "# CV");
    write("config/profile.yml", "x: 1");
    write("modes/_profile.md", "# profile");
    write("portals.yml", "title_filter: {}");
    const s = doctorState(ROOT);
    expect(s.phase).toBe("established");
    expect(s.onboardingNeeded).toBe(false);
    expect(s.missing).toEqual([]);
  });

  it("treats an install with pipeline data but no cv as in-between, not first-run", () => {
    write("data/pipeline.md", "- [ ] https://x.co/1 | Acme | PM");
    const s = doctorState(ROOT);
    expect(s.hasData).toBe(true);
    expect(s.phase).toBe("in-between");
  });
});

describe("pipelineSummary", () => {
  it("bundles root existence, inbox, and applications", () => {
    write("data/pipeline.md", "- [ ] https://x.co/1 | Acme | PM");
    const s = pipelineSummary(ROOT);
    expect(s.rootExists).toBe(true);
    expect(s.inbox).toHaveLength(1);
    expect(s.applications).toEqual([]);
  });

  it("reports rootExists=false for a non-existent root", () => {
    expect(pipelineSummary(path.join(ROOT, "ghost")).rootExists).toBe(false);
  });
});

describe("readMemory", () => {
  it("returns '' when there is no memory file", () => {
    expect(readMemory(ROOT)).toBe("");
  });
});
