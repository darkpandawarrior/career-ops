import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPortals } from "./portals-meta";

// readPortals(root) reads portals.yml from an explicit root, so we test against a
// throwaway tree — no mocking, no dependence on the user's real data.
let ROOT: string;
const writePortals = (content: string) => fs.writeFileSync(path.join(ROOT, "portals.yml"), content);

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-portals-"));
});
afterEach(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("readPortals — missing / unreadable", () => {
  it("returns empty companies + queries when portals.yml is absent", () => {
    expect(readPortals(ROOT)).toEqual({ companies: [], queries: [] });
  });

  it("returns empty result when the root directory itself does not exist", () => {
    expect(readPortals(path.join(ROOT, "ghost"))).toEqual({ companies: [], queries: [] });
  });
});

describe("readPortals — companies", () => {
  it("parses tracked_companies into name/enabled/notes/url, mapping careers_url -> url", () => {
    writePortals(
      [
        "tracked_companies:",
        "  - name: Acme",
        "    enabled: true",
        "    notes: top target",
        "    careers_url: https://acme.example/careers",
        "  - name: Globex",
        "    enabled: false",
        "    notes: paused",
        "    careers_url: https://globex.example/jobs",
      ].join("\n"),
    );
    const { companies } = readPortals(ROOT);
    expect(companies).toEqual([
      { name: "Acme", enabled: true, notes: "top target", url: "https://acme.example/careers" },
      { name: "Globex", enabled: false, notes: "paused", url: "https://globex.example/jobs" },
    ]);
  });

  it("defaults enabled to true unless explicitly false (missing -> true)", () => {
    writePortals(
      [
        "tracked_companies:",
        "  - name: NoFlag",
        "  - name: ExplicitTrue",
        "    enabled: true",
        "  - name: ExplicitFalse",
        "    enabled: false",
      ].join("\n"),
    );
    const { companies } = readPortals(ROOT);
    expect(companies.map((c) => [c.name, c.enabled])).toEqual([
      ["NoFlag", true],
      ["ExplicitTrue", true],
      ["ExplicitFalse", false],
    ]);
  });

  it("defaults missing notes/url to empty strings", () => {
    writePortals(["tracked_companies:", "  - name: Bare"].join("\n"));
    const { companies } = readPortals(ROOT);
    expect(companies).toEqual([{ name: "Bare", enabled: true, notes: "", url: "" }]);
  });

  it("drops companies with no name (empty or missing)", () => {
    writePortals(
      [
        "tracked_companies:",
        "  - name: Keep",
        "  - notes: nameless",
        "  - name: ''",
        "    notes: empty name",
      ].join("\n"),
    );
    const { companies } = readPortals(ROOT);
    expect(companies.map((c) => c.name)).toEqual(["Keep"]);
  });

  it("returns no companies when tracked_companies is absent or not an array", () => {
    writePortals("tracked_companies: not-a-list");
    expect(readPortals(ROOT).companies).toEqual([]);
  });

  it("coerces non-string notes/url values to strings", () => {
    writePortals(
      [
        "tracked_companies:",
        "  - name: Numbery",
        "    notes: 42",
        "    careers_url: 7",
      ].join("\n"),
    );
    const { companies } = readPortals(ROOT);
    expect(companies[0].notes).toBe("42");
    expect(companies[0].url).toBe("7");
  });
});

describe("readPortals — queries", () => {
  it("parses search_queries into name/enabled, defaulting enabled to true", () => {
    writePortals(
      [
        "search_queries:",
        "  - name: senior android pune",
        "  - name: lead engineer remote",
        "    enabled: false",
      ].join("\n"),
    );
    const { queries } = readPortals(ROOT);
    expect(queries).toEqual([
      { name: "senior android pune", enabled: true },
      { name: "lead engineer remote", enabled: false },
    ]);
  });

  it("drops queries with no name", () => {
    writePortals(
      [
        "search_queries:",
        "  - name: keep me",
        "  - enabled: true",
        "  - name: ''",
      ].join("\n"),
    );
    const { queries } = readPortals(ROOT);
    expect(queries.map((q) => q.name)).toEqual(["keep me"]);
  });

  it("returns no queries when search_queries is absent", () => {
    writePortals("tracked_companies: []");
    expect(readPortals(ROOT).queries).toEqual([]);
  });
});

describe("readPortals — malformed / empty YAML", () => {
  it("returns empty result for invalid YAML (parse throws -> caught)", () => {
    writePortals("tracked_companies: [unterminated\n  : :");
    expect(readPortals(ROOT)).toEqual({ companies: [], queries: [] });
  });

  it("returns empty result for an empty file (yaml.load -> null, coerced to {})", () => {
    writePortals("");
    expect(readPortals(ROOT)).toEqual({ companies: [], queries: [] });
  });

  it("parses both companies and queries together in one document", () => {
    writePortals(
      [
        "tracked_companies:",
        "  - name: Acme",
        "    careers_url: https://acme.example",
        "search_queries:",
        "  - name: android lead",
      ].join("\n"),
    );
    const meta = readPortals(ROOT);
    expect(meta.companies).toHaveLength(1);
    expect(meta.queries).toHaveLength(1);
    expect(meta.companies[0].name).toBe("Acme");
    expect(meta.queries[0].name).toBe("android lead");
  });
});
