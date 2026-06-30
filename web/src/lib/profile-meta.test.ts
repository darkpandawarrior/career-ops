import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readProfileMeta } from "./profile-meta";

// readProfileMeta(root) reads config/profile.yml from an explicit root, so we test
// against a throwaway tree — no mocking, no dependence on the user's real data.
let ROOT: string;
const writeProfile = (content: string) => {
  const dir = path.join(ROOT, "config");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "profile.yml"), content);
};

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-profilemeta-"));
});
afterEach(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("readProfileMeta — missing / unreadable", () => {
  it("returns null when config/profile.yml is absent", () => {
    expect(readProfileMeta(ROOT)).toBeNull();
  });

  it("returns null when the root directory itself does not exist", () => {
    expect(readProfileMeta(path.join(ROOT, "ghost"))).toBeNull();
  });

  it("returns null for invalid YAML (parse throws -> caught)", () => {
    writeProfile("candidate: [unterminated\n  : :");
    expect(readProfileMeta(ROOT)).toBeNull();
  });
});

describe("readProfileMeta — full document", () => {
  beforeEach(() => {
    writeProfile(
      [
        "candidate:",
        "  full_name: Alex Doe",
        "narrative:",
        "  headline: Senior Android Engineer targeting Lead",
        "  superpowers:",
        "    - Jetpack Compose",
        "    - Location Engineering",
        "compensation:",
        "  target_range: 40-60 LPA",
        "  currency: INR",
        "target_roles:",
        "  primary:",
        "    - Senior Android Engineer",
        "    - Lead Android Engineer",
        "  archetypes:",
        "    - name: Scaleup",
        "      level: Senior",
        "      fit: strong",
        "    - name: BigTech",
        "      level: Lead",
        "      fit: medium",
      ].join("\n"),
    );
  });

  it("reads scalar candidate / narrative / compensation fields", () => {
    const meta = readProfileMeta(ROOT)!;
    expect(meta.fullName).toBe("Alex Doe");
    expect(meta.headline).toBe("Senior Android Engineer targeting Lead");
    expect(meta.targetRange).toBe("40-60 LPA");
    expect(meta.currency).toBe("INR");
  });

  it("reads primaryRoles and superpowers string lists", () => {
    const meta = readProfileMeta(ROOT)!;
    expect(meta.primaryRoles).toEqual(["Senior Android Engineer", "Lead Android Engineer"]);
    expect(meta.superpowers).toEqual(["Jetpack Compose", "Location Engineering"]);
  });

  it("reads archetypes as name/level/fit objects", () => {
    const meta = readProfileMeta(ROOT)!;
    expect(meta.archetypes).toEqual([
      { name: "Scaleup", level: "Senior", fit: "strong" },
      { name: "BigTech", level: "Lead", fit: "medium" },
    ]);
  });
});

describe("readProfileMeta — defaults for missing sections", () => {
  it("defaults every field when the document is empty (yaml.load -> null -> {})", () => {
    writeProfile("");
    const meta = readProfileMeta(ROOT)!;
    expect(meta).toEqual({
      fullName: "",
      headline: "",
      targetRange: "",
      currency: "",
      primaryRoles: [],
      archetypes: [],
      superpowers: [],
    });
  });

  it("defaults missing sub-keys to empty strings / empty lists", () => {
    writeProfile(["candidate:", "  full_name: Only Name"].join("\n"));
    const meta = readProfileMeta(ROOT)!;
    expect(meta.fullName).toBe("Only Name");
    expect(meta.headline).toBe("");
    expect(meta.targetRange).toBe("");
    expect(meta.currency).toBe("");
    expect(meta.primaryRoles).toEqual([]);
    expect(meta.archetypes).toEqual([]);
    expect(meta.superpowers).toEqual([]);
  });
});

describe("readProfileMeta — type coercion & filtering", () => {
  it("coerces non-string scalar fields to empty string", () => {
    writeProfile(
      [
        "candidate:",
        "  full_name: 123", // numeric -> str() yields ''
        "compensation:",
        "  target_range: true",
      ].join("\n"),
    );
    const meta = readProfileMeta(ROOT)!;
    expect(meta.fullName).toBe("");
    expect(meta.targetRange).toBe("");
  });

  it("filters non-string entries out of primaryRoles and superpowers", () => {
    writeProfile(
      [
        "narrative:",
        "  superpowers:",
        "    - Compose",
        "    - 42",
        "    - Room",
        "target_roles:",
        "  primary:",
        "    - Senior Android",
        "    - true",
      ].join("\n"),
    );
    const meta = readProfileMeta(ROOT)!;
    expect(meta.superpowers).toEqual(["Compose", "Room"]);
    expect(meta.primaryRoles).toEqual(["Senior Android"]);
  });

  it("returns [] for primary/superpowers when they are not arrays", () => {
    writeProfile(
      [
        "narrative:",
        "  superpowers: not-a-list",
        "target_roles:",
        "  primary: also-not-a-list",
      ].join("\n"),
    );
    const meta = readProfileMeta(ROOT)!;
    expect(meta.superpowers).toEqual([]);
    expect(meta.primaryRoles).toEqual([]);
  });

  it("drops archetypes with no name and coerces missing level/fit to empty strings", () => {
    writeProfile(
      [
        "target_roles:",
        "  archetypes:",
        "    - name: Keep",
        "    - level: nameless", // dropped (no name)
        "    - name: Partial",
        "      level: Senior",
      ].join("\n"),
    );
    const meta = readProfileMeta(ROOT)!;
    expect(meta.archetypes).toEqual([
      { name: "Keep", level: "", fit: "" },
      { name: "Partial", level: "Senior", fit: "" },
    ]);
  });

  it("returns [] for archetypes when it is not an array", () => {
    writeProfile(["target_roles:", "  archetypes: nope"].join("\n"));
    expect(readProfileMeta(ROOT)!.archetypes).toEqual([]);
  });
});
