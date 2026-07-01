import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Application } from "@/lib/career-ops";

// A throwaway profile root. requestRoot() (mocked below) resolves here, so the
// route reads THIS root's data/scan-history.tsv and applications.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-whatsnew-"));
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });

// requestRoot is async in the real registry → mock returns a resolved root.
vi.mock("@/lib/profile-registry", () => ({
  requestRoot: vi.fn(async () => ROOT),
}));

// readApplications drives the "already evaluated → don't resurface" exclusion.
const readApplications = vi.fn<(root?: string) => Application[]>(() => []);
vi.mock("@/lib/career-ops", () => ({
  readApplications: (root?: string) => readApplications(root),
}));

import { GET } from "./route";

const HEADER = "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation";

/** Write data/scan-history.tsv as a header row + data rows. */
function writeHistory(rows: string[]) {
  fs.writeFileSync(path.join(ROOT, "data", "scan-history.tsv"), [HEADER, ...rows].join("\n"));
}

/** YYYY-MM-DD `n` days before now (n=0 → today). */
function dateNDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/** Build a tab-joined row. */
function row(o: {
  url?: string;
  firstSeen?: string;
  portal?: string;
  title?: string;
  company?: string;
  status?: string;
  location?: string;
}): string {
  return [
    o.url ?? "https://example.com/job",
    o.firstSeen ?? dateNDaysAgo(1),
    o.portal ?? "greenhouse",
    o.title ?? "Senior Engineer",
    o.company ?? "Acme",
    o.status ?? "",
    o.location ?? "Remote",
  ].join("\t");
}

function appOf(company: string): Application {
  return {
    n: "1",
    date: "2026-06-01",
    company,
    role: "Engineer",
    score: "80",
    status: "Applied",
    pdf: "",
    report: "",
    notes: "",
  };
}

async function callGet(days = 7) {
  const res = await GET(new Request(`http://x/api/whats-new?days=${days}`));
  return (await res.json()) as { offers: DiscoveredOfferLite[]; count: number };
}

type DiscoveredOfferLite = {
  url: string;
  company: string;
  title: string;
  location: string;
  postedAt: string;
  ats: string;
  source: string;
};

beforeEach(() => {
  readApplications.mockReset();
  readApplications.mockReturnValue([]);
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("GET /api/whats-new — happy path (recent offers in the day window)", () => {
  it("returns offers first-seen within the window, newest-first by append order", async () => {
    writeHistory([
      row({ url: "https://a.com/1", company: "Alpha", firstSeen: dateNDaysAgo(2) }),
      row({ url: "https://b.com/2", company: "Beta", firstSeen: dateNDaysAgo(1) }),
    ]);
    const body = await callGet(7);
    expect(body.count).toBe(2);
    // Pass 1 walks rows bottom-up → most-recently-appended first.
    expect(body.offers.map((o) => o.url)).toEqual(["https://b.com/2", "https://a.com/1"]);
    expect(body.offers[0]).toMatchObject({
      url: "https://b.com/2",
      company: "Beta",
      title: "Senior Engineer",
      location: "Remote",
      ats: "greenhouse",
      source: "whats-new",
      postedAt: dateNDaysAgo(1),
    });
  });

  it("excludes rows whose first_seen is older than the cutoff", async () => {
    writeHistory([
      row({ url: "https://old.com/1", company: "Old", firstSeen: dateNDaysAgo(40) }),
      row({ url: "https://new.com/2", company: "New", firstSeen: dateNDaysAgo(3) }),
    ]);
    const body = await callGet(7);
    expect(body.offers.map((o) => o.url)).toEqual(["https://new.com/2"]);
  });

  it("honours a wider days window (?days=7 vs broader)", async () => {
    writeHistory([row({ url: "https://x.com/1", company: "X", firstSeen: dateNDaysAgo(20) })]);
    expect((await callGet(7)).count).toBe(0);
    expect((await callGet(30)).count).toBe(1);
  });
});

describe("GET /api/whats-new — dedup", () => {
  it("dedupes by url, keeping the first (most-recent) occurrence", async () => {
    writeHistory([
      row({ url: "https://dup.com/1", company: "DupCo", firstSeen: dateNDaysAgo(3), title: "Old title" }),
      row({ url: "https://dup.com/1", company: "DupCo", firstSeen: dateNDaysAgo(1), title: "New title" }),
    ]);
    const body = await callGet(7);
    expect(body.count).toBe(1);
    // Bottom-up walk hits the newest row first.
    expect(body.offers[0].title).toBe("New title");
  });
});

describe("GET /api/whats-new — excludes already-evaluated companies", () => {
  it("drops offers whose company is in applications (case/punctuation-insensitive)", async () => {
    readApplications.mockReturnValue([appOf("Acme Corp.")]);
    writeHistory([
      row({ url: "https://a.com/1", company: "acme   corp", firstSeen: dateNDaysAgo(1) }),
      row({ url: "https://b.com/2", company: "Fresh Inc", firstSeen: dateNDaysAgo(1) }),
    ]);
    const body = await callGet(7);
    expect(body.offers.map((o) => o.company)).toEqual(["Fresh Inc"]);
  });

  it("readApplications is consulted with the active root", async () => {
    readApplications.mockReturnValue([]);
    writeHistory([row({ url: "https://a.com/1", company: "Solo", firstSeen: dateNDaysAgo(1) })]);
    await callGet(7);
    expect(readApplications).toHaveBeenCalledWith(ROOT);
  });
});

describe("GET /api/whats-new — row filtering (toOffer guards)", () => {
  it("skips rows with a missing or non-http(s) url", async () => {
    writeHistory([
      row({ url: "", company: "NoUrl", firstSeen: dateNDaysAgo(1) }),
      row({ url: "ftp://nope.com/x", company: "Ftp", firstSeen: dateNDaysAgo(1) }),
      row({ url: "https://ok.com/1", company: "Ok", firstSeen: dateNDaysAgo(1) }),
    ]);
    const body = await callGet(7);
    expect(body.offers.map((o) => o.url)).toEqual(["https://ok.com/1"]);
  });

  it("skips rows whose status is skipped/expired (case-insensitive)", async () => {
    writeHistory([
      row({ url: "https://a.com/1", company: "A", firstSeen: dateNDaysAgo(1), status: "Skipped" }),
      row({ url: "https://b.com/2", company: "B", firstSeen: dateNDaysAgo(1), status: "EXPIRED" }),
      row({ url: "https://c.com/3", company: "C", firstSeen: dateNDaysAgo(1), status: "open" }),
    ]);
    const body = await callGet(7);
    expect(body.offers.map((o) => o.url)).toEqual(["https://c.com/3"]);
  });

  it("strips a -full suffix from the portal and defaults blank portal to 'other'", async () => {
    writeHistory([
      row({ url: "https://a.com/1", company: "A", firstSeen: dateNDaysAgo(1), portal: "lever-full" }),
      row({ url: "https://b.com/2", company: "B", firstSeen: dateNDaysAgo(1), portal: "" }),
    ]);
    const body = await callGet(7);
    const byUrl = Object.fromEntries(body.offers.map((o) => [o.url, o.ats]));
    expect(byUrl["https://a.com/1"]).toBe("lever");
    expect(byUrl["https://b.com/2"]).toBe("other");
  });

  it("defaults missing trailing columns (short row) to empty strings / 'other'", async () => {
    // A row with only url + first_seen present (portal/title/company/status/location
    // are undefined after split) → the `(x || "")` defaults kick in.
    fs.writeFileSync(
      path.join(ROOT, "data", "scan-history.tsv"),
      [HEADER, `https://short.com/1\t${dateNDaysAgo(1)}`].join("\n"),
    );
    const body = await callGet(7);
    expect(body.count).toBe(1);
    expect(body.offers[0]).toMatchObject({
      url: "https://short.com/1",
      company: "",
      title: "",
      location: "",
      ats: "other",
      source: "whats-new",
      postedAt: dateNDaysAgo(1),
    });
  });

  it("blanks postedAt when first_seen is not a YYYY-MM-DD date but still parseable enough to count", async () => {
    // A full ISO timestamp IS Date.parse-able (so it passes the window filter and
    // marks anyDated), but does NOT match the strict /^\d{4}-\d{2}-\d{2}$/ → postedAt "".
    const iso = new Date(Date.now() - 1 * 86_400_000).toISOString(); // includes time
    writeHistory([row({ url: "https://a.com/1", company: "A", firstSeen: iso })]);
    const body = await callGet(7);
    expect(body.count).toBe(1);
    expect(body.offers[0].postedAt).toBe("");
  });
});

describe("GET /api/whats-new — caps at 24", () => {
  it("returns at most 24 offers even when more are in-window", async () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row({ url: `https://c.com/${i}`, company: `Co${i}`, firstSeen: dateNDaysAgo(1) }),
    );
    writeHistory(rows);
    const body = await callGet(7);
    expect(body.count).toBe(24);
    expect(body.offers).toHaveLength(24);
  });
});

describe("GET /api/whats-new — legacy no-dates fallback", () => {
  it("falls back to most-recent-by-append-order rows when NO row has a parseable date", async () => {
    // No first_seen is Date.parse-able → pass 1 yields nothing AND anyDated stays false.
    writeHistory([
      row({ url: "https://a.com/1", company: "A", firstSeen: "n/a" }),
      row({ url: "https://b.com/2", company: "B", firstSeen: "" }),
      row({ url: "https://c.com/3", company: "C", firstSeen: "unknown" }),
    ]);
    const body = await callGet(7);
    // Bottom-up walk → newest-appended first; postedAt blank (non-date).
    expect(body.offers.map((o) => o.url)).toEqual([
      "https://c.com/3",
      "https://b.com/2",
      "https://a.com/1",
    ]);
    expect(body.offers.every((o) => o.postedAt === "")).toBe(true);
  });

  it("the fallback still excludes evaluated companies and caps at 12", async () => {
    readApplications.mockReturnValue([appOf("Skip Me")]);
    const rows = [
      row({ url: "https://skip.com/x", company: "Skip Me", firstSeen: "n/a" }),
      ...Array.from({ length: 20 }, (_, i) =>
        row({ url: `https://l.com/${i}`, company: `Legacy${i}`, firstSeen: "n/a" }),
      ),
    ];
    writeHistory(rows);
    const body = await callGet(7);
    expect(body.count).toBe(12);
    expect(body.offers.some((o) => o.company === "Skip Me")).toBe(false);
  });

  it("does NOT trigger the fallback when at least one row is dated but out-of-window", async () => {
    // anyDated=true (the old row parses) → fallback is suppressed even though
    // pass 1 surfaced zero in-window offers. Result: a true 'all caught up'.
    writeHistory([row({ url: "https://a.com/1", company: "A", firstSeen: dateNDaysAgo(40) })]);
    const body = await callGet(7);
    expect(body.count).toBe(0);
    expect(body.offers).toEqual([]);
  });
});

describe("GET /api/whats-new — missing history file", () => {
  it("returns empty when data/scan-history.tsv does not exist", async () => {
    fs.rmSync(path.join(ROOT, "data", "scan-history.tsv"), { force: true });
    const body = await callGet(7);
    expect(body).toEqual({ offers: [], count: 0 });
  });
});

describe("GET /api/whats-new — days clamping", () => {
  it("clamps days to [1,30] and defaults to 7 for non-numeric input", async () => {
    writeHistory([row({ url: "https://a.com/1", company: "A", firstSeen: dateNDaysAgo(20) })]);
    // days=999 → clamped to 30 → 20-day-old row is in-window.
    const res999 = await GET(new Request("http://x/api/whats-new?days=999"));
    expect((await res999.json()).count).toBe(1);
    // days=0 → clamped to 1 → 20-day-old row is out.
    const res0 = await GET(new Request("http://x/api/whats-new?days=0"));
    expect((await res0.json()).count).toBe(0);
    // no days param → default 7 → out.
    const resNone = await GET(new Request("http://x/api/whats-new"));
    expect((await resNone.json()).count).toBe(0);
  });
});
