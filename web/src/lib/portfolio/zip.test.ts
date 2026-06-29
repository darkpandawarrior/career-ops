import { describe, it, expect } from "vitest";
import { buildZip } from "./zip";

describe("buildZip", () => {
  it("emits a valid ZIP: local-header + EOCD signatures and the file names", () => {
    const z = buildZip([
      { name: "index.html", content: "<h1>hi</h1>" },
      { name: "README-deploy.md", content: "# deploy" },
    ]);
    // Local file header signature PK\x03\x04 at the start.
    expect([z[0], z[1], z[2], z[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // End-of-central-directory signature PK\x05\x06 near the end.
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
    expect(dv.getUint32(z.length - 22, true)).toBe(0x06054b50);
    // EOCD records the entry count (2).
    expect(dv.getUint16(z.length - 22 + 10, true)).toBe(2);
    // The file names appear in the archive bytes.
    const txt = new TextDecoder().decode(z);
    expect(txt).toContain("index.html");
    expect(txt).toContain("README-deploy.md");
    expect(txt).toContain("<h1>hi</h1>");
  });

  it("is deterministic (fixed timestamps) for identical input", () => {
    const a = buildZip([{ name: "a.txt", content: "x" }]);
    const b = buildZip([{ name: "a.txt", content: "x" }]);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("handles an empty file list (just an EOCD)", () => {
    const z = buildZip([]);
    expect(z.length).toBe(22);
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
    expect(dv.getUint32(0, true)).toBe(0x06054b50);
  });
});
