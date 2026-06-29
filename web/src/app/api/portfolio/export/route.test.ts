import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * GET /api/portfolio/export. Bundles the active profile's draft into a ZIP
 * (index.html + README-deploy.md) via the REAL buildZip, or 400s when there is
 * no draft. requestRoot is mocked → a tmp root; the draft is seeded with the
 * real writePortfolio. Fully hermetic (no real profile data, no network).
 */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-portfolio-export-"));

vi.mock("@/lib/profile-registry", () => ({ requestRoot: vi.fn(async () => ROOT) }));

import { GET } from "./route";
import { writePortfolio, DEPLOY_README } from "@/lib/portfolio/context";
import type { PortfolioData } from "@/lib/portfolio/schema";

function sampleData(): PortfolioData {
  return { name: "Ada Lovelace", title: "Senior Engineer", tagline: "Builds reliable things" };
}

beforeEach(() => {
  fs.rmSync(path.join(ROOT, ".career-ops-web"), { recursive: true, force: true });
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("GET /api/portfolio/export — no draft", () => {
  it("returns 400 with an explanatory error when nothing has been generated", async () => {
    const res = await GET();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no portfolio to export/i);
  });
});

describe("GET /api/portfolio/export — with a draft", () => {
  beforeEach(() => {
    writePortfolio(sampleData(), ROOT, "2026-06-30T00-00-00-000Z");
  });

  it("returns a ZIP with the correct content-type and attachment disposition", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="portfolio.zip"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("emits real ZIP bytes (local-file-header magic PK\\x03\\x04 + EOCD signature)", async () => {
    const res = await GET();
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Local file header signature at the very start of the archive.
    expect(bytes.length).toBeGreaterThan(22);
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // End-of-central-directory signature (PK\x05\x06) sits in the final 22 bytes.
    const eocd = bytes.subarray(bytes.length - 22);
    expect([eocd[0], eocd[1], eocd[2], eocd[3]]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it("packs both entries: index.html (the rendered draft) and README-deploy.md", async () => {
    const res = await GET();
    const text = Buffer.from(await res.arrayBuffer()).toString("latin1");
    // STORE method stores filenames + raw content verbatim; assert both are present.
    expect(text).toContain("index.html");
    expect(text).toContain("README-deploy.md");
    expect(text).toContain("Ada Lovelace"); // index.html content (rendered draft)
    expect(text).toContain(DEPLOY_README.slice(0, 20)); // README content verbatim
  });

  it("records both entries in the EOCD total-entries field", async () => {
    const res = await GET();
    const bytes = new Uint8Array(await res.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteLength - 22, 22);
    // Offset 10 in the EOCD record = total number of central-directory entries.
    expect(view.getUint16(10, true)).toBe(2);
  });
});
