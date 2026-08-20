import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";

// Control which paths "exist" (are X_OK accessible) by mocking node:fs.accessSync.
// The set is mutable so individual tests can declare exactly which absolute paths
// resolve. accessSync throws (like the real fs) when the path is not in the set.
const existing = new Set<string>();
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      accessSync: (p: string) => {
        if (!existing.has(p)) {
          const err = new Error(`ENOENT: no such file, access '${p}'`);
          throw err;
        }
      },
      constants: actual.constants,
    },
    accessSync: (p: string) => {
      if (!existing.has(p)) throw new Error(`ENOENT: no such file, access '${p}'`);
    },
    constants: actual.constants,
  };
});

import { KNOWN, findBin, detectClis, resolveCli, type CliSpec } from "./clis";

beforeEach(() => {
  existing.clear();
});

describe("KNOWN registry", () => {
  it("lists the eight agnostic CLIs with stable ids", () => {
    expect(KNOWN.map((c) => c.id)).toEqual([
      "claude",
      "codex",
      "gemini",
      "opencode",
      "copilot",
      "qwen",
      "antigravity",
      "grok",
    ]);
  });

  it("every spec carries non-empty name/bin/run/url and an args builder", () => {
    for (const c of KNOWN) {
      expect(c.name).toBeTruthy();
      expect(c.bin).toBeTruthy();
      expect(c.run).toBeTruthy();
      expect(c.url).toMatch(/^https?:\/\//);
      expect(typeof c.args).toBe("function");
    }
  });

  it("args(prompt) appends the prompt as the final argv element, except for stdin-fed CLIs", () => {
    for (const c of KNOWN) {
      const argv = c.args("do the thing");
      expect(Array.isArray(argv)).toBe(true);
      if (c.promptViaStdin) {
        // The prompt is piped to child.stdin instead (see api/cv/ingest and
        // api/portfolio/generate) — argv never carries it for this CLI.
        expect(argv).not.toContain("do the thing");
      } else {
        expect(argv[argv.length - 1]).toBe("do the thing");
      }
    }
  });

  it("antigravity ships the agy bin even though its name differs", () => {
    const agy = KNOWN.find((c) => c.id === "antigravity")!;
    expect(agy.bin).toBe("agy");
    expect(agy.args("p")).toEqual(["-p", "p"]);
  });

  it("ids are unique", () => {
    const ids = KNOWN.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("findBin (explicit dirs + mocked accessSync)", () => {
  it("returns the joined path of the first dir where the bin is X_OK accessible", () => {
    const dirs = ["/usr/local/bin", "/usr/bin"];
    existing.add(path.join("/usr/bin", "claude"));
    expect(findBin("claude", dirs)).toBe(path.join("/usr/bin", "claude"));
  });

  it("honours dir order: an earlier match wins over a later one", () => {
    const dirs = ["/opt/homebrew/bin", "/usr/local/bin"];
    existing.add(path.join("/opt/homebrew/bin", "gemini"));
    existing.add(path.join("/usr/local/bin", "gemini"));
    expect(findBin("gemini", dirs)).toBe(path.join("/opt/homebrew/bin", "gemini"));
  });

  it("returns null when the bin exists in no dir", () => {
    const dirs = ["/usr/local/bin", "/usr/bin"];
    expect(findBin("nope", dirs)).toBeNull();
  });

  it("returns null when given an empty dir list", () => {
    existing.add(path.join("/usr/bin", "claude"));
    expect(findBin("claude", [])).toBeNull();
  });

  it("on posix tries only the bare name (no .exe/.cmd candidates)", () => {
    // The presence of a .exe sibling must NOT satisfy the lookup on posix.
    const dirs = ["/usr/bin"];
    existing.add(path.join("/usr/bin", "codex.exe"));
    expect(findBin("codex", dirs)).toBeNull();
    existing.add(path.join("/usr/bin", "codex"));
    expect(findBin("codex", dirs)).toBe(path.join("/usr/bin", "codex"));
  });
});

describe("detectClis (uses real searchDirs(), mocked accessSync)", () => {
  it("flags only the CLIs whose bin resolves, and carries through metadata", () => {
    // Plant exactly two known bins in a dir that searchDirs() always includes.
    const dir = "/usr/local/bin";
    existing.add(path.join(dir, "claude"));
    existing.add(path.join(dir, "gemini"));

    const rows = detectClis();
    // One row per KNOWN spec, same order.
    expect(rows.map((r) => r.id)).toEqual(KNOWN.map((c) => c.id));

    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.claude.installed).toBe(true);
    expect(byId.claude.path).toBe(path.join(dir, "claude"));
    expect(byId.gemini.installed).toBe(true);

    // Everything else is reported uninstalled with a null path.
    for (const id of ["codex", "opencode", "copilot", "qwen", "antigravity"]) {
      expect(byId[id].installed).toBe(false);
      expect(byId[id].path).toBeNull();
    }
  });

  it("each row exposes id/name/run/url and never leaks the args builder", () => {
    const rows = detectClis();
    for (const r of rows) {
      const spec = KNOWN.find((c) => c.id === r.id)!;
      expect(r.name).toBe(spec.name);
      expect(r.run).toBe(spec.run);
      expect(r.url).toBe(spec.url);
      expect("args" in r).toBe(false);
      expect(typeof r.installed).toBe("boolean");
    }
  });

  it("reports all uninstalled when nothing resolves", () => {
    const rows = detectClis();
    expect(rows.every((r) => r.installed === false)).toBe(true);
    expect(rows.every((r) => r.path === null)).toBe(true);
  });
});

describe("resolveCli", () => {
  it("returns the spec + binPath when the CLI is installed", () => {
    const dir = "/usr/local/bin";
    existing.add(path.join(dir, "claude"));

    const res = resolveCli("claude");
    expect(res).not.toBeNull();
    expect(res!.binPath).toBe(path.join(dir, "claude"));
    expect(res!.spec).toBe(KNOWN.find((c) => c.id === "claude"));
  });

  it("returns null for a known id whose bin is not on disk", () => {
    expect(resolveCli("codex")).toBeNull();
  });

  it("returns null for an unknown id (short-circuits before any fs lookup)", () => {
    // Even if a same-named bin existed, an unknown id resolves to null.
    existing.add(path.join("/usr/local/bin", "bogus"));
    expect(resolveCli("bogus")).toBeNull();
  });

  it("resolves antigravity via its 'agy' bin, not its id", () => {
    const dir = "/opt/homebrew/bin";
    existing.add(path.join(dir, "agy"));
    const res = resolveCli("antigravity");
    expect(res).not.toBeNull();
    expect(res!.binPath).toBe(path.join(dir, "agy"));
    expect(res!.spec.bin).toBe("agy");
  });
});

describe("CliSpec type is exported and usable", () => {
  it("KNOWN entries satisfy the CliSpec shape", () => {
    const sample: CliSpec = KNOWN[0];
    expect(sample.id).toBe("claude");
  });
});
