import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// One throwaway data root the (mocked) requestRoot() points at. The status route
// reads/writes data/applications.md under it.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-status-route-"));

// Approach (a): requestRoot just hands the route our tmp root (skip headers/registry).
vi.mock("@/lib/profile-registry", () => ({ requestRoot: vi.fn(async () => ROOT) }));

// Mock canonicalizeStatus so the test never depends on the user's real
// templates/states.yml (or its module-level cache). We keep the real semantics:
// case-insensitive label/alias match against the 8 canonical labels, returning
// the canonical label or null. atomicWrite stays REAL so we exercise the actual
// file write path.
const CANON: Record<string, string> = {
  evaluated: "Evaluated",
  applied: "Applied",
  sent: "Applied", // alias
  responded: "Responded",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  discarded: "Discarded",
  skip: "SKIP",
  monitor: "SKIP", // alias
};
vi.mock("@/lib/core/states", () => ({
  canonicalizeStatus: vi.fn((raw: string) => {
    const q = raw.trim().toLowerCase().replace(/\*\*/g, "");
    return CANON[q] ?? null;
  }),
}));

import { POST } from "./route";

const TRACKER = path.join(ROOT, "data", "applications.md");

const HEADER = "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |";
const SEP = "|---|------|---------|------|-------|--------|-----|--------|-------|";

const writeTracker = (rows: string[]) => {
  fs.mkdirSync(path.dirname(TRACKER), { recursive: true });
  fs.writeFileSync(TRACKER, [HEADER, SEP, ...rows].join("\n"), "utf8");
};

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/status", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  fs.rmSync(path.join(ROOT, "data"), { recursive: true, force: true });
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("POST /api/status — happy path", () => {
  it("updates the Status cell of an existing row and returns the canonical label", async () => {
    writeTracker([
      "| 1 | 2026-06-01 | Acme | PM | 4.5 | Applied | yes | r1.md | strong |",
      "| 2 | 2026-06-02 | Globex | APM | 3.0 | Evaluated | no | r2.md |  |",
    ]);
    const res = await post({ n: "2", status: "interview" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, status: "Interview" });

    // Row 2's Status cell flipped to the canonical label; row 1 untouched.
    const md = fs.readFileSync(TRACKER, "utf8");
    const row2 = md.split("\n").find((l) => l.includes("| 2 |"))!;
    expect(row2.split("|")[6].trim()).toBe("Interview");
    const row1 = md.split("\n").find((l) => l.includes("| 1 |"))!;
    expect(row1.split("|")[6].trim()).toBe("Applied");
  });

  it("canonicalizes an alias to its label before writing", async () => {
    writeTracker(["| 7 | 2026-06-01 | Acme | PM | 4.5 | Applied | yes | r1.md | x |"]);
    const res = await post({ n: "7", status: "sent" }); // alias for Applied
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, status: "Applied" });
  });

  it("rejects markdown-bold-wrapped status as table-breaking (route blocks '*' before stripping)", async () => {
    // canonicalizeStatus() strips '**' internally, but the route's table-breaking
    // guard at route.ts:24 rejects ANY '*' first — so '**offer**' never reaches it.
    // The internal strip path is unreachable from this route; we assert the 400.
    writeTracker(["| 3 | 2026-06-01 | Acme | PM | 4.5 | Applied | yes | r1.md | x |"]);
    const res = await post({ n: "3", status: "**offer**" });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "invalid status (table-breaking characters)" });
  });

  it("detects the Status column in an 8-column (no Notes) layout from the header", async () => {
    // 8-col header: Status is still at split-index 6.
    fs.mkdirSync(path.dirname(TRACKER), { recursive: true });
    fs.writeFileSync(
      TRACKER,
      [
        "| # | Date | Company | Role | Score | Status | PDF | Report |",
        "|---|------|---------|------|-------|--------|-----|--------|",
        "| 1 | 2026-06-01 | Acme | PM | 4.5 | Applied | yes | r1.md |",
      ].join("\n"),
      "utf8",
    );
    const res = await post({ n: "1", status: "rejected" });
    expect(res.status).toBe(200);
    const md = fs.readFileSync(TRACKER, "utf8");
    const row = md.split("\n").find((l) => l.includes("| 1 |"))!;
    expect(row.split("|")[6].trim()).toBe("Rejected");
  });

  it("writes atomically — only the target file remains (no stray tmp files)", async () => {
    writeTracker(["| 1 | 2026-06-01 | Acme | PM | 4.5 | Applied | yes | r1.md | x |"]);
    await post({ n: "1", status: "offer" });
    const leftovers = fs
      .readdirSync(path.join(ROOT, "data"))
      .filter((f) => f.startsWith("applications.md.tmp-"));
    expect(leftovers).toEqual([]);
  });
});

describe("POST /api/status — validation / errors", () => {
  it("returns 400 'bad json' on a malformed body", async () => {
    const res = await post("{ not json");
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "bad json" });
  });

  it("returns 400 when n is missing", async () => {
    const res = await post({ status: "Applied" });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "n and status required" });
  });

  it("returns 400 when status is missing", async () => {
    const res = await post({ n: "1" });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "n and status required" });
  });

  it("returns 400 when status is a non-string", async () => {
    const res = await post({ n: "1", status: 42 });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "n and status required" });
  });

  it("returns 400 when status is blank/whitespace", async () => {
    const res = await post({ n: "1", status: "   " });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "n and status required" });
  });

  it("rejects table-breaking characters (pipe) with 400", async () => {
    const res = await post({ n: "1", status: "App|lied" });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "invalid status (table-breaking characters)" });
  });

  it("rejects table-breaking characters (newline) with 400", async () => {
    const res = await post({ n: "1", status: "Applied\nRejected" });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "invalid status (table-breaking characters)" });
  });

  it("rejects an asterisk (markdown bold marker) anywhere as table-breaking with 400", async () => {
    // A lone '*' is in the reject set even though '**' would be stripped later.
    const res = await post({ n: "1", status: "App*lied" });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "invalid status (table-breaking characters)" });
  });

  it("returns 400 for a non-canonical status", async () => {
    const res = await post({ n: "1", status: "Ghosted" });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "not a canonical status: Ghosted" });
  });

  it("returns 404 when the tracker file does not exist", async () => {
    // No data/applications.md written for this test.
    const res = await post({ n: "1", status: "Applied" });
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "tracker not found" });
  });

  it("returns 404 when the requested row number is not present", async () => {
    writeTracker(["| 1 | 2026-06-01 | Acme | PM | 4.5 | Applied | yes | r1.md | x |"]);
    const res = await post({ n: "99", status: "Applied" });
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "row not found" });
  });

  it("does not modify the file when validation fails before the write", async () => {
    writeTracker(["| 1 | 2026-06-01 | Acme | PM | 4.5 | Applied | yes | r1.md | x |"]);
    const before = fs.readFileSync(TRACKER, "utf8");
    const res = await post({ n: "1", status: "Ghosted" });
    expect(res.status).toBe(400);
    expect(fs.readFileSync(TRACKER, "utf8")).toBe(before);
  });
});
