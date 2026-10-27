import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A throwaway profile root. requestRoot() (from profile-registry) is mocked to
// return this dir so the route reads our fixtures, never the user's real data.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "co-pipeline-route-"));

vi.mock("@/lib/profile-registry", () => ({
  requestRoot: vi.fn(async () => TMP),
}));

import { GET } from "./route";

// Write data/<rel> under the tmp root.
function writeData(rel: string, content: string) {
  const full = path.join(TMP, "data", rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function clearData() {
  fs.rmSync(path.join(TMP, "data"), { recursive: true, force: true });
}

beforeEach(() => {
  clearData();
});

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("GET /api/pipeline", () => {
  it("returns empty inbox + applications when no data files exist", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.inbox).toEqual([]);
    expect(body.applications).toEqual([]);
    // The tmp root itself exists (mkdtempSync created it) even with no data dir.
    expect(body.rootExists).toBe(true);
    expect(body.root).toBe(TMP);
  });

  it("parses pipeline.md inbox lines into {url, company, role, done}", async () => {
    writeData(
      "pipeline.md",
      [
        "# Inbox",
        "- [ ] https://jobs.example.com/anthropic-1 | Anthropic | Senior Android Engineer",
        "- [x] https://jobs.example.com/google-2 | Google | Staff Engineer",
        "",
        "not a job line",
      ].join("\n"),
    );
    const res = await GET();
    const body = await res.json();
    expect(body.inbox).toEqual([
      {
        done: false,
        url: "https://jobs.example.com/anthropic-1",
        company: "Anthropic",
        role: "Senior Android Engineer",
      },
      {
        done: true,
        url: "https://jobs.example.com/google-2",
        company: "Google",
        role: "Staff Engineer",
      },
    ]);
  });

  it("treats uppercase [X] as done", async () => {
    writeData(
      "pipeline.md",
      "- [X] https://x.test/1 | Acme | Dev\n",
    );
    const res = await GET();
    const body = await res.json();
    expect(body.inbox).toHaveLength(1);
    expect(body.inbox[0].done).toBe(true);
  });

  it("ignores malformed inbox lines (missing pipe-delimited fields)", async () => {
    writeData(
      "pipeline.md",
      [
        "- [ ] just-a-url-no-pipes",
        "- [ ] https://ok.test/1 | Company | Role",
        "random text",
        "* [ ] wrong-bullet | Company | Role",
      ].join("\n"),
    );
    const res = await GET();
    const body = await res.json();
    expect(body.inbox).toEqual([
      { done: false, url: "https://ok.test/1", company: "Company", role: "Role" },
    ]);
  });

  it("parses applications.md tracker rows (9-col layout, score before status)", async () => {
    writeData(
      "applications.md",
      [
        "# Tracker",
        "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | 2026-06-01 | Anthropic | Android Eng | 92 | applied | cv.pdf | report.md | strong fit |",
        "| 2 | 2026-06-02 | Google | Staff | 81 | interview | cv2.pdf | report2.md | r1 booked |",
      ].join("\n"),
    );
    const res = await GET();
    const body = await res.json();
    expect(body.applications).toHaveLength(2);
    expect(body.applications[0]).toEqual({
      n: "1",
      date: "2026-06-01",
      company: "Anthropic",
      role: "Android Eng",
      score: "92",
      status: "applied",
      pdf: "cv.pdf",
      report: "report.md",
      notes: "strong fit",
      location: "",
      applyLink: "",
      followUp: "",
      url: "",
      via: "",
    });
    expect(body.applications[1].company).toBe("Google");
    expect(body.applications[1].status).toBe("interview");
  });

  it("tolerates the 8-col layout (no Notes column) -> notes empty", async () => {
    writeData(
      "applications.md",
      [
        "| # | Date | Company | Role | Score | Status | PDF | Report |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | 2026-06-01 | Acme | Dev | 70 | applied | cv.pdf | report.md |",
      ].join("\n"),
    );
    const res = await GET();
    const body = await res.json();
    expect(body.applications).toHaveLength(1);
    expect(body.applications[0].notes).toBe("");
    expect(body.applications[0].score).toBe("70");
    expect(body.applications[0].status).toBe("applied");
  });

  it("skips header + separator rows and non-table lines", async () => {
    writeData(
      "applications.md",
      [
        "Some prose before the table.",
        "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
        "|:--|:---|:--|:--|:--|:--|:--|:--|:--|",
        "| 1 | 2026-06-01 | Acme | Dev | 70 | applied | cv.pdf | report.md | ok |",
        "trailing prose",
      ].join("\n"),
    );
    const res = await GET();
    const body = await res.json();
    expect(body.applications).toHaveLength(1);
    expect(body.applications[0].company).toBe("Acme");
  });

  it("returns the full PipelineSummary shape (inbox, applications, root, rootExists)", async () => {
    writeData("pipeline.md", "- [ ] https://x.test/1 | Acme | Dev\n");
    writeData(
      "applications.md",
      [
        "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | 2026-06-01 | Acme | Dev | 70 | applied | cv.pdf | report.md | ok |",
      ].join("\n"),
    );
    const res = await GET();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["applications", "inbox", "root", "rootExists"].sort());
    expect(body.inbox).toHaveLength(1);
    expect(body.applications).toHaveLength(1);
  });

  it("reports rootExists=false when the resolved root does not exist on disk", async () => {
    const { requestRoot } = await import("@/lib/profile-registry");
    const ghost = path.join(TMP, "does-not-exist-subdir");
    vi.mocked(requestRoot).mockResolvedValueOnce(ghost);
    const res = await GET();
    const body = await res.json();
    expect(body.root).toBe(ghost);
    expect(body.rootExists).toBe(false);
    expect(body.inbox).toEqual([]);
    expect(body.applications).toEqual([]);
  });
});
