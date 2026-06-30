import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// One throwaway data root the (mocked) requestRoot() points at. Each test
// rewrites fixtures under data/ then calls the route's GET directly.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-scans-route-"));

// Approach (a): bypass header/registry resolution entirely — requestRoot just
// hands the route our tmp root. The route then reads data/* via @/lib/career-ops
// (real, unmocked) against that root.
vi.mock("@/lib/profile-registry", () => ({ requestRoot: vi.fn(async () => ROOT) }));

import { GET } from "./route";

const write = (rel: string, content: string) => {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
};

beforeEach(() => {
  // Start every test from a clean data/ so a prior fixture never leaks through.
  fs.rmSync(path.join(ROOT, "data"), { recursive: true, force: true });
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("GET /api/scans", () => {
  it("returns empty scan summary and empty inbox when no files exist", async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.scans.total).toBe(0);
    expect(body.scans.rows).toEqual([]);
    expect(body.scans.byStatus).toEqual({});
    expect(body.scans.lastScan).toBe("");
    expect(body.inbox).toEqual([]);
  });

  it("parses scan-history.tsv: total, byStatus, lastScan, newest-first rows", async () => {
    write(
      "data/scan-history.tsv",
      [
        "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation",
        "https://x.co/1\t2026-06-01\tgreenhouse\tPM\tAcme\tadded\tRemote",
        "https://x.co/2\t2026-06-03\tlever\tAPM\tGlobex\tadded\tIndia",
        "https://x.co/3\t2026-06-02\tashby\tSenior PM\tInitech\tskipped\tUS",
      ].join("\n"),
    );
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.scans.total).toBe(3);
    expect(body.scans.byStatus).toEqual({ added: 2, skipped: 1 });
    expect(body.scans.lastScan).toBe("2026-06-03");
    // Appends are reversed so the newest-appended row comes first.
    expect(body.scans.rows[0].url).toBe("https://x.co/3");
    expect(body.scans.rows[0]).toMatchObject({
      portal: "ashby",
      title: "Senior PM",
      company: "Initech",
      status: "skipped",
      location: "US",
    });
  });

  it("parses agent-inbox.md checklist into {done,text} items", async () => {
    write(
      "data/agent-inbox.md",
      [
        "# Inbox",
        "- [ ] Review Acme PM offer",
        "- [x] Apply to Globex",
        "- [X] Follow up with Initech",
        "not a task line",
      ].join("\n"),
    );
    const res = await GET();
    const body = await res.json();
    expect(body.inbox).toEqual([
      { done: false, text: "Review Acme PM offer" },
      { done: true, text: "Apply to Globex" },
      { done: true, text: "Follow up with Initech" },
    ]);
  });

  it("returns both scans and inbox together when both files are present", async () => {
    write(
      "data/scan-history.tsv",
      [
        "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation",
        "https://x.co/1\t2026-06-05\tgreenhouse\tPM\tAcme\tadded\tRemote",
      ].join("\n"),
    );
    write("data/agent-inbox.md", "- [ ] one task");
    const res = await GET();
    const body = await res.json();
    expect(body.scans.total).toBe(1);
    expect(body.scans.lastScan).toBe("2026-06-05");
    expect(body.inbox).toEqual([{ done: false, text: "one task" }]);
  });

  it("treats a header-only TSV (no data rows) as an empty summary", async () => {
    write("data/scan-history.tsv", "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation");
    const res = await GET();
    const body = await res.json();
    expect(body.scans.total).toBe(0);
    expect(body.scans.rows).toEqual([]);
    expect(body.scans.byStatus).toEqual({});
  });
});
