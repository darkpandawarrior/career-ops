import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The route resolves the active profile's data root via requestRoot() and calls
// the REAL togglePipeline helper, which rewrites a `- [ ] URL` ↔ `- [x] URL`
// checkbox in data/pipeline.md under that root. We mock ONLY requestRoot to point
// at a throwaway tmp tree — the real file I/O runs against the fixture.
let ROOT: string;
vi.mock("@/lib/profile-registry", () => ({
  requestRoot: vi.fn(async () => ROOT),
}));

import { POST } from "./route";

const pipelinePath = () => path.join(ROOT, "data", "pipeline.md");
const writePipeline = (content: string) => {
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(pipelinePath(), content);
};
const readPipeline = () => fs.readFileSync(pipelinePath(), "utf8");

const req = (body: unknown) =>
  new Request("http://localhost/api/pipeline-toggle", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-pipetoggle-route-"));
});
afterEach(() => {
  vi.clearAllMocks();
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("POST /api/pipeline-toggle", () => {
  it("marks an unchecked URL done (`- [ ]` → `- [x]`) and returns ok", async () => {
    writePipeline(
      ["# Pipeline", "- [ ] https://x.co/1 | Acme | Android Lead", "- [ ] https://x.co/2 | Globex | SDE"].join("\n"),
    );
    const res = await POST(req({ url: "https://x.co/1" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    const md = readPipeline();
    expect(md).toContain("- [x] https://x.co/1");
    // The other row is untouched.
    expect(md).toContain("- [ ] https://x.co/2");
  });

  it("un-marks a done URL when done:false is passed (`- [x]` → `- [ ]`)", async () => {
    writePipeline(["# Pipeline", "- [x] https://x.co/1 | Acme | Android Lead"].join("\n"));
    const res = await POST(req({ url: "https://x.co/1", done: false }));
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ ok: true });
    expect(readPipeline()).toContain("- [ ] https://x.co/1");
  });

  it("defaults to done:true when `done` is omitted", async () => {
    writePipeline(["# Pipeline", "- [ ] https://x.co/3 | Co | Role"].join("\n"));
    const res = await POST(req({ url: "https://x.co/3" }));
    expect(res.status).toBe(200);
    expect(readPipeline()).toContain("- [x] https://x.co/3");
  });

  it("treats any done value other than literal false as true", async () => {
    // togglePipeline receives `b.done !== false` → "yes" !== false → true.
    writePipeline(["# Pipeline", "- [ ] https://x.co/4 | Co | Role"].join("\n"));
    const res = await POST(req({ url: "https://x.co/4", done: "yes" }));
    expect(res.status).toBe(200);
    expect(readPipeline()).toContain("- [x] https://x.co/4");
  });

  it("escapes regex-special characters in the URL so it matches literally", async () => {
    const url = "https://x.co/jobs?id=1&ref=a.b+c";
    writePipeline(["# Pipeline", `- [ ] ${url} | Co | Role`].join("\n"));
    const res = await POST(req({ url }));
    expect(res.status).toBe(200);
    expect(readPipeline()).toContain(`- [x] ${url}`);
  });

  it("returns 404 'not-found' when the URL is not in the pipeline", async () => {
    writePipeline(["# Pipeline", "- [ ] https://x.co/known | Co | Role"].join("\n"));
    const res = await POST(req({ url: "https://x.co/missing" }));
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "not-found" });
  });

  it("returns 404 'not-found' when pipeline.md is absent", async () => {
    const res = await POST(req({ url: "https://x.co/1" }));
    expect(res.status).toBe(404);
    expect((await res.json())).toEqual({ error: "not-found" });
  });

  it("rejects a missing url with 400 'url required' and writes nothing", async () => {
    const res = await POST(req({ done: true }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "url required" });
    expect(fs.existsSync(pipelinePath())).toBe(false);
  });

  it("rejects an empty-string url with 400 'url required'", async () => {
    const res = await POST(req({ url: "" }));
    expect(res.status).toBe(400);
    expect((await res.json())).toEqual({ error: "url required" });
  });

  it("rejects a malformed JSON body with 400 'bad json'", async () => {
    const res = await POST(req("{ not valid json"));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "bad json" });
  });

  it("round-trips: toggling done then undone restores the original line", async () => {
    writePipeline(["# Pipeline", "- [ ] https://x.co/rt | Co | Role"].join("\n"));
    await POST(req({ url: "https://x.co/rt" }));
    expect(readPipeline()).toContain("- [x] https://x.co/rt");
    await POST(req({ url: "https://x.co/rt", done: false }));
    expect(readPipeline()).toContain("- [ ] https://x.co/rt");
  });
});
