import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The route resolves the active profile's data root via requestRoot() and then
// calls the REAL tracker-edit helpers (queueAgentTask / removeAgentTask), which
// read+write data/agent-inbox.md under that root. We mock ONLY requestRoot so it
// points at a throwaway tmp tree — nothing touches the user's real data, and the
// actual file I/O of tracker-edit is exercised end-to-end against the fixture.
let ROOT: string;
vi.mock("@/lib/profile-registry", () => ({
  requestRoot: vi.fn(async () => ROOT),
}));

import { POST, DELETE } from "./route";

const inboxPath = () => path.join(ROOT, "data", "agent-inbox.md");
const writeInbox = (content: string) => {
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(inboxPath(), content);
};
const readInbox = () => fs.readFileSync(inboxPath(), "utf8");

const postReq = (body: unknown) =>
  new Request("http://localhost/api/queue", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const deleteReq = (body: unknown) =>
  new Request("http://localhost/api/queue", {
    method: "DELETE",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-queue-route-"));
});
afterEach(() => {
  vi.clearAllMocks();
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("POST /api/queue", () => {
  it("queues a task, writing data/agent-inbox.md under the resolved root", async () => {
    const res = await POST(postReq({ text: "review the Plum offer" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    // File created with a `- [ ] … — <text>` checklist line.
    expect(fs.existsSync(inboxPath())).toBe(true);
    const md = readInbox();
    expect(md).toMatch(/- \[ \] .* — review the Plum offer/);
  });

  it("appends to an existing inbox, preserving prior content", async () => {
    writeInbox("# Agent Inbox\n\n- [ ] 2026-01-01 00:00 — old task\n");
    const res = await POST(postReq({ text: "brand new task" }));
    expect(res.status).toBe(200);
    const md = readInbox();
    expect(md).toContain("old task");
    expect(md).toMatch(/- \[ \] .* — brand new task/);
  });

  it("dedupes: queueing the same text twice does not add a second line", async () => {
    await POST(postReq({ text: "duplicate me" }));
    const first = readInbox();
    const res = await POST(postReq({ text: "duplicate me" }));
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ ok: true });
    // Second queue is a no-op (dedupe) — file content unchanged.
    expect(readInbox()).toBe(first);
    expect(readInbox().match(/duplicate me/g)).toHaveLength(1);
  });

  it("rejects an empty/whitespace text with 400 'text required' and writes nothing", async () => {
    const res = await POST(postReq({ text: "   " }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "text required" });
    expect(fs.existsSync(inboxPath())).toBe(false);
  });

  it("rejects a missing text field with 400 'text required'", async () => {
    const res = await POST(postReq({ notText: "hi" }));
    expect(res.status).toBe(400);
    expect((await res.json())).toEqual({ error: "text required" });
  });

  it("rejects a malformed JSON body with 400 'bad json'", async () => {
    const res = await POST(postReq("{ not valid json"));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "bad json" });
  });
});

describe("DELETE /api/queue", () => {
  it("removes a queued task by substring match and returns ok", async () => {
    writeInbox(
      ["# Agent Inbox", "", "- [ ] 2026-01-01 00:00 — keep this one", "- [ ] 2026-01-02 00:00 — remove this one", ""].join("\n"),
    );
    const res = await DELETE(deleteReq({ text: "remove this one" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    const md = readInbox();
    expect(md).toContain("keep this one");
    expect(md).not.toContain("remove this one");
  });

  it("returns 404 'not-found' when no task matches the text", async () => {
    writeInbox("# Agent Inbox\n\n- [ ] 2026-01-01 00:00 — only task\n");
    const res = await DELETE(deleteReq({ text: "nonexistent" }));
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "not-found" });
  });

  it("returns 404 'not-found' when the inbox file is absent", async () => {
    const res = await DELETE(deleteReq({ text: "anything" }));
    expect(res.status).toBe(404);
    expect((await res.json())).toEqual({ error: "not-found" });
  });

  it("rejects an empty text with 400 'text required'", async () => {
    const res = await DELETE(deleteReq({ text: "" }));
    expect(res.status).toBe(400);
    expect((await res.json())).toEqual({ error: "text required" });
  });

  it("rejects a malformed JSON body with 400 'bad json'", async () => {
    const res = await DELETE(deleteReq("not json at all {"));
    expect(res.status).toBe(400);
    expect((await res.json())).toEqual({ error: "bad json" });
  });

  it("round-trips: a POSTed task can then be DELETEd", async () => {
    await POST(postReq({ text: "round trip task" }));
    expect(readInbox()).toContain("round trip task");
    const res = await DELETE(deleteReq({ text: "round trip task" }));
    expect(res.status).toBe(200);
    expect(readInbox()).not.toContain("round trip task");
  });
});
