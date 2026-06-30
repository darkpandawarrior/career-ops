import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let ROOT: string;
vi.mock("@/lib/profile-registry", () => ({ requestRoot: vi.fn(async () => ROOT) }));

import { writePortfolio, readPortfolio } from "@/lib/portfolio/context";
import { POST } from "./route";

const req = (body: unknown) => new Request("http://x/api/portfolio/theme", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-theme-"));
});
afterEach(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("POST /api/portfolio/theme", () => {
  it("sets the draft's theme + re-renders, without creating a new version", async () => {
    writePortfolio({ name: "Ada", title: "X", tagline: "y" }, ROOT, "v1");
    const before = readPortfolio(ROOT).versions.length;

    const body = await (await POST(req({ theme: "aurora" }))).json();
    expect(body.ok).toBe(true);
    expect(body.theme).toBe("aurora");
    expect(body.html).toContain("#8b7cff"); // aurora accent landed in the rendered html

    const after = readPortfolio(ROOT);
    expect(after.data?.theme).toBe("aurora");
    expect(after.versions.length).toBe(before); // no new version snapshotted
  });

  it("rejects an unknown theme, missing portfolio, and bad json", async () => {
    // unknown theme (with a draft present)
    writePortfolio({ name: "Ada", title: "X", tagline: "y" }, ROOT);
    expect((await POST(req({ theme: "ghost" }))).status).toBe(400);
    // bad json
    expect((await POST(new Request("http://x/api/portfolio/theme", { method: "POST", body: "{bad" }))).status).toBe(400);
    // no portfolio
    fs.rmSync(path.join(ROOT, ".career-ops-web"), { recursive: true, force: true });
    expect((await POST(req({ theme: "aurora" }))).status).toBe(400);
  });
});
