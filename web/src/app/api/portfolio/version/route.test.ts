import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let ROOT: string;
vi.mock("@/lib/profile-registry", () => ({ requestRoot: vi.fn(async () => ROOT) }));

import { writePortfolio, readPortfolio } from "@/lib/portfolio/context";
import { POST } from "./route";

const data = { name: "Ada Lovelace", title: "Engineer", tagline: "v1" };
const req = (body: unknown) => new Request("http://x/api/portfolio/version", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-pv-"));
  writePortfolio({ ...data, tagline: "v1" }, ROOT, "v1");
  writePortfolio({ ...data, tagline: "v2" }, ROOT, "v2");
});
afterEach(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("POST /api/portfolio/version", () => {
  it("restore makes a past version current and returns its html", async () => {
    expect(readPortfolio(ROOT).data?.tagline).toBe("v2");
    const body = await (await POST(req({ action: "restore", stamp: "v1" }))).json();
    expect(body.ok).toBe(true);
    expect(body.data.tagline).toBe("v1");
    expect(body.html).toContain("v1");
    expect(readPortfolio(ROOT).data?.tagline).toBe("v1");
  });

  it("restore 404s an unknown version and 400s a missing stamp", async () => {
    expect((await POST(req({ action: "restore", stamp: "ghost" }))).status).toBe(404);
    expect((await POST(req({ action: "restore" }))).status).toBe(400);
  });

  it("finalize marks a production version, and an empty stamp clears it", async () => {
    const r1 = await (await POST(req({ action: "finalize", stamp: "v2" }))).json();
    expect(r1.final).toBe("v2");
    expect(readPortfolio(ROOT).final).toBe("v2");

    const r2 = await (await POST(req({ action: "finalize", stamp: "" }))).json();
    expect(r2.final).toBeNull();
    expect(readPortfolio(ROOT).final).toBeNull();
  });

  it("finalize 404s an unknown version", async () => {
    expect((await POST(req({ action: "finalize", stamp: "ghost" }))).status).toBe(404);
  });

  it("rejects an unknown action and bad json", async () => {
    expect((await POST(req({ action: "nope" }))).status).toBe(400);
    expect((await POST(new Request("http://x/api/portfolio/version", { method: "POST", body: "{bad" }))).status).toBe(400);
  });
});
