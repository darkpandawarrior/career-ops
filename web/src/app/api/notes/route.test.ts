import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A throwaway profile root. requestRoot() is mocked to return it directly so the
// route reads/writes data/applications.md inside this hermetic tmp tree — never
// the user's real tracker.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "co-notes-route-"));

vi.mock("@/lib/profile-registry", () => ({ requestRoot: vi.fn(async () => TMP) }));

import { POST } from "./route";

const appsPath = () => path.join(TMP, "data", "applications.md");

// A tracker table whose header row names the "Notes" column. columnIndex finds
// it case-insensitively; the row keyed by application number "1" gets edited.
const HEADER = "| # | Date | Company | Role | Source | Link | Status | Stage | Next | Notes |";
const SEP = "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
function writeTracker(rows: string[]) {
  fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
  fs.writeFileSync(appsPath(), [HEADER, SEP, ...rows].join("\n") + "\n", "utf8");
}

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/notes", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  fs.rmSync(path.join(TMP, "data"), { recursive: true, force: true });
});

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("POST /api/notes", () => {
  it("updates the Notes cell of an existing row and returns ok", async () => {
    writeTracker([
      "| 1 | 2026-06-01 | Acme | Android | LinkedIn | http://x | Applied | R1 | followup | old note |",
    ]);
    const res = await POST(jsonReq({ n: "1", notes: "called recruiter" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });

    // The new value landed in the Notes column of the tmp profile's file.
    const md = fs.readFileSync(appsPath(), "utf8");
    expect(md).toContain("called recruiter");
    expect(md).not.toContain("old note");
  });

  it("allows clearing the note with an empty string", async () => {
    writeTracker([
      "| 1 | 2026-06-01 | Acme | Android | LinkedIn | http://x | Applied | R1 | followup | something |",
    ]);
    const res = await POST(jsonReq({ n: "1", notes: "" }));
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ ok: true });
    expect(fs.readFileSync(appsPath(), "utf8")).not.toContain("something");
  });

  it("returns 404 when the application number is not found", async () => {
    writeTracker([
      "| 1 | 2026-06-01 | Acme | Android | LinkedIn | http://x | Applied | R1 | followup | n |",
    ]);
    const res = await POST(jsonReq({ n: "99", notes: "ghost" }));
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "not-found" });
  });

  it("returns 404 when applications.md does not exist", async () => {
    // No tracker file written.
    const res = await POST(jsonReq({ n: "1", notes: "x" }));
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "not-found" });
  });

  it("returns 400 (invalid) when the note contains a pipe (would scramble the row)", async () => {
    writeTracker([
      "| 1 | 2026-06-01 | Acme | Android | LinkedIn | http://x | Applied | R1 | followup | n |",
    ]);
    const res = await POST(jsonReq({ n: "1", notes: "a | b" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "invalid" });
  });

  it("returns 400 (invalid) when the note contains a newline", async () => {
    writeTracker([
      "| 1 | 2026-06-01 | Acme | Android | LinkedIn | http://x | Applied | R1 | followup | n |",
    ]);
    const res = await POST(jsonReq({ n: "1", notes: "line1\nline2" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "invalid" });
  });

  it("rejects a missing application number with 400", async () => {
    const res = await POST(jsonReq({ notes: "x" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "n and notes required" });
  });

  it("rejects a non-string notes value with 400", async () => {
    const res = await POST(jsonReq({ n: "1", notes: 123 }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "n and notes required" });
  });

  it("rejects malformed JSON with 400 'bad json'", async () => {
    const res = await POST(jsonReq("{ not valid json"));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "bad json" });
  });

  it("is profile-scoped: the edit lands in the requestRoot tmp tree", async () => {
    writeTracker([
      "| 7 | 2026-06-01 | Beta | Lead | Referral | http://y | Screen | R0 | wait | seed |",
    ]);
    const res = await POST(jsonReq({ n: "7", notes: "scoped-write" }));
    expect(res.status).toBe(200);
    // Written into TMP/data/applications.md and nowhere else.
    expect(fs.readFileSync(appsPath(), "utf8")).toContain("scoped-write");
  });
});
