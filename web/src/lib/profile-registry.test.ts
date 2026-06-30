import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A throwaway engine root with a profiles.yml fixture. careerOpsRoot() is mocked
// to point here so the registry resolves against a known tree.
const ENGINE = fs.mkdtempSync(path.join(os.tmpdir(), "co-registry-"));
fs.writeFileSync(
  path.join(ENGINE, "profiles.yml"),
  `profiles:
  - name: alex
    display_name: Alex Doe
    root: profiles/alex
    color: "#0284c7"
  - name: jordan
    display_name: Jordan
    root: profiles/jordan
  - name: BAD SLUG
    root: profiles/x
  - name: noroot
`,
);

vi.mock("@/lib/career-ops", () => ({ careerOpsRoot: () => ENGINE }));

// Mutable header value the next/headers mock returns.
let headerValue: string | null = null;
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: (k: string) => (k === "x-co-profile" ? headerValue : null) })),
}));

import {
  isValidSlug,
  readRegistry,
  resolveProfileRoot,
  requestSlug,
  requestRoot,
  requestSpawnEnv,
} from "./profile-registry";

beforeEach(() => {
  headerValue = null;
});
afterAll(() => fs.rmSync(ENGINE, { recursive: true, force: true }));

describe("isValidSlug", () => {
  it("accepts lowercase/digits/_/-", () => {
    expect(isValidSlug("jordan")).toBe(true);
    expect(isValidSlug("a-b_9")).toBe(true);
  });
  it("rejects empty, spaces, uppercase, slashes, null", () => {
    for (const bad of ["", "Bad", "a b", "../x", "a/b", null, undefined]) {
      expect(isValidSlug(bad as string)).toBe(false);
    }
  });
});

describe("readRegistry", () => {
  it("parses only well-formed entries (valid slug + string root)", () => {
    const reg = readRegistry();
    expect(reg.map((p) => p.name)).toEqual(["alex", "jordan"]);
    // 'BAD SLUG' (invalid) and 'noroot' (missing root) are dropped.
  });
  it("defaults display_name to the slug when absent", () => {
    expect(readRegistry().find((p) => p.name === "jordan")?.display_name).toBe("Jordan");
  });
});

describe("resolveProfileRoot", () => {
  it("resolves a relative root against the engine root", () => {
    expect(resolveProfileRoot("jordan")).toBe(path.resolve(ENGINE, "profiles/jordan"));
  });
  it("returns null for unknown or invalid slugs (caller falls back to engine root)", () => {
    expect(resolveProfileRoot("ghost")).toBeNull();
    expect(resolveProfileRoot("BAD SLUG")).toBeNull();
    expect(resolveProfileRoot(null)).toBeNull();
  });
});

describe("requestSlug / requestRoot (header-driven)", () => {
  it("requestSlug returns the validated x-co-profile header, else null", async () => {
    headerValue = "jordan";
    expect(await requestSlug()).toBe("jordan");
    headerValue = "BAD SLUG";
    expect(await requestSlug()).toBeNull();
    headerValue = null;
    expect(await requestSlug()).toBeNull();
  });

  it("requestRoot maps a valid profile header to that profile's root", async () => {
    headerValue = "jordan";
    expect(await requestRoot()).toBe(path.resolve(ENGINE, "profiles/jordan"));
  });

  it("requestRoot falls back to the engine root with no/invalid/unknown profile", async () => {
    headerValue = null;
    expect(await requestRoot()).toBe(ENGINE);
    headerValue = "ghost";
    expect(await requestRoot()).toBe(ENGINE);
  });
});

describe("requestSpawnEnv", () => {
  it("injects CAREER_OPS_ROOT for the active profile onto the base env", async () => {
    headerValue = "jordan";
    const env = await requestSpawnEnv({ ...process.env, PATH: "/usr/bin" });
    expect(env.CAREER_OPS_ROOT).toBe(path.resolve(ENGINE, "profiles/jordan"));
    expect(env.PATH).toBe("/usr/bin");
  });
});
