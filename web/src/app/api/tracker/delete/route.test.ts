import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * /api/tracker/delete orchestrates the REAL `tracker.mjs delete --num N` (#1200)
 * as a subprocess — it never hand-edits applications.md. We deliberately do NOT
 * mock node:child_process or @/lib/career-ops here: careerOpsRoot()/rootScript()
 * resolve to the REAL repo checkout, so the test spawns the real tracker.mjs
 * against a throwaway tracker file (via CAREER_OPS_TRACKER), exercising the
 * actual header-aware delete + atomic write + lock, not a stand-in.
 *
 * Only requestRoot() (the active profile's data root) and isTrackerWriting()
 * (the merge-in-flight guard) are mocked, matching the route's own dependency
 * seams.
 */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-delete-route-"));
const TRACKER = path.join(ROOT, "data", "applications.md");

vi.mock("@/lib/profile-registry", () => ({ requestRoot: vi.fn(async () => ROOT) }));

const h = vi.hoisted(() => ({ writing: false }));
vi.mock("@/lib/core/run-registry", () => ({ isTrackerWriting: () => h.writing }));

import { POST } from "./route";

const HEADER_9 = "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |";
const SEP_9 = "|---|------|---------|------|-------|--------|-----|--------|-------|";

const HEADER_VIA = "| # | Date | Company | Role | Score | Status | PDF | Report | Via | Notes |";
const SEP_VIA = "|---|------|---------|------|-------|--------|-----|--------|-----|-------|";

function writeTracker(header: string, sep: string, rows: string[]) {
  fs.mkdirSync(path.dirname(TRACKER), { recursive: true });
  fs.writeFileSync(TRACKER, [header, sep, ...rows].join("\n") + "\n", "utf8");
}

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/tracker/delete", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  h.writing = false;
  fs.rmSync(path.join(ROOT, "data"), { recursive: true, force: true });
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("POST /api/tracker/delete — legacy 9-column tracker", () => {
  it("dry-run previews the removal without writing", async () => {
    writeTracker(HEADER_9, SEP_9, [
      "| 1 | 2026-06-01 | Acme | PM | 4.5 | Applied | yes | reports/1-acme.md | strong |",
      "| 2 | 2026-06-02 | Globex | APM | 3.0 | Evaluated | no | reports/2-globex.md |  |",
    ]);
    const before = fs.readFileSync(TRACKER, "utf8");
    const res = await post({ n: "2", dryRun: true });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(body.orphanReport).toContain("reports/2-globex.md");
    expect(fs.readFileSync(TRACKER, "utf8")).toBe(before);
  });

  it("removes the row for real and reports the orphaned report", async () => {
    writeTracker(HEADER_9, SEP_9, [
      "| 1 | 2026-06-01 | Acme | PM | 4.5 | Applied | yes | reports/1-acme.md | strong |",
      "| 2 | 2026-06-02 | Globex | APM | 3.0 | Evaluated | no | reports/2-globex.md |  |",
    ]);
    const res = await post({ n: "2" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(false);
    expect(body.orphanReport).toContain("reports/2-globex.md");

    const md = fs.readFileSync(TRACKER, "utf8");
    expect(md).not.toContain("Globex");
    expect(md).toContain("Acme");
  });

  it("returns 404 for a nonexistent row number", async () => {
    writeTracker(HEADER_9, SEP_9, ["| 1 | 2026-06-01 | Acme | PM | 4.5 | Applied | yes | r1.md | x |"]);
    const res = await post({ n: "99" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/tracker/delete — Via-bearing tracker", () => {
  it("removes the correct row on a 10-column (Via) layout without shifting other cells", async () => {
    writeTracker(HEADER_VIA, SEP_VIA, [
      "| 1 | 2026-06-01 | Acme | PM | 4.5 | Applied | yes | reports/1-acme.md | Direct | strong |",
      "| 2 | 2026-06-02 | Globex | APM | 3.0 | Evaluated | no | reports/2-globex.md | Recruiter | note |",
    ]);
    const res = await post({ n: "2" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);

    const md = fs.readFileSync(TRACKER, "utf8");
    expect(md).not.toContain("Globex");
    const row1 = md.split("\n").find((l) => l.includes("| 1 |"))!;
    // Via column stays in place — no column drift from the delete.
    expect(row1.split("|").map((c) => c.trim())[9]).toBe("Direct");
  });
});

describe("POST /api/tracker/delete — validation / errors", () => {
  it("returns 400 on a malformed body", async () => {
    const res = await post("{ not json");
    expect(res.status).toBe(400);
  });

  it("returns 400 when n is not numeric", async () => {
    const res = await post({ n: "abc" });
    expect(res.status).toBe(400);
  });

  it("returns 409 when an evaluation is currently writing the tracker", async () => {
    writeTracker(HEADER_9, SEP_9, ["| 1 | 2026-06-01 | Acme | PM | 4.5 | Applied | yes | r1.md | x |"]);
    h.writing = true;
    const res = await post({ n: "1" });
    expect(res.status).toBe(409);
  });
});
