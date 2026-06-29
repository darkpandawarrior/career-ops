import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * GET/DELETE /api/portfolio. The route resolves the active profile's data root
 * via requestRoot() (mocked → a tmp dir) and reads/deletes the draft via the
 * REAL @/lib/portfolio/context helpers. We seed a draft on disk with the real
 * writePortfolio so GET surfaces it and DELETE removes it — no mocks of the
 * persistence layer, fully hermetic (tmp root, no real profile data touched).
 */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-portfolio-route-"));

// requestRoot is the only seam: point it at our tmp data root.
vi.mock("@/lib/profile-registry", () => ({ requestRoot: vi.fn(async () => ROOT) }));

import { GET, DELETE } from "./route";
import { writePortfolio } from "@/lib/portfolio/context";
import type { PortfolioData } from "@/lib/portfolio/schema";

const DRAFT_DIR = path.join(ROOT, ".career-ops-web", "portfolio");

function sampleData(over: Partial<PortfolioData> = {}): PortfolioData {
  return {
    name: "Ada Lovelace",
    title: "Senior Engineer",
    tagline: "Builds reliable things",
    metrics: [{ value: "10x", label: "throughput" }],
    ...over,
  };
}

beforeEach(() => {
  // Start each test from a clean draft dir.
  fs.rmSync(path.join(ROOT, ".career-ops-web"), { recursive: true, force: true });
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("GET /api/portfolio", () => {
  it("returns exists:false with empty payload when no draft is present", async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.exists).toBe(false);
    expect(body.data).toBeNull();
    expect(body.html).toBe("");
    expect(body.versions).toEqual([]);
  });

  it("returns the seeded draft (data + rendered html) when one exists", async () => {
    const data = sampleData();
    writePortfolio(data, ROOT, "2026-06-30T00-00-00-000Z");

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.exists).toBe(true);
    expect(body.data).toMatchObject({ name: "Ada Lovelace", title: "Senior Engineer", tagline: "Builds reliable things" });
    // html is the rendered draft.html on disk.
    expect(typeof body.html).toBe("string");
    expect(body.html).toContain("Ada Lovelace");
    expect(body.html.length).toBeGreaterThan(0);
  });

  it("surfaces version snapshots (newest first) written alongside the draft", async () => {
    writePortfolio(sampleData(), ROOT, "2026-06-01T00-00-00-000Z");
    writePortfolio(sampleData(), ROOT, "2026-06-30T00-00-00-000Z");

    const body = await (await GET()).json();
    expect(body.versions).toEqual([
      "2026-06-30T00-00-00-000Z.html",
      "2026-06-01T00-00-00-000Z.html",
    ]);
  });

  it("reflects raw on-disk data.json content (not a re-coerced copy)", async () => {
    const data = sampleData({ email: "ada@example.com", competencies: ["Compose", "Coroutines"] });
    writePortfolio(data, ROOT, "2026-06-30T00-00-00-000Z");

    const body = await (await GET()).json();
    expect(body.data.email).toBe("ada@example.com");
    expect(body.data.competencies).toEqual(["Compose", "Coroutines"]);
  });
});

describe("DELETE /api/portfolio", () => {
  it("removes the active profile's draft and returns ok", async () => {
    writePortfolio(sampleData(), ROOT, "2026-06-30T00-00-00-000Z");
    expect(fs.existsSync(DRAFT_DIR)).toBe(true);

    const res = await DELETE();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(fs.existsSync(DRAFT_DIR)).toBe(false);
  });

  it("is a no-op (still ok) when there is no draft to delete", async () => {
    expect(fs.existsSync(DRAFT_DIR)).toBe(false);
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("DELETE then GET reports the draft is gone", async () => {
    writePortfolio(sampleData(), ROOT, "2026-06-30T00-00-00-000Z");
    await DELETE();
    const body = await (await GET()).json();
    expect(body.exists).toBe(false);
    expect(body.data).toBeNull();
  });
});
