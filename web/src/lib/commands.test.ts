import { describe, it, expect } from "vitest";
import { COMMAND_CATALOG, type Command, type CommandGroup } from "./commands";

// COMMAND_CATALOG is a static registry surfaced in the ⌘K palette. These tests
// pin its shape (every command has cmd/label/desc), guard against accidental
// duplicate command strings, and assert the two expected groups exist.

const allCommands: Command[] = COMMAND_CATALOG.flatMap((g) => g.commands);

describe("COMMAND_CATALOG shape", () => {
  it("is a non-empty array of groups", () => {
    expect(Array.isArray(COMMAND_CATALOG)).toBe(true);
    expect(COMMAND_CATALOG.length).toBeGreaterThan(0);
  });

  it("exposes exactly the career-ops and interview-coach groups, in that order", () => {
    expect(COMMAND_CATALOG.map((g) => g.group)).toEqual(["career-ops", "interview-coach"]);
  });

  it("every group has a non-empty string name and at least one command", () => {
    for (const g of COMMAND_CATALOG as CommandGroup[]) {
      expect(typeof g.group).toBe("string");
      expect(g.group.length).toBeGreaterThan(0);
      expect(Array.isArray(g.commands)).toBe(true);
      expect(g.commands.length).toBeGreaterThan(0);
    }
  });

  it("every command has non-empty cmd, label, and desc strings", () => {
    for (const c of allCommands) {
      expect(typeof c.cmd).toBe("string");
      expect(c.cmd.trim().length).toBeGreaterThan(0);
      expect(typeof c.label).toBe("string");
      expect(c.label.trim().length).toBeGreaterThan(0);
      expect(typeof c.desc).toBe("string");
      expect(c.desc.trim().length).toBeGreaterThan(0);
    }
  });

  it("command objects carry only the three documented keys", () => {
    for (const c of allCommands) {
      expect(Object.keys(c).sort()).toEqual(["cmd", "desc", "label"]);
    }
  });
});

describe("COMMAND_CATALOG content invariants", () => {
  it("has no duplicate command strings across groups", () => {
    const cmds = allCommands.map((c) => c.cmd);
    expect(new Set(cmds).size).toBe(cmds.length);
  });

  it("career-ops commands are all slash-commands; interview-coach commands are not", () => {
    const careerOps = COMMAND_CATALOG.find((g) => g.group === "career-ops")!;
    const coach = COMMAND_CATALOG.find((g) => g.group === "interview-coach")!;
    expect(careerOps.commands.every((c) => c.cmd.startsWith("/career-ops"))).toBe(true);
    expect(coach.commands.every((c) => !c.cmd.startsWith("/"))).toBe(true);
  });

  it("includes well-known entry points", () => {
    const cmds = allCommands.map((c) => c.cmd);
    expect(cmds).toContain("/career-ops pipeline");
    expect(cmds).toContain("/career-ops oferta {url}");
    expect(cmds).toContain("mock {format}");
    expect(cmds).toContain("debrief");
  });

  it("placeholder commands use the {token} convention", () => {
    const withPlaceholders = allCommands.filter((c) => c.cmd.includes("{"));
    for (const c of withPlaceholders) {
      // every '{' must be paired with a closing '}'
      const open = (c.cmd.match(/\{/g) ?? []).length;
      const close = (c.cmd.match(/\}/g) ?? []).length;
      expect(open).toBe(close);
      expect(open).toBeGreaterThan(0);
    }
  });

  it("labels are unique within each group", () => {
    for (const g of COMMAND_CATALOG) {
      const labels = g.commands.map((c) => c.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});
