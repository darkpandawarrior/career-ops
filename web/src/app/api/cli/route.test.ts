import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as yaml from "js-yaml";

// A throwaway engine root with a profiles.yml fixture. careerOpsRoot() is mocked
// to point here so requestRoot() (real, from profile-registry) resolves a tmp
// profile dir for the active x-co-profile header.
const ENGINE = fs.mkdtempSync(path.join(os.tmpdir(), "co-cli-route-"));
fs.writeFileSync(
  path.join(ENGINE, "profiles.yml"),
  `profiles:
  - name: alex
    display_name: Alex Doe
    root: profiles/alex
  - name: jordan
    display_name: Jordan
    root: profiles/jordan
`,
);

// The tmp profile dir the route writes/reads cli.yml under for the "alex"
// header. requestRoot() resolves profiles/alex relative to ENGINE.
const PROFILE_ROOT = path.resolve(ENGINE, "profiles/alex");

vi.mock("@/lib/career-ops", () => ({ careerOpsRoot: () => ENGINE }));

// Mutable header value the next/headers mock returns for x-co-profile.
let headerValue: string | null = "alex";
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: (k: string) => (k === "x-co-profile" ? headerValue : null) })),
}));

// detectClis is mocked so we control which CLIs report installed. KNOWN stays
// real (the route imports it for POST validation). Mutable so each test sets it.
let detected: Array<{ id: string; name: string; run: string; url: string; installed: boolean; path: string | null }> = [];
vi.mock("@/lib/clis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clis")>();
  return { ...actual, detectClis: vi.fn(() => detected) };
});

import { GET, POST } from "./route";
import { KNOWN } from "@/lib/clis";

// Build a detected-list entry from a KNOWN spec, with a chosen installed flag.
function makeDetected(id: string, installed: boolean) {
  const spec = KNOWN.find((c) => c.id === id)!;
  return { id: spec.id, name: spec.name, run: spec.run, url: spec.url, installed, path: installed ? `/usr/local/bin/${spec.bin}` : null };
}

const cliConfigPath = () => path.join(PROFILE_ROOT, "config", "cli.yml");

beforeEach(() => {
  headerValue = "alex";
  detected = KNOWN.map((c) => makeDetected(c.id, false));
  // Clean any cli.yml from a prior test so reads start fresh.
  fs.rmSync(path.join(PROFILE_ROOT, "config"), { recursive: true, force: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => fs.rmSync(ENGINE, { recursive: true, force: true }));

describe("GET /api/cli", () => {
  it("returns the full detected cli list and null selected when nothing is installed", async () => {
    detected = KNOWN.map((c) => makeDetected(c.id, false));
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.clis).toHaveLength(KNOWN.length);
    expect(body.clis.map((c: { id: string }) => c.id)).toEqual(KNOWN.map((c) => c.id));
    expect(body.selected).toBeNull();
  });

  it("auto-defaults selected to the FIRST installed cli when no cli.yml exists", async () => {
    // Mark gemini + codex installed; claude (first in KNOWN) not. First installed
    // in KNOWN order is codex.
    detected = KNOWN.map((c) => makeDetected(c.id, c.id === "codex" || c.id === "gemini"));
    const res = await GET();
    const body = await res.json();
    expect(body.selected).toBe("codex");
  });

  it("reads the saved cliId from cli.yml when present and still installed", async () => {
    fs.mkdirSync(path.join(PROFILE_ROOT, "config"), { recursive: true });
    fs.writeFileSync(cliConfigPath(), yaml.dump({ cliId: "gemini" }), "utf8");
    detected = KNOWN.map((c) => makeDetected(c.id, c.id === "claude" || c.id === "gemini"));
    const res = await GET();
    const body = await res.json();
    // Saved choice (gemini) is honored even though claude is also installed.
    expect(body.selected).toBe("gemini");
  });

  it("falls back to first installed when the saved cli is now uninstalled", async () => {
    fs.mkdirSync(path.join(PROFILE_ROOT, "config"), { recursive: true });
    fs.writeFileSync(cliConfigPath(), yaml.dump({ cliId: "qwen" }), "utf8");
    // qwen NOT installed; claude + codex are. First installed in KNOWN order: claude.
    detected = KNOWN.map((c) => makeDetected(c.id, c.id === "claude" || c.id === "codex"));
    const res = await GET();
    const body = await res.json();
    expect(body.selected).toBe("claude");
  });

  it("falls back to first installed when cli.yml is malformed yaml", async () => {
    fs.mkdirSync(path.join(PROFILE_ROOT, "config"), { recursive: true });
    // ':' with unbalanced quotes -> yaml.load throws -> caught -> selected stays null pre-fallback.
    fs.writeFileSync(cliConfigPath(), "cliId: \"unterminated\n  : : :", "utf8");
    detected = KNOWN.map((c) => makeDetected(c.id, c.id === "gemini"));
    const res = await GET();
    const body = await res.json();
    expect(body.selected).toBe("gemini");
  });

  it("treats cli.yml with no cliId key as no saved choice (auto-default)", async () => {
    fs.mkdirSync(path.join(PROFILE_ROOT, "config"), { recursive: true });
    fs.writeFileSync(cliConfigPath(), yaml.dump({ other: "value" }), "utf8");
    detected = KNOWN.map((c) => makeDetected(c.id, c.id === "codex"));
    const res = await GET();
    const body = await res.json();
    expect(body.selected).toBe("codex");
  });

  it("returns selected null when a saved cli is uninstalled and nothing else is installed", async () => {
    fs.mkdirSync(path.join(PROFILE_ROOT, "config"), { recursive: true });
    fs.writeFileSync(cliConfigPath(), yaml.dump({ cliId: "claude" }), "utf8");
    detected = KNOWN.map((c) => makeDetected(c.id, false));
    const res = await GET();
    const body = await res.json();
    expect(body.selected).toBeNull();
  });
});

describe("POST /api/cli", () => {
  it("writes config/cli.yml for a valid KNOWN cliId and returns ok", async () => {
    const req = new Request("http://localhost/api/cli", {
      method: "POST",
      body: JSON.stringify({ cliId: "claude" }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });

    // File was written under the resolved profile root with the chosen cliId.
    expect(fs.existsSync(cliConfigPath())).toBe(true);
    const saved = yaml.load(fs.readFileSync(cliConfigPath(), "utf8")) as { cliId?: string };
    expect(saved.cliId).toBe("claude");
  });

  it("round-trips: a value POSTed is the value GET reads back (when installed)", async () => {
    const post = await POST(
      new Request("http://localhost/api/cli", { method: "POST", body: JSON.stringify({ cliId: "gemini" }) }),
    );
    expect((await post.json())).toEqual({ ok: true });

    detected = KNOWN.map((c) => makeDetected(c.id, c.id === "gemini" || c.id === "claude"));
    const get = await GET();
    expect((await get.json()).selected).toBe("gemini");
  });

  it("rejects an unknown cliId with 400 and does not write a file", async () => {
    const req = new Request("http://localhost/api/cli", {
      method: "POST",
      body: JSON.stringify({ cliId: "bogus-cli" }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "unknown cliId" });
    expect(fs.existsSync(cliConfigPath())).toBe(false);
  });

  it("rejects a missing cliId with 400", async () => {
    const req = new Request("http://localhost/api/cli", {
      method: "POST",
      body: JSON.stringify({ notCliId: "claude" }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "unknown cliId" });
  });

  it("rejects an empty-string cliId with 400", async () => {
    const req = new Request("http://localhost/api/cli", {
      method: "POST",
      body: JSON.stringify({ cliId: "" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json())).toEqual({ error: "unknown cliId" });
  });

  it("rejects a malformed JSON body with 400 'bad json'", async () => {
    const req = new Request("http://localhost/api/cli", {
      method: "POST",
      body: "{ not valid json",
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "bad json" });
  });

  it("writes to the profile-scoped root (different header -> different file)", async () => {
    headerValue = "jordan";
    const jordanRoot = path.resolve(ENGINE, "profiles/jordan");
    fs.rmSync(path.join(jordanRoot, "config"), { recursive: true, force: true });

    const res = await POST(
      new Request("http://localhost/api/cli", { method: "POST", body: JSON.stringify({ cliId: "codex" }) }),
    );
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(jordanRoot, "config", "cli.yml"))).toBe(true);
    // alex's file must NOT have been touched.
    expect(fs.existsSync(cliConfigPath())).toBe(false);
  });
});
