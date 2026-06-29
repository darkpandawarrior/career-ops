import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DiscoveredOffer, ExploreFilters, ScanEvent } from "@/lib/explore";

/**
 * POST /api/explore is the FREE deterministic discovery surface. It:
 *   1. parses the request body into ExploreFilters,
 *   2. resolves the ACTIVE profile's data root (requestRoot),
 *   3. guards on the scanner script existing (fs.existsSync(rootScript(...))),
 *   4. streams NDJSON: a `start` envelope, every ScanEvent runDiscovery emits,
 *      then a terminal `done` carrying the offers + zero cost.
 *
 * We mock the seam below the route — `runDiscovery` (its own scan.test.ts already
 * drives the real child-process parsing) — plus `requestRoot`, `rootScript`, and
 * `fs.existsSync`. Nothing real spawns, no profile data is touched, and we assert
 * on the exact NDJSON the route emits.
 */

const h = vi.hoisted(() => ({
  // What requestRoot resolves to (the profile-scoped data root the route passes
  // through to runDiscovery).
  dataRoot: "/fake/data/root",
  // Toggles the scanner-availability guard (fs.existsSync(rootScript(...))).
  scannerExists: true,
  // runDiscovery behavior, swapped per test.
  runDiscovery: vi.fn(),
}));

vi.mock("@/lib/profile-registry", () => ({
  requestRoot: vi.fn(async () => h.dataRoot),
}));

vi.mock("@/lib/career-ops", () => ({
  rootScript: (name: string) => `/fake/engine/${name}.mjs`,
}));

vi.mock("@/lib/core/scan", () => ({
  runDiscovery: (...args: unknown[]) => h.runDiscovery(...args),
}));

vi.mock("node:fs", () => ({
  default: { existsSync: vi.fn(() => h.scannerExists) },
  existsSync: vi.fn(() => h.scannerExists),
}));

import type { NextRequest } from "next/server";
import { POST } from "./route";

function makeReq(body?: unknown): NextRequest {
  return new Request("http://localhost/api/explore", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as unknown as NextRequest;
}

/** Read a Response's NDJSON body into an array of parsed envelopes. */
async function readNdjson(res: Response): Promise<ScanEvent[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ScanEvent);
}

beforeEach(() => {
  h.dataRoot = "/fake/data/root";
  h.scannerExists = true;
  // Default: a discovery that emits nothing and finds nothing.
  h.runDiscovery.mockReset();
  h.runDiscovery.mockResolvedValue([] as DiscoveredOffer[]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/explore — streaming envelope contract", () => {
  it("emits a start envelope then a done envelope when the scanner emits nothing", async () => {
    const res = await POST(makeReq({}));
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");

    const events = await readNdjson(res);
    // Exactly two envelopes: start + done (no intermediate scan events).
    expect(events).toHaveLength(2);

    const start = events[0];
    expect(start.kind).toBe("start");
    expect(start).toMatchObject({ kind: "start", free: true });

    const done = events[events.length - 1];
    expect(done).toMatchObject({ kind: "done", count: 0, offers: [], cost: { tokens: 0, usd: 0 } });
  });

  it("start envelope mirrors the parsed filters (default ats/sinceDays/limit on empty body)", async () => {
    const res = await POST(makeReq({}));
    const [start] = await readNdjson(res);
    expect(start).toMatchObject({
      kind: "start",
      ats: ["greenhouse", "lever", "ashby", "workday"],
      sinceDays: 7,
      limit: 150,
      free: true,
    });
  });

  it("propagates client filter overrides into the start envelope", async () => {
    const res = await POST(makeReq({ since: 14, limit: 300, ats: ["greenhouse", "lever"] }));
    const [start] = await readNdjson(res);
    expect(start).toMatchObject({ kind: "start", ats: ["greenhouse", "lever"], sinceDays: 14, limit: 300 });
  });

  it("forwards the parsed filters + resolved profile root to runDiscovery", async () => {
    h.dataRoot = "/profiles/lakshita";
    await POST(makeReq({ positive: ["android"], since: 10 })).then(readNdjson);

    expect(h.runDiscovery).toHaveBeenCalledTimes(1);
    const [filters, , root] = h.runDiscovery.mock.calls[0] as [ExploreFilters, unknown, string];
    expect(filters.positive).toEqual(["android"]);
    expect(filters.sinceDays).toBe(10);
    expect(root).toBe("/profiles/lakshita");
  });

  it("relays every ScanEvent runDiscovery reports, in order, between start and done", async () => {
    const scanEvents: ScanEvent[] = [
      { kind: "atsStart", ats: "greenhouse", companies: 12 },
      { kind: "progress", ats: "greenhouse", scanned: 6, total: 12, matches: 2 },
      { kind: "atsDone", ats: "greenhouse", unreachable: 1 },
      { kind: "summary", companiesScanned: 12, unreachable: 1, matches: 2 },
    ];
    h.runDiscovery.mockImplementation(
      async (_f: ExploreFilters, onEvent: (e: ScanEvent) => void) => {
        for (const e of scanEvents) onEvent(e);
        return [];
      },
    );

    const events = await POST(makeReq({})).then(readNdjson);
    expect(events[0].kind).toBe("start");
    expect(events[events.length - 1].kind).toBe("done");
    // The middle is exactly the relayed scan events, in order.
    expect(events.slice(1, -1)).toEqual(scanEvents);
  });

  it("done.count + done.offers reflect the offers runDiscovery resolves with", async () => {
    const offer: DiscoveredOffer = {
      url: "https://boards.greenhouse.io/acme/jobs/1",
      company: "Acme",
      title: "Senior Android Engineer",
      location: "Pune",
      postedAt: "2026-06-01",
      ats: "greenhouse",
      source: "greenhouse-full",
    };
    h.runDiscovery.mockImplementation(
      async (_f: ExploreFilters, onEvent: (e: ScanEvent) => void) => {
        onEvent({ kind: "offer", offer });
        return [offer];
      },
    );

    const events = await POST(makeReq({})).then(readNdjson);
    const done = events[events.length - 1] as Extract<ScanEvent, { kind: "done" }>;
    expect(done.count).toBe(1);
    expect(done.offers).toEqual([offer]);
    // The offer event was also relayed live.
    expect(events.some((e) => e.kind === "offer")).toBe(true);
  });

  it("emits an error envelope (then still done) when runDiscovery throws", async () => {
    h.runDiscovery.mockRejectedValue(new Error("boom in the scanner"));
    const events = await POST(makeReq({})).then(readNdjson);

    expect(events[0].kind).toBe("start");
    expect(events).toContainEqual({ kind: "error", message: "boom in the scanner" });
    // The stream always terminates with a done (count 0, no offers).
    const done = events[events.length - 1];
    expect(done).toMatchObject({ kind: "done", count: 0, offers: [] });
  });

  it("uses a generic error message when runDiscovery rejects with a non-Error", async () => {
    h.runDiscovery.mockRejectedValue("string failure");
    const events = await POST(makeReq({})).then(readNdjson);
    expect(events).toContainEqual({ kind: "error", message: "discovery failed" });
  });

  it("defaults to DEFAULT_FILTERS (no throw, start emitted) when the body is not valid JSON", async () => {
    const req = new Request("http://localhost/api/explore", { method: "POST", body: "{ not json" }) as unknown as NextRequest;
    const res = await POST(req);
    const events = await readNdjson(res);
    const [start] = events;
    expect(start).toMatchObject({ kind: "start", sinceDays: 7, limit: 150, free: true });
    expect(events[events.length - 1].kind).toBe("done");
  });

  it("returns a soft 400 (no stream) when the scanner script is absent in this checkout", async () => {
    h.scannerExists = false;
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/discovery scanner isn't available/i);
    // The guard short-circuits before runDiscovery is ever invoked.
    expect(h.runDiscovery).not.toHaveBeenCalled();
  });
});
