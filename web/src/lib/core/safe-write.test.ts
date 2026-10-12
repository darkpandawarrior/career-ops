import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { atomicWrite, backup, atomicWriteWithBackup } from "./safe-write";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "safe-write-test-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** All sibling files in `dir` that match a glob-ish prefix on the base name. */
function siblingsMatching(file: string, fragment: string): string[] {
  const base = path.basename(file);
  return fs
    .readdirSync(path.dirname(file))
    .filter((name) => name !== base && name.startsWith(`${base}${fragment}`));
}

describe("atomicWrite", () => {
  it("writes the content to the target file", () => {
    const file = path.join(dir, "out.txt");
    atomicWrite(file, "hello world");
    expect(fs.readFileSync(file, "utf8")).toBe("hello world");
  });

  it("leaves no .tmp sidecar files behind after a successful write", () => {
    const file = path.join(dir, "out.txt");
    atomicWrite(file, "data");
    expect(siblingsMatching(file, ".tmp-")).toEqual([]);
    // The whole dir should contain only the final file.
    expect(fs.readdirSync(dir)).toEqual(["out.txt"]);
  });

  it("creates parent directories that do not yet exist", () => {
    const file = path.join(dir, "nested", "deep", "out.txt");
    atomicWrite(file, "nested content");
    expect(fs.readFileSync(file, "utf8")).toBe("nested content");
  });

  it("overwrites an existing file's contents", () => {
    const file = path.join(dir, "out.txt");
    atomicWrite(file, "first");
    atomicWrite(file, "second");
    expect(fs.readFileSync(file, "utf8")).toBe("second");
  });

  it("writes an empty string without error", () => {
    const file = path.join(dir, "empty.txt");
    atomicWrite(file, "");
    expect(fs.readFileSync(file, "utf8")).toBe("");
    expect(fs.existsSync(file)).toBe(true);
  });

  it("writes UTF-8 content faithfully (multibyte + emoji)", () => {
    const file = path.join(dir, "utf8.txt");
    const content = "héllo · 世界 · 🚀";
    atomicWrite(file, content);
    expect(fs.readFileSync(file, "utf8")).toBe(content);
  });
});

describe("backup", () => {
  it("creates a timestamped .bak copy of an existing non-empty file", () => {
    const file = path.join(dir, "data.json");
    fs.writeFileSync(file, '{"a":1}', "utf8");

    const bak = backup(file);

    expect(bak).not.toBeNull();
    expect(bak).toMatch(/data\.json\.bak-/);
    expect(fs.existsSync(bak as string)).toBe(true);
    expect(fs.readFileSync(bak as string, "utf8")).toBe('{"a":1}');
  });

  it("leaves the original file untouched after backing up", () => {
    const file = path.join(dir, "data.json");
    fs.writeFileSync(file, "original", "utf8");

    backup(file);

    expect(fs.readFileSync(file, "utf8")).toBe("original");
  });

  it("returns null when the source file is missing", () => {
    const file = path.join(dir, "does-not-exist.txt");
    expect(backup(file)).toBeNull();
    // No .bak should have been created.
    expect(siblingsMatching(file, ".bak-")).toEqual([]);
  });

  it("returns null for an empty file (no backup created)", () => {
    const file = path.join(dir, "empty.txt");
    fs.writeFileSync(file, "", "utf8");
    expect(backup(file)).toBeNull();
    expect(siblingsMatching(file, ".bak-")).toEqual([]);
  });

  it("returns null for a whitespace-only file (treated as empty by .trim())", () => {
    const file = path.join(dir, "ws.txt");
    fs.writeFileSync(file, "   \n\t  ", "utf8");
    expect(backup(file)).toBeNull();
    expect(siblingsMatching(file, ".bak-")).toEqual([]);
  });

  it("throws when the path is a directory (non-ENOENT read errors are rethrown)", () => {
    const sub = path.join(dir, "adir");
    fs.mkdirSync(sub);
    expect(() => backup(sub)).toThrow();
  });
});

describe("atomicWriteWithBackup", () => {
  it("writes the new content AND backs up the prior content", () => {
    const file = path.join(dir, "config.json");
    fs.writeFileSync(file, "old", "utf8");

    const bak = atomicWriteWithBackup(file, "new");

    // New content landed.
    expect(fs.readFileSync(file, "utf8")).toBe("new");
    // Backup path returned and holds the prior content.
    expect(bak).not.toBeNull();
    expect(bak).toMatch(/config\.json\.bak-/);
    expect(fs.readFileSync(bak as string, "utf8")).toBe("old");
  });

  it("returns null (no backup) when there is no prior file, but still writes", () => {
    const file = path.join(dir, "fresh.json");

    const bak = atomicWriteWithBackup(file, "brand new");

    expect(bak).toBeNull();
    expect(fs.readFileSync(file, "utf8")).toBe("brand new");
    expect(siblingsMatching(file, ".bak-")).toEqual([]);
  });

  it("returns null (no backup) when the prior file is empty, but still overwrites", () => {
    const file = path.join(dir, "was-empty.json");
    fs.writeFileSync(file, "", "utf8");

    const bak = atomicWriteWithBackup(file, "filled");

    expect(bak).toBeNull();
    expect(fs.readFileSync(file, "utf8")).toBe("filled");
    expect(siblingsMatching(file, ".bak-")).toEqual([]);
  });

  it("leaves no .tmp sidecar behind (atomic rename cleaned up)", () => {
    const file = path.join(dir, "config.json");
    fs.writeFileSync(file, "old", "utf8");

    atomicWriteWithBackup(file, "new");

    expect(siblingsMatching(file, ".tmp-")).toEqual([]);
  });
});
