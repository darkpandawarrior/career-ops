import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Two throwaway data roots so we can prove cv.md is profile-SCOPED: a write
// under one root must never touch the other's file. requestRoot() is mocked to
// return whichever root the current test points it at (mutable below).
const ROOT_A = fs.mkdtempSync(path.join(os.tmpdir(), "co-cv-a-"));
const ROOT_B = fs.mkdtempSync(path.join(os.tmpdir(), "co-cv-b-"));

// Mutable: each test sets which root requestRoot() resolves to.
let activeRoot = ROOT_A;
vi.mock("@/lib/profile-registry", () => ({
  requestRoot: vi.fn(async () => activeRoot),
}));

import { GET, POST } from "./route";

const cvFile = (root: string) => path.join(root, "cv.md");

beforeEach(() => {
  activeRoot = ROOT_A;
  // Wipe both roots so each test starts with no cv.md / no backups.
  for (const root of [ROOT_A, ROOT_B]) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
  }
  vi.clearAllMocks();
});

afterAll(() => {
  fs.rmSync(ROOT_A, { recursive: true, force: true });
  fs.rmSync(ROOT_B, { recursive: true, force: true });
});

describe("GET /api/cv", () => {
  it("returns exists:false and empty content when cv.md is absent", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ content: "", exists: false });
  });

  it("reads cv.md from the active profile root when present", async () => {
    fs.writeFileSync(cvFile(ROOT_A), "# My CV\n\nSenior Engineer", "utf8");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.exists).toBe(true);
    expect(body.content).toBe("# My CV\n\nSenior Engineer");
  });

  it("is profile-scoped: GET reads the root requestRoot() currently resolves", async () => {
    fs.writeFileSync(cvFile(ROOT_A), "A's cv", "utf8");
    fs.writeFileSync(cvFile(ROOT_B), "B's cv", "utf8");

    activeRoot = ROOT_A;
    expect((await (await GET()).json()).content).toBe("A's cv");

    activeRoot = ROOT_B;
    expect((await (await GET()).json()).content).toBe("B's cv");
  });
});

describe("POST /api/cv", () => {
  it("writes content to cv.md under the active root and reports backedUp:false on first write", async () => {
    const res = await POST(
      new Request("http://localhost/api/cv", {
        method: "POST",
        body: JSON.stringify({ content: "# Fresh CV" }),
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, backedUp: false });
    expect(fs.readFileSync(cvFile(ROOT_A), "utf8")).toBe("# Fresh CV");
  });

  it("round-trips: a POSTed CV is what a subsequent GET reads back", async () => {
    await POST(
      new Request("http://localhost/api/cv", {
        method: "POST",
        body: JSON.stringify({ content: "round-trip body" }),
      }),
    );
    const body = await (await GET()).json();
    expect(body).toEqual({ content: "round-trip body", exists: true });
  });

  it("backs up the prior CV (backedUp:true) when overwriting existing content", async () => {
    fs.writeFileSync(cvFile(ROOT_A), "old contents", "utf8");
    const res = await POST(
      new Request("http://localhost/api/cv", {
        method: "POST",
        body: JSON.stringify({ content: "new contents" }),
      }),
    );
    const body = await res.json();
    expect(body).toEqual({ ok: true, backedUp: true });
    expect(fs.readFileSync(cvFile(ROOT_A), "utf8")).toBe("new contents");
    // A timestamped .bak file holding the old contents now sits beside cv.md.
    const baks = fs.readdirSync(ROOT_A).filter((f) => f.startsWith("cv.md.bak-"));
    expect(baks).toHaveLength(1);
    expect(fs.readFileSync(path.join(ROOT_A, baks[0]), "utf8")).toBe("old contents");
  });

  it("does NOT back up when the prior cv.md is whitespace-only (nothing to recover)", async () => {
    fs.writeFileSync(cvFile(ROOT_A), "   \n  ", "utf8");
    const res = await POST(
      new Request("http://localhost/api/cv", {
        method: "POST",
        body: JSON.stringify({ content: "real content" }),
      }),
    );
    expect(await res.json()).toEqual({ ok: true, backedUp: false });
    expect(fs.readdirSync(ROOT_A).filter((f) => f.startsWith("cv.md.bak-"))).toHaveLength(0);
  });

  it("is profile-scoped: a POST under root B leaves root A's cv.md untouched", async () => {
    fs.writeFileSync(cvFile(ROOT_A), "A stays", "utf8");
    activeRoot = ROOT_B;
    const res = await POST(
      new Request("http://localhost/api/cv", {
        method: "POST",
        body: JSON.stringify({ content: "written to B" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(fs.readFileSync(cvFile(ROOT_B), "utf8")).toBe("written to B");
    // A's file is unchanged — the write was scoped to B.
    expect(fs.readFileSync(cvFile(ROOT_A), "utf8")).toBe("A stays");
  });

  it("rejects malformed JSON with 400 'bad json' and writes nothing", async () => {
    const res = await POST(
      new Request("http://localhost/api/cv", { method: "POST", body: "{ not json" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad json" });
    expect(fs.existsSync(cvFile(ROOT_A))).toBe(false);
  });

  it("rejects a non-string content with 400 'content required'", async () => {
    const res = await POST(
      new Request("http://localhost/api/cv", {
        method: "POST",
        body: JSON.stringify({ content: 42 }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "content required" });
    expect(fs.existsSync(cvFile(ROOT_A))).toBe(false);
  });

  it("rejects a missing content key with 400 'content required'", async () => {
    const res = await POST(
      new Request("http://localhost/api/cv", {
        method: "POST",
        body: JSON.stringify({ notContent: "x" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "content required" });
  });

  it("accepts an empty-string content (a valid 'clear the CV' write)", async () => {
    const res = await POST(
      new Request("http://localhost/api/cv", {
        method: "POST",
        body: JSON.stringify({ content: "" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, backedUp: false });
    expect(fs.readFileSync(cvFile(ROOT_A), "utf8")).toBe("");
  });

  it("rejects a CV over 200KB with 413 and does not write", async () => {
    const huge = "x".repeat(200_001);
    const res = await POST(
      new Request("http://localhost/api/cv", {
        method: "POST",
        body: JSON.stringify({ content: huge }),
      }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "CV is too large (over 200KB)" });
    expect(fs.existsSync(cvFile(ROOT_A))).toBe(false);
  });

  it("accepts a CV exactly at the 200KB boundary", async () => {
    const atLimit = "y".repeat(200_000);
    const res = await POST(
      new Request("http://localhost/api/cv", {
        method: "POST",
        body: JSON.stringify({ content: atLimit }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, backedUp: false });
    expect(Buffer.byteLength(fs.readFileSync(cvFile(ROOT_A), "utf8"), "utf8")).toBe(200_000);
  });
});
