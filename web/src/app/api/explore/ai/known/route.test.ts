import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * GET /api/explore/ai/known returns the de-duplicated set of already-known posting
 * URLs for the ACTIVE profile. The client fetches it once before opening the AI
 * stream and uses it as a silent dedup backstop. The route is a thin wrapper:
 *   assembleDedupContext(requestRoot()).urls -> { urls: [...] }
 * with a catch-all returning { urls: [] }.
 *
 * We mock requestRoot (the resolved profile root) and assembleDedupContext (its
 * own tests cover the parsing), so this verifies ONLY the route's contract:
 * resolves the active root, returns the urls as an array, swallows errors.
 */

const h = vi.hoisted(() => ({
  dataRoot: "/fake/data/root",
  // assembleDedupContext behavior, swapped per test.
  assemble: vi.fn(),
  requestRootMock: vi.fn(),
}));

vi.mock("@/lib/profile-registry", () => ({
  requestRoot: (...a: unknown[]) => h.requestRootMock(...a),
}));

vi.mock("@/lib/core/discover", () => ({
  assembleDedupContext: (...a: unknown[]) => h.assemble(...a),
}));

import { GET } from "./route";

beforeEach(() => {
  h.dataRoot = "/fake/data/root";
  h.requestRootMock.mockReset();
  h.requestRootMock.mockResolvedValue(h.dataRoot);
  h.assemble.mockReset();
  h.assemble.mockReturnValue({ urls: new Set<string>(), lines: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/explore/ai/known", () => {
  it("returns the dedup URL set as a JSON array", async () => {
    h.assemble.mockReturnValue({
      urls: new Set([
        "boards.greenhouse.io/acme/jobs/1",
        "jobs.lever.co/beta/2",
      ]),
      lines: ["unused by this route"],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      urls: ["boards.greenhouse.io/acme/jobs/1", "jobs.lever.co/beta/2"],
    });
  });

  it("returns an empty array when nothing is known yet", async () => {
    h.assemble.mockReturnValue({ urls: new Set<string>(), lines: [] });
    const res = await GET();
    expect(await res.json()).toEqual({ urls: [] });
  });

  it("de-dupes implicitly via the Set (a repeated canonical url appears once)", async () => {
    // A Set already collapses duplicates upstream; assert the spread preserves
    // the de-duplicated membership (no doubles leak through).
    h.assemble.mockReturnValue({
      urls: new Set(["x.test/a", "x.test/a", "x.test/b"]),
      lines: [],
    });
    const body = await (await GET()).json();
    expect(body.urls).toEqual(["x.test/a", "x.test/b"]);
  });

  it("resolves the ACTIVE profile root and passes it to assembleDedupContext", async () => {
    h.requestRootMock.mockResolvedValue("/profiles/jordan");
    await GET();
    expect(h.assemble).toHaveBeenCalledWith("/profiles/jordan");
  });

  it("fails soft with an empty array when assembleDedupContext throws", async () => {
    h.assemble.mockImplementation(() => {
      throw new Error("scan-history read blew up");
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ urls: [] });
  });

  it("fails soft with an empty array when requestRoot rejects", async () => {
    h.requestRootMock.mockRejectedValue(new Error("no request scope"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ urls: [] });
  });
});
