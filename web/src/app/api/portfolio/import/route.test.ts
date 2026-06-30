import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let ROOT: string;
vi.mock("@/lib/profile-registry", () => ({ requestRoot: vi.fn(async () => ROOT) }));

import { readPortfolio } from "@/lib/portfolio/context";
import { POST } from "./route";

const req = (body: unknown) => new Request("http://x/api/portfolio/import", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-import-"));
});
afterEach(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("POST /api/portfolio/import", () => {
  it("imports a portfolio-site module → persists a version + renders", async () => {
    const mod = {
      profile: { name: "Ada Lovelace", title: "Staff Engineer", tagline: "I ship systems." },
      metrics: [{ value: "10x", label: "throughput" }],
      caseStudies: [{ slug: "b", title: "Bernoulli", summary: "Computed numbers." }],
    };
    const res = await POST(req({ module: mod }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.html).toContain("Ada Lovelace");
    expect(body.versions.length).toBe(1);

    const state = readPortfolio(ROOT);
    expect(state.exists).toBe(true);
    expect(state.data?.name).toBe("Ada Lovelace");
    expect(state.data?.metrics?.[0].value).toBe("10x");
  });

  it("accepts a ready PortfolioData via `data`", async () => {
    const res = await POST(req({ data: { name: "Grace Hopper", title: "Engineer", tagline: "Compilers." } }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(readPortfolio(ROOT).data?.name).toBe("Grace Hopper");
  });

  it("finalize:true bookmarks the imported version as production", async () => {
    const res = await POST(req({ module: { profile: { name: "Ada", title: "X", tagline: "y" } }, finalize: true }));
    const body = await res.json();
    expect(body.final).toBe(body.stamp);
    expect(readPortfolio(ROOT).final).toBe(body.stamp);
  });

  it("rejects empty/unimportable payloads and bad json", async () => {
    expect((await POST(req({ module: {} }))).status).toBe(400); // no name
    expect((await POST(req({ data: { title: "no name" } }))).status).toBe(400);
    expect((await POST(new Request("http://x/api/portfolio/import", { method: "POST", body: "{bad" }))).status).toBe(400);
  });
});
