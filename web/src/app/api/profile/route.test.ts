import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as yaml from "js-yaml";

// Mirrors src/app/api/portals/route.test.ts's approach: mock requestRoot() to
// a tmp profile dir so the route reads/writes real files under TMP.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "co-profile-route-"));

vi.mock("@/lib/profile-registry", () => ({ requestRoot: vi.fn(async () => TMP) }));
vi.mock("@/lib/core/safe-write", () => ({
  atomicWriteWithBackup: (file: string, content: string) => fs.writeFileSync(file, content, "utf8"),
}));

import { POST } from "./route";

const profilePath = () => path.join(TMP, "config", "profile.yml");

function makeReq(body: unknown) {
  return new Request("http://localhost/api/profile", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  fs.mkdirSync(path.join(TMP, "config"), { recursive: true });
  fs.rmSync(profilePath(), { force: true });
  fs.rmSync(path.join(TMP, "config", "job-search.yml"), { force: true });
});

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("POST /api/profile — empty-file handling (js-yaml v5 throws on load(''))", () => {
  it("treats an existing empty config/profile.yml as {} rather than refusing as invalid YAML", async () => {
    fs.writeFileSync(profilePath(), "");
    const res = await POST(makeReq({ name: "Alex Doe" }));
    expect(res.status).toBe(200);
    const doc = yaml.load(fs.readFileSync(profilePath(), "utf8")) as Record<string, unknown>;
    expect((doc.candidate as Record<string, unknown>).full_name).toBe("Alex Doe");
  });
});
