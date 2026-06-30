import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let ROOT: string;
vi.mock("@/lib/profile-registry", () => ({ requestRoot: vi.fn(async () => ROOT) }));

import { writePortfolio } from "@/lib/portfolio/context";
import { POST } from "./route";

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-sl-"));
});
afterEach(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("POST /api/portfolio/save-local", () => {
  it("400s when there is no portfolio to save", async () => {
    expect((await POST()).status).toBe(400);
  });

  it("writes the full Vite project (template + this candidate's data) to disk", async () => {
    writePortfolio({ name: "Ada Lovelace", title: "Engineer", tagline: "I build things." }, ROOT);
    const res = await POST();
    const body = await res.json();
    expect(body.ok).toBe(true);
    const site = body.path as string;
    // Core project files landed
    expect(fs.existsSync(path.join(site, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(site, "src/App.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(site, "api/chat.ts"))).toBe(true);
    // Candidate data injected, no build artifacts shipped
    expect(fs.readFileSync(path.join(site, "src/data/profile.ts"), "utf8")).toContain("Ada Lovelace");
    expect(fs.existsSync(path.join(site, "node_modules"))).toBe(false);
  });
});
