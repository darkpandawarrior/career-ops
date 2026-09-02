import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as yaml from "js-yaml";

// The portals route writes portals.yml under the request's active root. We mock
// profile-registry's requestRoot() to a tmp profile dir (approach (a) from the
// recipe) — simplest for a write route. careerOpsRoot is irrelevant here since
// requestRoot is mocked directly.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "co-portals-route-"));

vi.mock("@/lib/profile-registry", () => ({ requestRoot: vi.fn(async () => TMP) }));

import { POST } from "./route";

const portalsPath = () => path.join(TMP, "portals.yml");
const examplePath = () => path.join(TMP, "templates", "portals.example.yml");

// Real installs always ship templates/portals.example.yml; tests that exercise
// the write path (not the seeding path itself) seed a minimal one so a missing
// template — an installation error under the new contract (see
// portals-config.mjs) — doesn't mask what the test actually checks.
function seedTemplate() {
  fs.mkdirSync(path.join(TMP, "templates"), { recursive: true });
  fs.writeFileSync(examplePath(), yaml.dump({ title_filter: { positive: [] } }));
}

function makeReq(body: unknown, raw?: string) {
  return new Request("http://localhost/api/portals", {
    method: "POST",
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
}

function readPortals(): Record<string, unknown> {
  return yaml.load(fs.readFileSync(portalsPath(), "utf8")) as Record<string, unknown>;
}

beforeEach(() => {
  // Start each test from a clean tmp tree (no portals.yml, no templates).
  fs.rmSync(portalsPath(), { force: true });
  fs.rmSync(path.join(TMP, "templates"), { recursive: true, force: true });
  // Remove any backups / temp leftovers.
  for (const f of fs.readdirSync(TMP)) {
    if (f.startsWith("portals.yml.")) fs.rmSync(path.join(TMP, f), { force: true });
  }
});

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("POST /api/portals — validation", () => {
  it("rejects a malformed JSON body with 400 'bad json'", async () => {
    const res = await POST(makeReq(null, "{ not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad json" });
    expect(fs.existsSync(portalsPath())).toBe(false);
  });

  it("rejects an empty roles array with 400 'no roles'", async () => {
    const res = await POST(makeReq({ roles: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no roles" });
    expect(fs.existsSync(portalsPath())).toBe(false);
  });

  it("rejects a missing roles field with 400 'no roles'", async () => {
    const res = await POST(makeReq({ location: ["Pune"] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no roles" });
  });

  it("rejects roles that trim to all-empty with 400 'no roles'", async () => {
    const res = await POST(makeReq({ roles: ["   ", ""] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no roles" });
  });

  it("rejects a non-array roles value with 400 'no roles'", async () => {
    const res = await POST(makeReq({ roles: "Android Engineer" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no roles" });
  });
});

describe("POST /api/portals — write behavior", () => {
  it("creates portals.yml from a real template when no user file exists yet", async () => {
    seedTemplate();
    const res = await POST(makeReq({ roles: ["Android Engineer", "Mobile Lead"] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, roles: 2 });

    expect(fs.existsSync(portalsPath())).toBe(true);
    const doc = readPortals();
    expect((doc.title_filter as Record<string, unknown>).positive).toEqual([
      "Android Engineer",
      "Mobile Lead",
    ]);
  });

  it("500s as an installation error when neither portals.yml nor its template exist", async () => {
    // Distinct from a broken USER file (409): nothing to seed from at all means
    // the install itself is incomplete, not that the user has something to fix.
    const res = await POST(makeReq({ roles: ["Android"] }));
    expect(res.status).toBe(500);
    expect(fs.existsSync(portalsPath())).toBe(false);
  });

  it("trims, drops blanks, and caps roles at 24", async () => {
    seedTemplate();
    const roles = ["  Android  ", "", "iOS", ...Array.from({ length: 30 }, (_, i) => `R${i}`)];
    const res = await POST(makeReq({ roles }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.roles).toBe(24);

    const positive = (readPortals().title_filter as Record<string, unknown>).positive as string[];
    expect(positive).toHaveLength(24);
    // First entry was trimmed; the blank was dropped so iOS is second.
    expect(positive[0]).toBe("Android");
    expect(positive[1]).toBe("iOS");
  });

  it("replaces ONLY title_filter.positive and preserves negative + sibling blocks", async () => {
    fs.writeFileSync(
      portalsPath(),
      yaml.dump({
        title_filter: { positive: ["OLD"], negative: ["senior"] },
        tracked_companies: ["Acme", "Globex"],
        some_other_block: { keep: true },
      }),
    );

    const res = await POST(makeReq({ roles: ["NEW ROLE"] }));
    expect(res.status).toBe(200);

    const doc = readPortals();
    const tf = doc.title_filter as Record<string, unknown>;
    expect(tf.positive).toEqual(["NEW ROLE"]); // replaced
    expect(tf.negative).toEqual(["senior"]); // preserved
    expect(doc.tracked_companies).toEqual(["Acme", "Globex"]); // preserved
    expect(doc.some_other_block).toEqual({ keep: true }); // preserved
  });

  it("seeds from templates/portals.example.yml when portals.yml is absent", async () => {
    fs.mkdirSync(path.join(TMP, "templates"), { recursive: true });
    fs.writeFileSync(
      examplePath(),
      yaml.dump({
        title_filter: { positive: ["seed"], negative: ["intern"] },
        tracked_companies: ["FromTemplate"],
      }),
    );

    const res = await POST(makeReq({ roles: ["Backend"] }));
    expect(res.status).toBe(200);

    const doc = readPortals();
    const tf = doc.title_filter as Record<string, unknown>;
    expect(tf.positive).toEqual(["Backend"]); // positive overwritten from request
    expect(tf.negative).toEqual(["intern"]); // template negative preserved
    expect(doc.tracked_companies).toEqual(["FromTemplate"]); // template block preserved
  });

  it("writes location_filter.allow when location is a non-empty array", async () => {
    seedTemplate();
    const res = await POST(makeReq({ roles: ["Android"], location: ["  Pune  ", "Remote", ""] }));
    expect(res.status).toBe(200);

    const lf = readPortals().location_filter as Record<string, unknown>;
    expect(lf.allow).toEqual(["Pune", "Remote"]); // trimmed + blanks dropped
  });

  it("omits location_filter entirely when location is empty/absent", async () => {
    seedTemplate();
    const res = await POST(makeReq({ roles: ["Android"], location: [] }));
    expect(res.status).toBe(200);
    expect(readPortals().location_filter).toBeUndefined();
  });

  it("preserves an existing location_filter.allow when no location is sent", async () => {
    fs.writeFileSync(
      portalsPath(),
      yaml.dump({ location_filter: { allow: ["Bengaluru"], deny: ["US"] } }),
    );
    const res = await POST(makeReq({ roles: ["Android"] }));
    expect(res.status).toBe(200);

    const lf = readPortals().location_filter as Record<string, unknown>;
    // Untouched because the route only writes location_filter when location is sent.
    expect(lf.allow).toEqual(["Bengaluru"]);
    expect(lf.deny).toEqual(["US"]);
  });

  it("merges location_filter.allow while preserving sibling keys like deny", async () => {
    fs.writeFileSync(
      portalsPath(),
      yaml.dump({ location_filter: { allow: ["Old"], deny: ["US"] } }),
    );
    const res = await POST(makeReq({ roles: ["Android"], location: ["Pune"] }));
    expect(res.status).toBe(200);

    const lf = readPortals().location_filter as Record<string, unknown>;
    expect(lf.allow).toEqual(["Pune"]); // replaced
    expect(lf.deny).toEqual(["US"]); // preserved
  });

  it("409s and PRESERVES a malformed portals.yml instead of overwriting it with the example", async () => {
    // The data-loss fix: an existing user-layer file that fails to parse must
    // never be silently replaced by the shipped template — that's how a real
    // portals.yml got destroyed before (see portals-config.mjs). The user gets
    // a 409 (their file to fix), and the file on disk is untouched byte-for-byte.
    const malformed = "title_filter: \"unterminated\n  : : :";
    fs.writeFileSync(portalsPath(), malformed);
    const res = await POST(makeReq({ roles: ["Recovered"] }));
    expect(res.status).toBe(409);
    expect(fs.readFileSync(portalsPath(), "utf8")).toBe(malformed);
  });

  it("409s on an existing empty portals.yml rather than treating it as {} (js-yaml v5 throws on load(''))", async () => {
    // An empty file parses to `undefined`, not a mapping — same "broken user
    // file, don't guess" contract as the malformed case above.
    fs.writeFileSync(portalsPath(), "");
    const res = await POST(makeReq({ roles: ["Recovered"] }));
    expect(res.status).toBe(409);
    expect(fs.readFileSync(portalsPath(), "utf8")).toBe("");
  });

  it("coerces non-string role entries to strings before trimming", async () => {
    seedTemplate();
    const res = await POST(makeReq({ roles: [123, "  Real  ", true] }));
    expect(res.status).toBe(200);

    const positive = (readPortals().title_filter as Record<string, unknown>).positive as string[];
    expect(positive).toEqual(["123", "Real", "true"]);
  });

  it("backs up prior content before overwriting (atomicWriteWithBackup)", async () => {
    fs.writeFileSync(portalsPath(), yaml.dump({ title_filter: { positive: ["prior"] } }));
    const res = await POST(makeReq({ roles: ["after"] }));
    expect(res.status).toBe(200);

    const backups = fs.readdirSync(TMP).filter((f) => f.startsWith("portals.yml.bak-"));
    expect(backups.length).toBe(1);
    // The backup holds the pre-write content.
    const bak = yaml.load(fs.readFileSync(path.join(TMP, backups[0]), "utf8")) as Record<string, unknown>;
    expect((bak.title_filter as Record<string, unknown>).positive).toEqual(["prior"]);
  });
});
