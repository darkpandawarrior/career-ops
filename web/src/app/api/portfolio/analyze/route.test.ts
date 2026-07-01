import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let ROOT: string;
let childStdout = "";

vi.mock("@/lib/profile-registry", () => ({ requestRoot: vi.fn(async () => ROOT) }));
vi.mock("@/lib/career-ops", async (orig) => ({ ...(await orig<typeof import("@/lib/career-ops")>()), careerOpsRoot: () => ROOT }));
vi.mock("@/lib/clis", () => ({ resolveCli: vi.fn((id: string) => (id === "claude" ? { spec: { name: "Claude", args: (p: string) => [p] }, binPath: "/bin/claude" } : null)) }));

// Fake child: emits the canned stdout then closes.
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => {
      child.stdout.emit("data", Buffer.from(childStdout));
      child.emit("close", 0);
    }, 0);
    return child;
  }),
}));

import { writePortfolio } from "@/lib/portfolio/context";
import { POST } from "./route";

const req = (body: unknown) => new Request("http://x/api/portfolio/analyze", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-pa-"));
  writePortfolio({ name: "Ada Lovelace", title: "Engineer", tagline: "v1" }, ROOT);
  childStdout = JSON.stringify({ score: 82, strengths: ["clear metrics"], gaps: ["thin case studies"], suggestions: [{ title: "Deepen GPS", why: "credibility", action: "Add the before/after numbers." }] });
});
afterEach(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("POST /api/portfolio/analyze", () => {
  it("returns a coerced analysis from the CLI's JSON output", async () => {
    const body = await (await POST(req({ cliId: "claude" }))).json();
    expect(body.analysis.score).toBe(82);
    expect(body.analysis.strengths).toEqual(["clear metrics"]);
    expect(body.analysis.suggestions[0].action).toBe("Add the before/after numbers.");
  });

  it("400s without a cliId, 404s an unknown CLI", async () => {
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ cliId: "ghost" }))).status).toBe(404);
  });

  it("400s when there is no portfolio to analyze", async () => {
    fs.rmSync(path.join(ROOT, ".career-ops-web"), { recursive: true, force: true });
    expect((await POST(req({ cliId: "claude" }))).status).toBe(400);
  });

  it("502s when the CLI returns nothing usable", async () => {
    childStdout = "sorry, no json here";
    expect((await POST(req({ cliId: "claude" }))).status).toBe(502);
  });
});
