import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

/**
 * scan.ts's pure helpers — `firstMatch` (keyword matching) and `parseOfferLine`
 * (the offer-line parser) — are NOT exported (only `runDiscovery` and the
 * re-exported types/ATS_SOURCES are). We exercise them the only clean way: drive
 * `runDiscovery` with a FAKE child process (spawn mocked) whose stdout/stderr we
 * feed crafted lines. No real process spawns, no fs/network — fully deterministic.
 *
 * `./portals` (writeTempPortals/cleanupTempPortals) and `@/lib/career-ops`
 * (careerOpsRoot/rootScript) are mocked so nothing touches the user's real data.
 */

// A controllable fake ChildProcess. stdout/stderr are EventEmitters; the child
// itself is an EventEmitter for "error"/"close". `kill` is a no-op spy.
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

// Shared mutable state lives in a hoisted holder so the (hoisted) vi.mock
// factories below can reference it without the TDZ error.
const h = vi.hoisted(() => ({
  lastChild: null as InstanceType<typeof FakeChild> | null,
  lastSpawnArgs: null as { cmd: string; args: string[]; opts: Record<string, unknown> } | null,
  writtenFilters: null as unknown,
  cleanupSpy: vi.fn(),
  spawnMock: vi.fn(),
}));

h.spawnMock.mockImplementation((cmd: string, args: string[], opts: Record<string, unknown>) => {
  h.lastChild = new FakeChild();
  h.lastSpawnArgs = { cmd, args, opts };
  return h.lastChild as unknown as ReturnType<typeof import("node:child_process").spawn>;
});

vi.mock("node:child_process", () => ({ spawn: h.spawnMock }));

vi.mock("./portals", () => ({
  writeTempPortals: vi.fn((f: unknown) => {
    h.writtenFilters = f;
    return "/tmp/career-ops-explore-FAKE.yml";
  }),
  cleanupTempPortals: (file: string) => h.cleanupSpy(file),
}));

vi.mock("@/lib/career-ops", () => ({
  careerOpsRoot: () => "/fake/engine/root",
  rootScript: (name: string) => `/fake/engine/root/${name}.mjs`,
}));

import { runDiscovery, ATS_SOURCES } from "./scan";
import { DEFAULT_FILTERS, type ExploreFilters, type ScanEvent } from "@/lib/explore";

function makeFilters(over: Partial<ExploreFilters> = {}): ExploreFilters {
  return { ...DEFAULT_FILTERS, ats: [...DEFAULT_FILTERS.ats], ...over };
}

/**
 * Run the discovery promise while feeding the fake child a script of lines.
 * `feed(lines)` emits them as a single stdout chunk; we then emit "close" and
 * await the resolved offers + collected events.
 */
async function drive(
  filters: ExploreFilters,
  stdoutChunks: string[],
  stderrChunks: string[] = [],
): Promise<{ offers: import("@/lib/explore").DiscoveredOffer[]; events: ScanEvent[] }> {
  const events: ScanEvent[] = [];
  const promise = runDiscovery(filters, (e) => events.push(e), "/fake/data/root");
  // The promise body runs synchronously up to registering the child handlers.
  const child = h.lastChild!;
  for (const chunk of stdoutChunks) child.stdout.emit("data", Buffer.from(chunk));
  for (const chunk of stderrChunks) child.stderr.emit("data", Buffer.from(chunk));
  child.emit("close");
  const offers = await promise;
  return { offers, events };
}

beforeEach(() => {
  h.lastChild = null;
  h.lastSpawnArgs = null;
  h.writtenFilters = null;
  h.spawnMock.mockClear();
  h.cleanupSpy.mockClear();
});

afterEach(() => {
  vi.clearAllTimers();
});

// ── parseOfferLine (exercised via OFFER_RE → offer events) ──────────────────
//
// The engine emits two-line records: a `+ [source] DATE | company | title | loc`
// line, then a following URL line. parseOfferLine parses the part after the date.
describe("parseOfferLine (via runDiscovery offer parsing)", () => {
  it("parses a full offer line: company, title, location, postedAt, ats, source", async () => {
    const { offers } = await drive(makeFilters(), [
      "+ [greenhouse-full] 2026-06-01 | Acme Corp | Senior Android Engineer | Pune, India\n",
      "https://boards.greenhouse.io/acme/jobs/123\n",
    ]);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      company: "Acme Corp",
      title: "Senior Android Engineer",
      location: "Pune, India",
      postedAt: "2026-06-01",
      ats: "greenhouse", // "-full" suffix stripped
      source: "greenhouse-full",
      url: "https://boards.greenhouse.io/acme/jobs/123",
    });
  });

  it("strips the trailing -full suffix from source to derive ats", async () => {
    const { offers } = await drive(makeFilters(), [
      "+ [lever-full] 2026-01-15 | Beta | Eng | Remote\n",
      "https://jobs.lever.co/beta/1\n",
    ]);
    expect(offers[0].source).toBe("lever-full");
    expect(offers[0].ats).toBe("lever");
  });

  it("only strips -full at the END of source (not mid-string)", async () => {
    const { offers } = await drive(makeFilters(), [
      "+ [full-house] 2026-01-15 | Co | Role | Remote\n",
      "https://x.test/1\n",
    ]);
    // replace(/-full$/, "") anchors to end, so "full-house" is unchanged.
    expect(offers[0].ats).toBe("full-house");
  });

  it("treats location 'N/A' as empty string", async () => {
    const { offers } = await drive(makeFilters(), [
      "+ [ashby-full] 2026-03-03 | Gamma | Lead Android | N/A\n",
      "https://jobs.ashbyhq.com/gamma/1\n",
    ]);
    expect(offers[0].location).toBe("");
  });

  it("joins extra ' | '-delimited location segments back together", async () => {
    const { offers } = await drive(makeFilters(), [
      "+ [greenhouse-full] 2026-03-03 | Delta | PM | Berlin | Germany | Hybrid\n",
      "https://x.test/2\n",
    ]);
    // fields = [company, title, ...locationParts]; location = parts.join(" | ")
    expect(offers[0].location).toBe("Berlin | Germany | Hybrid");
  });

  it("blanks postedAt when the date is not strict YYYY-MM-DD", async () => {
    const { offers } = await drive(makeFilters(), [
      "+ [greenhouse-full] N/A | Epsilon | Android Eng | Remote\n",
      "https://x.test/3\n",
    ]);
    expect(offers[0].postedAt).toBe("");
  });

  it("rejects an offer line with fewer than 2 fields (no title) → no offer emitted", async () => {
    // OFFER_RE requires '| <rest>'; rest = "OnlyCompany" splits to a single field.
    const { offers, events } = await drive(makeFilters(), [
      "+ [greenhouse-full] 2026-06-01 | OnlyCompany\n",
      "https://x.test/4\n",
    ]);
    expect(offers).toHaveLength(0);
    expect(events.some((e) => e.kind === "offer")).toBe(false);
  });

  it("does not match a line whose date field is missing (OFFER_RE \\S+ needs a token before ' | ')", async () => {
    // No date token between the source bracket and the first '|', so OFFER_RE
    // fails entirely → no pending offer → nothing emitted. (parseOfferLine's
    // own empty-company guard is not reachable through this entry point, because
    // OFFER_RE's `\s+\|\s+` strips any leading-blank first field before the split.)
    const { offers, events } = await drive(makeFilters(), [
      "+ [greenhouse-full]  | Title Here | Loc\n",
      "https://x.test/5\n",
    ]);
    expect(offers).toHaveLength(0);
    expect(events.some((e) => e.kind === "offer")).toBe(false);
  });

  it("rejects an offer line with an empty title → no offer emitted", async () => {
    const { offers } = await drive(makeFilters(), [
      "+ [greenhouse-full] 2026-06-01 | Acme |  | Loc\n",
      "https://x.test/6\n",
    ]);
    expect(offers).toHaveLength(0);
  });

  it("trims surrounding whitespace from company and title", async () => {
    const { offers } = await drive(makeFilters(), [
      "+ [greenhouse-full] 2026-06-01 |   Spaced Co   |   Spaced Role   | Pune\n",
      "https://x.test/7\n",
    ]);
    expect(offers[0].company).toBe("Spaced Co");
    expect(offers[0].title).toBe("Spaced Role");
  });
});

// ── firstMatch (exercised via matchedKeyword on emitted offers) ─────────────
describe("firstMatch (via matchedKeyword)", () => {
  it("matches the first positive keyword found in the title (case-insensitive)", async () => {
    const { offers } = await drive(makeFilters({ positive: ["staff", "android", "lead"] }), [
      "+ [greenhouse-full] 2026-06-01 | Co | Senior Android Engineer | Pune\n",
      "https://x.test/8\n",
    ]);
    expect(offers[0].matchedKeyword).toBe("android");
  });

  it("returns the FIRST matching keyword by positives order, not title order", async () => {
    // Title contains both "lead" and "android"; positives order is [lead, android].
    const { offers } = await drive(makeFilters({ positive: ["lead", "android"] }), [
      "+ [greenhouse-full] 2026-06-01 | Co | Android Tech Lead | Pune\n",
      "https://x.test/9\n",
    ]);
    expect(offers[0].matchedKeyword).toBe("lead");
  });

  it("is undefined when no positive keyword matches", async () => {
    const { offers } = await drive(makeFilters({ positive: ["ios", "swift"] }), [
      "+ [greenhouse-full] 2026-06-01 | Co | Senior Android Engineer | Pune\n",
      "https://x.test/10\n",
    ]);
    expect(offers[0].matchedKeyword).toBeUndefined();
  });

  it("is undefined when positives is empty (broad search)", async () => {
    const { offers } = await drive(makeFilters({ positive: [] }), [
      "+ [greenhouse-full] 2026-06-01 | Co | Anything | Pune\n",
      "https://x.test/11\n",
    ]);
    expect(offers[0].matchedKeyword).toBeUndefined();
  });

  it("skips empty-string keywords (the `if (k && ...)` guard) and matches a real one", async () => {
    const { offers } = await drive(makeFilters({ positive: ["", "engineer"] }), [
      "+ [greenhouse-full] 2026-06-01 | Co | Backend Engineer | Pune\n",
      "https://x.test/12\n",
    ]);
    // An empty keyword must NOT spuriously match (""+includes is always true).
    expect(offers[0].matchedKeyword).toBe("engineer");
  });

  it("matches a keyword whose casing differs from the title", async () => {
    const { offers } = await drive(makeFilters({ positive: ["ANDROID"] }), [
      "+ [greenhouse-full] 2026-06-01 | Co | senior android dev | Pune\n",
      "https://x.test/13\n",
    ]);
    expect(offers[0].matchedKeyword).toBe("ANDROID");
  });
});

// ── URL pairing / dedupe (handleLine pending logic around the helpers) ──────
describe("offer/URL pairing and dedupe", () => {
  it("does not emit an offer when the offer line is not followed by a URL", async () => {
    const { offers } = await drive(makeFilters(), [
      "+ [greenhouse-full] 2026-06-01 | Co | Android | Pune\n",
      "some non-url line\n",
    ]);
    // pending is dropped on a non-URL, non-offer line.
    expect(offers).toHaveLength(0);
  });

  it("dedupes by URL (same URL twice → single offer)", async () => {
    const { offers } = await drive(makeFilters(), [
      "+ [greenhouse-full] 2026-06-01 | Co | Android A | Pune\n",
      "https://x.test/dup\n",
      "+ [greenhouse-full] 2026-06-01 | Co | Android B | Pune\n",
      "https://x.test/dup\n",
    ]);
    expect(offers).toHaveLength(1);
    expect(offers[0].title).toBe("Android A");
  });

  it("takes only the first whitespace-delimited token of the URL line as the url", async () => {
    const { offers } = await drive(makeFilters(), [
      "+ [greenhouse-full] 2026-06-01 | Co | Android | Pune\n",
      "https://x.test/job?id=1   (trailing junk)\n",
    ]);
    expect(offers[0].url).toBe("https://x.test/job?id=1");
  });

  it("emits multiple distinct offers in order", async () => {
    const { offers, events } = await drive(makeFilters(), [
      "+ [greenhouse-full] 2026-06-01 | Co1 | Role1 | L1\n",
      "https://x.test/a\n",
      "+ [lever-full] 2026-06-02 | Co2 | Role2 | L2\n",
      "https://x.test/b\n",
    ]);
    expect(offers.map((o) => o.company)).toEqual(["Co1", "Co2"]);
    expect(events.filter((e) => e.kind === "offer")).toHaveLength(2);
  });
});

// ── status-line regex parsing (atsStart/progress/atsDone/summary) ───────────
describe("status line parsing", () => {
  it("parses an ⚙ ATS-start line into an atsStart event", async () => {
    const { events } = await drive(makeFilters(), ["⚙ greenhouse — 42 companies\n"]);
    expect(events).toContainEqual({ kind: "atsStart", ats: "greenhouse", companies: 42 });
  });

  it("parses a progress line into a progress event tagged with the current ats", async () => {
    const { events } = await drive(makeFilters(), [
      "⚙ lever — 10 companies\n",
      "  7/10 scanned, 3 total matches\n",
    ]);
    expect(events).toContainEqual({ kind: "progress", ats: "lever", scanned: 7, total: 10, matches: 3 });
  });

  it("parses an ATS-done line into an atsDone event", async () => {
    const { events } = await drive(makeFilters(), [
      "⚙ ashby — 5 companies\n",
      "done (2 unreachable boards skipped)\n",
    ]);
    expect(events).toContainEqual({ kind: "atsDone", ats: "ashby", unreachable: 2 });
  });

  it("parses the final summary, carrying counts accumulated from earlier lines", async () => {
    const { events } = await drive(makeFilters(), [
      "Companies scanned: 120\n",
      "Unreachable boards: 4\n",
      "New matches: 9\n",
    ]);
    expect(events).toContainEqual({ kind: "summary", companiesScanned: 120, unreachable: 4, matches: 9 });
  });

  it("emits stderr lines as log events (non-blank only)", async () => {
    const { events } = await drive(makeFilters(), [], ["warn: board slow\n\n   \n"]);
    const logs = events.filter((e) => e.kind === "log");
    expect(logs).toEqual([{ kind: "log", line: "warn: board slow" }]);
  });
});

// ── chunk/line splitting (CRLF, partial buffers, flush on close) ────────────
describe("line buffering across chunks", () => {
  it("reassembles an offer record split across multiple stdout chunks", async () => {
    const { offers } = await drive(makeFilters(), [
      "+ [greenhouse-full] 2026-06-01 | Split Co | Spli",
      "t Role | Pune\nhttps://x.test/split\n",
    ]);
    expect(offers).toHaveLength(1);
    expect(offers[0].title).toBe("Split Role");
  });

  it("flushes a trailing line (no newline) on close", async () => {
    // The URL has no trailing newline; runDiscovery flushes outBuf on 'close'.
    const events: ScanEvent[] = [];
    const promise = runDiscovery(makeFilters(), (e) => events.push(e), "/r");
    const child = h.lastChild!;
    child.stdout.emit("data", Buffer.from("+ [greenhouse-full] 2026-06-01 | Co | Android | Pune\n"));
    child.stdout.emit("data", Buffer.from("https://x.test/noeol"));
    child.emit("close");
    const offers = await promise;
    expect(offers).toHaveLength(1);
    expect(offers[0].url).toBe("https://x.test/noeol");
  });

  it("handles CRLF line endings", async () => {
    const { offers } = await drive(makeFilters(), [
      "+ [greenhouse-full] 2026-06-01 | CRLF Co | Android | Pune\r\nhttps://x.test/crlf\r\n",
    ]);
    expect(offers).toHaveLength(1);
    expect(offers[0].company).toBe("CRLF Co");
  });
});

// ── spawn wiring + lifecycle (cleanup, error path, arg construction) ────────
describe("runDiscovery spawn wiring and lifecycle", () => {
  it("invokes the scanner with --dry-run and passes through configured args", async () => {
    await drive(makeFilters({ sinceDays: 14, limitPerAts: 200, ats: ["greenhouse"] }), []);
    const args = h.lastSpawnArgs!.args;
    expect(args).toContain("--dry-run");
    expect(args[args.indexOf("--since") + 1]).toBe("14");
    expect(args[args.indexOf("--limit") + 1]).toBe("200");
    expect(args[args.indexOf("--ats") + 1]).toBe("greenhouse");
    expect(args[0]).toBe("/fake/engine/root/scan-ats-full.mjs");
  });

  it("uses the defaults (7 / 150) when sinceDays/limitPerAts are falsy 0 (|| fallback, not the Math.max floor)", async () => {
    // `filters.sinceDays || 7` → 0 is falsy → 7; same for `limitPerAts || 150`.
    await drive(makeFilters({ sinceDays: 0, limitPerAts: 0, ats: ["lever"] }), []);
    const args = h.lastSpawnArgs!.args;
    expect(args[args.indexOf("--since") + 1]).toBe("7");
    expect(args[args.indexOf("--limit") + 1]).toBe("150");
  });

  it("applies the Math.max(1, …) floor when a value is negative (truthy, so it bypasses the || default)", async () => {
    // -5 is truthy → skips the || default → Math.max(1, -5) = 1.
    await drive(makeFilters({ sinceDays: -5, limitPerAts: -3, ats: ["ashby"] }), []);
    const args = h.lastSpawnArgs!.args;
    expect(args[args.indexOf("--since") + 1]).toBe("1");
    expect(args[args.indexOf("--limit") + 1]).toBe("1");
  });

  it("falls back to ALL ats sources when filters.ats is empty", async () => {
    await drive(makeFilters({ ats: [] }), []);
    const args = h.lastSpawnArgs!.args;
    expect(args[args.indexOf("--ats") + 1]).toBe([...ATS_SOURCES].join(","));
  });

  it("filters out unknown ats sources before passing --ats", async () => {
    await drive(makeFilters({ ats: ["greenhouse", "bogus" as never, "lever"] }), []);
    const args = h.lastSpawnArgs!.args;
    expect(args[args.indexOf("--ats") + 1]).toBe("greenhouse,lever");
  });

  it("passes CAREER_OPS_ROOT (the data root arg) and CAREER_OPS_PORTALS (temp file) in env", async () => {
    await drive(makeFilters(), []);
    const env = h.lastSpawnArgs!.opts.env as Record<string, string>;
    expect(env.CAREER_OPS_ROOT).toBe("/fake/data/root");
    expect(env.CAREER_OPS_PORTALS).toBe("/tmp/career-ops-explore-FAKE.yml");
  });

  it("cleans up the temp portals file on close", async () => {
    await drive(makeFilters(), []);
    expect(h.cleanupSpy).toHaveBeenCalledWith("/tmp/career-ops-explore-FAKE.yml");
  });

  it("resolves with offers and cleans up + emits error on a child 'error' event", async () => {
    const events: ScanEvent[] = [];
    const promise = runDiscovery(makeFilters(), (e) => events.push(e), "/r");
    const child = h.lastChild!;
    child.emit("error", new Error("ENOENT spawn"));
    const offers = await promise;
    expect(offers).toEqual([]);
    expect(h.cleanupSpy).toHaveBeenCalled();
    expect(events).toContainEqual({ kind: "error", message: "ENOENT spawn" });
  });

  it("forwards the constructed filters to writeTempPortals", async () => {
    const f = makeFilters({ positive: ["android"], sinceDays: 5 });
    await drive(f, []);
    expect(h.writtenFilters).toBe(f);
  });
});
