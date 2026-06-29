import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A throwaway profile root. requestRoot() is mocked to return it directly so
// GET reads / POST appends the canonical modes/_profile.md inside this hermetic
// tmp tree — never the user's real profile.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "co-memory-route-"));

vi.mock("@/lib/profile-registry", () => ({ requestRoot: vi.fn(async () => TMP) }));

import { GET, POST } from "./route";

const profilePath = () => path.join(TMP, "modes", "_profile.md");

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/memory", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  // Wipe the profile dir so each test starts with no _profile.md.
  fs.rmSync(path.join(TMP, "modes"), { recursive: true, force: true });
  fs.rmSync(path.join(TMP, ".career-ops-web"), { recursive: true, force: true });
});

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("GET /api/memory", () => {
  it("returns an empty string when no profile/memory exists yet", async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ memory: "" });
  });

  it("reads back the managed notes block from modes/_profile.md", async () => {
    fs.mkdirSync(path.join(TMP, "modes"), { recursive: true });
    fs.writeFileSync(
      profilePath(),
      "# Profile customization\n\n## Notes from the web assistant\n<!-- co-web-notes:start -->\n- prefers remote roles\n<!-- co-web-notes:end -->\n",
      "utf8",
    );
    const res = await GET();
    const body = await res.json();
    expect(body.memory).toBe("- prefers remote roles");
  });

  it("falls back to the legacy web-only memory file when no managed block exists", async () => {
    fs.mkdirSync(path.join(TMP, ".career-ops-web"), { recursive: true });
    fs.writeFileSync(path.join(TMP, ".career-ops-web", "memory.md"), "legacy note\n", "utf8");
    const res = await GET();
    const body = await res.json();
    expect(body.memory).toBe("legacy note");
  });
});

describe("POST /api/memory", () => {
  it("appends a fact to the canonical modes/_profile.md and reports ok", async () => {
    const res = await POST(jsonReq({ fact: "targeting Lead Android roles" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, deduped: false });

    // The write landed in the tmp profile root (profile-scoped).
    expect(fs.existsSync(profilePath())).toBe(true);
    const md = fs.readFileSync(profilePath(), "utf8");
    expect(md).toContain("<!-- co-web-notes:start -->");
    expect(md).toContain("- targeting Lead Android roles");
  });

  it("round-trips: a POSTed fact is readable via GET", async () => {
    await POST(jsonReq({ fact: "based in Pune" }));
    const res = await GET();
    const body = await res.json();
    expect(body.memory).toContain("- based in Pune");
  });

  it("dedupes an identical fact (deduped:true, file unchanged)", async () => {
    await POST(jsonReq({ fact: "uses Hilt for DI" }));
    const first = fs.readFileSync(profilePath(), "utf8");

    const res = await POST(jsonReq({ fact: "uses Hilt for DI" }));
    const body = await res.json();
    expect(body).toEqual({ ok: true, deduped: true });
    // No duplicate line written.
    expect(fs.readFileSync(profilePath(), "utf8")).toBe(first);
  });

  it("preserves existing user content when appending into the managed block", async () => {
    fs.mkdirSync(path.join(TMP, "modes"), { recursive: true });
    fs.writeFileSync(
      profilePath(),
      "# My profile\n\nImportant user prose.\n\n## Notes from the web assistant\n<!-- co-web-notes:start -->\n- first fact\n<!-- co-web-notes:end -->\n",
      "utf8",
    );
    const res = await POST(jsonReq({ fact: "second fact" }));
    expect((await res.json())).toEqual({ ok: true, deduped: false });
    const md = fs.readFileSync(profilePath(), "utf8");
    expect(md).toContain("Important user prose.");
    expect(md).toContain("- first fact");
    expect(md).toContain("- second fact");
  });

  it("rejects a missing fact with 400", async () => {
    const res = await POST(jsonReq({ notFact: "x" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "fact required" });
    expect(fs.existsSync(profilePath())).toBe(false);
  });

  it("rejects a whitespace-only fact with 400", async () => {
    const res = await POST(jsonReq({ fact: "   " }));
    expect(res.status).toBe(400);
    expect((await res.json())).toEqual({ error: "fact required" });
  });

  it("rejects malformed JSON with 400 'bad json'", async () => {
    const res = await POST(jsonReq("{ not valid json"));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "bad json" });
  });

  it("coerces a non-string fact to its string form before validating", async () => {
    // 123 -> "123" (truthy after trim) so it is accepted and written.
    const res = await POST(jsonReq({ fact: 123 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(fs.readFileSync(profilePath(), "utf8")).toContain("- 123");
  });
});
