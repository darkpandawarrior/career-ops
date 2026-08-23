import { describe, it, expect, vi, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as yaml from "js-yaml";

// A DECOY engine root. careerOpsRoot() is mocked to point here so that any test
// which forgets to pass `root` (or any regression where seedExploreFilters reads
// the engine root instead of the passed root) would seed from THIS tree — which
// we deliberately fill with poison values that must never appear in results.
const DECOY = fs.mkdtempSync(path.join(os.tmpdir(), "co-portals-decoy-"));
fs.writeFileSync(
  path.join(DECOY, "portals.yml"),
  `title_filter:\n  positive:\n    - DECOY_ENGINE_ROLE\nlocation_filter:\n  allow:\n    - DECOY_ENGINE_LOC\n`,
  "utf8",
);

vi.mock("@/lib/career-ops", () => ({ careerOpsRoot: () => DECOY }));

import {
  serializePortals,
  writeTempPortals,
  cleanupTempPortals,
  seedExploreFilters,
  normalizeKeywords,
} from "./portals";
import { DEFAULT_FILTERS } from "@/lib/explore";

// Track temp roots we create so we can clean them up.
const tmpRoots: string[] = [];
function makeRoot(): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), "co-portals-root-"));
  tmpRoots.push(r);
  return r;
}

afterEach(() => {
  // nothing global to reset, but keep symmetry for future stubs
});
afterAll(() => {
  for (const r of tmpRoots) fs.rmSync(r, { recursive: true, force: true });
  fs.rmSync(DECOY, { recursive: true, force: true });
});

const EMPTY_LISTS = {
  positive: [] as string[],
  negative: [] as string[],
  allow: [] as string[],
  block: [] as string[],
  alwaysAllow: [] as string[],
  blockHard: [] as string[],
};

describe("serializePortals", () => {
  it("emits an empty (header-only) document when all lists are empty", () => {
    const out = serializePortals(EMPTY_LISTS);
    expect(out).toContain("# Ephemeral Explorer filters");
    expect(out).not.toContain("title_filter");
    expect(out).not.toContain("location_filter");
    // header-only (comment-only) YAML has no document — js-yaml v5 throws on
    // load() here instead of v4's `null` return, so callers must guard it the
    // same way production code does (see loadYaml() in core/portals.ts).
    expect(() => yaml.load(out)).toThrow(/expected a document/);
  });

  it("emits title_filter only when positive/negative present", () => {
    const out = serializePortals({
      ...EMPTY_LISTS,
      positive: ["Product Manager"],
      negative: ["Intern"],
    });
    expect(out).toContain("title_filter:");
    expect(out).not.toContain("location_filter:");
    const doc = yaml.load(out) as Record<string, any>;
    expect(doc.title_filter.positive).toEqual(["Product Manager"]);
    expect(doc.title_filter.negative).toEqual(["Intern"]);
  });

  it("emits location_filter with always_allow > allow > block ordering", () => {
    const out = serializePortals({
      ...EMPTY_LISTS,
      allow: ["Remote"],
      block: ["Onsite"],
      alwaysAllow: ["Pune"],
    });
    expect(out).not.toContain("title_filter:");
    expect(out).toContain("location_filter:");
    // ordering: always_allow appears before allow appears before block
    const iAlways = out.indexOf("always_allow");
    const iAllow = out.indexOf("\n    - " /* allow item */);
    expect(iAlways).toBeGreaterThan(-1);
    expect(out.indexOf("allow")).toBeGreaterThan(-1);
    expect(out.indexOf("block")).toBeGreaterThan(-1);
    expect(out.indexOf("always_allow")).toBeLessThan(out.indexOf("\n  allow:"));
    expect(out.indexOf("\n  allow:")).toBeLessThan(out.indexOf("\n  block:"));
    void iAllow;
    const doc = yaml.load(out) as Record<string, any>;
    expect(doc.location_filter.always_allow).toEqual(["Pune"]);
    expect(doc.location_filter.allow).toEqual(["Remote"]);
    expect(doc.location_filter.block).toEqual(["Onsite"]);
  });

  it("JSON-escapes scalars so colons/quotes/leading-dashes cannot break or inject YAML", () => {
    const nasty = ['Eng: Lead', 'say "hi"', "-startsWithDash", "a\nb", "tab\there"];
    const out = serializePortals({ ...EMPTY_LISTS, positive: nasty });
    // round-trips back to the exact same strings via a real YAML parser
    const doc = yaml.load(out) as Record<string, any>;
    expect(doc.title_filter.positive).toEqual(nasty);
    // each item is a double-quoted scalar (JSON.stringify output)
    expect(out).toContain(`    - ${JSON.stringify("Eng: Lead")}`);
    expect(out).toContain(`    - ${JSON.stringify("-startsWithDash")}`);
  });

  it("is fully round-trippable for a combined title + location filter set", () => {
    const f = {
      positive: ["Android", "Mobile Lead"],
      negative: ["Intern"],
      allow: ["Remote"],
      block: ["Onsite"],
      alwaysAllow: ["Bengaluru"],
      blockHard: [] as string[],
    };
    const doc = yaml.load(serializePortals(f)) as Record<string, any>;
    expect(doc.title_filter).toEqual({ positive: f.positive, negative: f.negative });
    expect(doc.location_filter).toEqual({
      always_allow: f.alwaysAllow,
      allow: f.allow,
      block: f.block,
    });
  });
});

describe("writeTempPortals + cleanupTempPortals", () => {
  it("writes a parseable file under os.tmpdir() with the expected naming", () => {
    const file = writeTempPortals({ ...EMPTY_LISTS, positive: ["PM"] });
    try {
      expect(file.startsWith(os.tmpdir())).toBe(true);
      expect(path.basename(file)).toMatch(/^career-ops-explore-.*\.yml$/);
      expect(fs.existsSync(file)).toBe(true);
      const doc = yaml.load(fs.readFileSync(file, "utf8")) as Record<string, any>;
      expect(doc.title_filter.positive).toEqual(["PM"]);
    } finally {
      cleanupTempPortals(file);
    }
  });

  it("generates a fresh unique path per call", () => {
    const a = writeTempPortals({ ...EMPTY_LISTS, positive: ["A"] });
    const b = writeTempPortals({ ...EMPTY_LISTS, positive: ["B"] });
    try {
      expect(a).not.toBe(b);
      expect(fs.existsSync(a)).toBe(true);
      expect(fs.existsSync(b)).toBe(true);
    } finally {
      cleanupTempPortals(a);
      cleanupTempPortals(b);
    }
  });

  it("removes the file (cleanup actually unlinks)", () => {
    const file = writeTempPortals(EMPTY_LISTS);
    expect(fs.existsSync(file)).toBe(true);
    cleanupTempPortals(file);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("cleanup is idempotent — a second call on an already-removed file does not throw", () => {
    const file = writeTempPortals(EMPTY_LISTS);
    cleanupTempPortals(file);
    expect(() => cleanupTempPortals(file)).not.toThrow();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("cleanup refuses paths outside tmpdir or without the explore marker (path guard)", () => {
    const guarded = makeRoot();
    const decoyFile = path.join(guarded, "real-portals.yml");
    fs.writeFileSync(decoyFile, "title_filter:\n", "utf8");
    // not under tmpdir's explore-marker naming -> guard short-circuits, file survives
    cleanupTempPortals(decoyFile);
    expect(fs.existsSync(decoyFile)).toBe(true);

    // a tmpdir path that lacks the marker substring is also refused
    const noMarker = path.join(os.tmpdir(), "not-an-explore-file.yml");
    fs.writeFileSync(noMarker, "x", "utf8");
    try {
      cleanupTempPortals(noMarker);
      expect(fs.existsSync(noMarker)).toBe(true);
    } finally {
      fs.rmSync(noMarker, { force: true });
    }
  });
});

describe("normalizeKeywords / listFrom", () => {
  it("is re-exported as normalizeKeywords and behaves like cleanChips", () => {
    expect(normalizeKeywords(null)).toEqual([]);
    expect(normalizeKeywords(undefined)).toEqual([]);
    expect(normalizeKeywords("Solo")).toEqual(["Solo"]);
    expect(normalizeKeywords([" A ", "a", "", "B"])).toEqual(["A", "B"]);
    expect(normalizeKeywords([1, {}, null])).toEqual([]);
  });
});

describe("seedExploreFilters", () => {
  it("returns DEFAULT_FILTERS (no seededFrom) for a bare root with no config files", () => {
    const root = makeRoot();
    const { filters, seededFrom } = seedExploreFilters(root);
    expect(seededFrom).toEqual([]);
    expect(filters.positive).toEqual([]);
    expect(filters.negative).toEqual([]);
    expect(filters.allow).toEqual([]);
    expect(filters.block).toEqual([]);
    expect(filters.alwaysAllow).toEqual([]);
    expect(filters.sinceDays).toBe(DEFAULT_FILTERS.sinceDays);
    expect(filters.limitPerAts).toBe(DEFAULT_FILTERS.limitPerAts);
    expect(filters.ats).toEqual(DEFAULT_FILTERS.ats);
    // must NOT mutate the shared DEFAULT_FILTERS.ats array
    expect(filters.ats).not.toBe(DEFAULT_FILTERS.ats);
  });

  it("seeds from the PASSED root's portals.yml (not the decoy engine root)", () => {
    const root = makeRoot();
    fs.writeFileSync(
      path.join(root, "portals.yml"),
      `title_filter:
  positive:
    - Senior Android Engineer
    - Mobile Lead
  negative:
    - Intern
location_filter:
  always_allow:
    - Pune
  allow:
    - Remote
  block:
    - Onsite
`,
      "utf8",
    );
    const { filters, seededFrom } = seedExploreFilters(root);
    expect(seededFrom).toEqual(["portals.yml"]);
    expect(filters.positive).toEqual(["Senior Android Engineer", "Mobile Lead"]);
    expect(filters.negative).toEqual(["Intern"]);
    expect(filters.alwaysAllow).toEqual(["Pune"]);
    expect(filters.allow).toEqual(["Remote"]);
    expect(filters.block).toEqual(["Onsite"]);
    // PROOF it read the passed root, not the decoy: poison values absent
    expect(filters.positive).not.toContain("DECOY_ENGINE_ROLE");
    expect(filters.allow).not.toContain("DECOY_ENGINE_LOC");
  });

  it("falls back to config/profile.yml for positives when portals.yml has none", () => {
    const root = makeRoot();
    // portals.yml with only a location filter (no positives) -> still seeds location,
    // but positive must come from profile.yml
    fs.writeFileSync(
      path.join(root, "portals.yml"),
      `location_filter:\n  block:\n    - Onsite\n`,
      "utf8",
    );
    fs.mkdirSync(path.join(root, "config"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "config", "profile.yml"),
      // Real shape (config/profile.example.yml, and what api/profile/route.ts
      // itself writes): `primary` is a LIST, `archetypes` is a list of
      // {name, level, fit} objects — profile-keywords.mjs only reads that shape.
      `target_roles:
  primary:
    - Staff Android Engineer
  archetypes:
    - name: Mobile Platform Lead
      level: Senior
      fit: primary
    - name: Principal Engineer
      level: Staff
      fit: adjacent
`,
      "utf8",
    );
    const { filters, seededFrom } = seedExploreFilters(root);
    // portals contributed block (so portals.yml is in seededFrom), profile contributed positives
    expect(seededFrom).toContain("portals.yml");
    expect(seededFrom).toContain("profile.yml");
    expect(filters.block).toEqual(["Onsite"]);
    expect(filters.positive).toEqual([
      "Staff Android Engineer",
      "Mobile Platform Lead",
      "Principal Engineer",
    ]);
  });

  it("uses profile.yml alone when there is no portals.yml at all", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "config"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "config", "profile.yml"),
      `target_roles:\n  primary:\n    - Backend Engineer\n`,
      "utf8",
    );
    const { filters, seededFrom } = seedExploreFilters(root);
    expect(seededFrom).toEqual(["profile.yml"]);
    expect(filters.positive).toEqual(["Backend Engineer"]);
  });

  it("does NOT mark portals.yml as a source when it only carries negatives (no positive/allow/block)", () => {
    const root = makeRoot();
    fs.writeFileSync(
      path.join(root, "portals.yml"),
      `title_filter:\n  negative:\n    - Intern\n`,
      "utf8",
    );
    const { filters, seededFrom } = seedExploreFilters(root);
    // negatives are read into filters...
    expect(filters.negative).toEqual(["Intern"]);
    // ...but per source logic, seededFrom is keyed on positive/allow/block only
    expect(seededFrom).not.toContain("portals.yml");
    // and with no positives + no profile.yml, nothing seeds positive
    expect(filters.positive).toEqual([]);
    expect(seededFrom).toEqual([]);
  });

  it("tolerates malformed portals.yml (yaml error) and yields DEFAULT_FILTERS", () => {
    const root = makeRoot();
    fs.writeFileSync(
      path.join(root, "portals.yml"),
      `title_filter:\n  positive:\n  -  : : broken\n   bad-indent\n:::`,
      "utf8",
    );
    const { filters, seededFrom } = seedExploreFilters(root);
    expect(seededFrom).toEqual([]);
    expect(filters.positive).toEqual([]);
  });

  it("ignores a non-object/scalar portals.yml document", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "portals.yml"), `just a scalar string`, "utf8");
    const { filters, seededFrom } = seedExploreFilters(root);
    expect(seededFrom).toEqual([]);
    expect(filters.positive).toEqual([]);
  });

  it("ignores non-string primary / non-array archetypes in profile.yml without throwing", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "config"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "config", "profile.yml"),
      `target_roles:\n  primary: 12345\n  archetypes: notalist\n`,
      "utf8",
    );
    const { filters, seededFrom } = seedExploreFilters(root);
    expect(filters.positive).toEqual([]);
    expect(seededFrom).toEqual([]);
  });
});
