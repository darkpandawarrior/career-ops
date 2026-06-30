import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A throwaway engine root with a profiles.yml fixture. careerOpsRoot() is mocked
// to point here so listProfiles()/requestSlug() (real, from profile-registry)
// resolve against a known tree. We create real per-profile dirs so the `exists`
// flag is deterministic (alex exists on disk, jordan does not).
const ENGINE = fs.mkdtempSync(path.join(os.tmpdir(), "co-profiles-route-"));
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
// alex's data dir exists; jordan's intentionally does not.
fs.mkdirSync(path.join(ENGINE, "profiles", "alex"), { recursive: true });

vi.mock("@/lib/career-ops", () => ({ careerOpsRoot: () => ENGINE }));

// Mutable header value the next/headers mock returns for x-co-profile.
let headerValue: string | null = null;
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: (k: string) => (k === "x-co-profile" ? headerValue : null) })),
}));

import { GET } from "./route";

beforeEach(() => {
  headerValue = null;
});

afterAll(() => fs.rmSync(ENGINE, { recursive: true, force: true }));

type ProfileDTO = {
  name: string;
  display_name: string;
  color: string | null;
  exists: boolean;
  active: boolean;
  url: string;
};

describe("GET /api/profiles", () => {
  it("lists only well-formed registry entries (invalid slug + missing root dropped)", async () => {
    const res = await GET();
    const body = (await res.json()) as { profiles: ProfileDTO[]; active: string | null };
    expect(res.status).toBe(200);
    expect(body.profiles.map((p) => p.name)).toEqual(["alex", "jordan"]);
    // 'BAD SLUG' (invalid slug) and 'noroot' (missing root) are filtered by readRegistry.
  });

  it("shapes each entry with name/display_name/color/exists/active/url and no absolute path", async () => {
    const res = await GET();
    const body = (await res.json()) as { profiles: ProfileDTO[]; active: string | null };
    const sid = body.profiles.find((p) => p.name === "alex")!;
    expect(sid).toEqual({
      name: "alex",
      display_name: "Alex Doe",
      color: "#0284c7",
      exists: true,
      active: false,
      url: "/?profile=alex",
    });
    // No leaked filesystem path on any entry.
    for (const p of body.profiles) {
      expect(JSON.stringify(p)).not.toContain(ENGINE);
      expect(Object.keys(p)).not.toContain("absoluteRoot");
    }
  });

  it("defaults color to null when absent in the registry", async () => {
    const res = await GET();
    const body = (await res.json()) as { profiles: ProfileDTO[] };
    const lak = body.profiles.find((p) => p.name === "jordan")!;
    expect(lak.color).toBeNull();
    expect(lak.display_name).toBe("Jordan");
  });

  it("reflects on-disk existence in the exists flag", async () => {
    const res = await GET();
    const body = (await res.json()) as { profiles: ProfileDTO[] };
    expect(body.profiles.find((p) => p.name === "alex")!.exists).toBe(true);
    // jordan's root dir was never created.
    expect(body.profiles.find((p) => p.name === "jordan")!.exists).toBe(false);
  });

  it("marks the active profile from a valid x-co-profile header and sets top-level active", async () => {
    headerValue = "jordan";
    const res = await GET();
    const body = (await res.json()) as { profiles: ProfileDTO[]; active: string | null };
    expect(body.active).toBe("jordan");
    expect(body.profiles.find((p) => p.name === "jordan")!.active).toBe(true);
    expect(body.profiles.find((p) => p.name === "alex")!.active).toBe(false);
  });

  it("has no active profile and no active flags with no header (single-profile request)", async () => {
    headerValue = null;
    const res = await GET();
    const body = (await res.json()) as { profiles: ProfileDTO[]; active: string | null };
    expect(body.active).toBeNull();
    expect(body.profiles.every((p) => p.active === false)).toBe(true);
  });

  it("treats an invalid header slug as no active profile", async () => {
    headerValue = "BAD SLUG"; // fails the slug allowlist -> requestSlug() returns null
    const res = await GET();
    const body = (await res.json()) as { profiles: ProfileDTO[]; active: string | null };
    expect(body.active).toBeNull();
    expect(body.profiles.every((p) => p.active === false)).toBe(true);
  });

  it("treats an unknown (valid-grammar) slug as the active slug but matches no entry", async () => {
    headerValue = "ghost"; // valid grammar, not in registry
    const res = await GET();
    const body = (await res.json()) as { profiles: ProfileDTO[]; active: string | null };
    // requestSlug only validates grammar, not registration -> active echoes the slug.
    expect(body.active).toBe("ghost");
    // ...but no listed profile is named "ghost", so none is marked active.
    expect(body.profiles.every((p) => p.active === false)).toBe(true);
  });
});

describe("GET /api/profiles — single-profile mode (no profiles.yml)", () => {
  it("returns an empty list and null active when the registry is absent", async () => {
    // Point careerOpsRoot at an empty dir with no profiles.yml.
    const EMPTY = fs.mkdtempSync(path.join(os.tmpdir(), "co-profiles-empty-"));
    const careerOps = await import("@/lib/career-ops");
    const spy = vi.spyOn(careerOps, "careerOpsRoot").mockReturnValue(EMPTY);
    try {
      const res = await GET();
      const body = (await res.json()) as { profiles: ProfileDTO[]; active: string | null };
      expect(body.profiles).toEqual([]);
      expect(body.active).toBeNull();
    } finally {
      spy.mockRestore();
      fs.rmSync(EMPTY, { recursive: true, force: true });
    }
  });
});
