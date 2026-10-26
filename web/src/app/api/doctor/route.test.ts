import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * /api/doctor orchestrates the core's own cold-start check: it shells out to
 * `node <root>/doctor.mjs --json` (via execFile) and surfaces the verdict as
 * { available, onboardingNeeded, missing, warnings }. We don't run a real
 * subprocess — node:child_process.execFile is mocked with a controllable fake
 * whose stdout each test sets. careerOpsRoot/rootScript and requestRoot are also
 * mocked so nothing touches the user's real engine or data.
 *
 * The doctor script path comes from rootScript("doctor"); the route gates on
 * fs.existsSync(thatPath) before spawning, so we point rootScript at a real file
 * inside a tmp engine tree (present by default; deleted in the "missing" test).
 */

// A throwaway engine root holding a stand-in doctor.mjs so fs.existsSync passes.
const ENGINE = fs.mkdtempSync(path.join(os.tmpdir(), "co-doctor-engine-"));
const DOCTOR = path.join(ENGINE, "doctor.mjs");
fs.writeFileSync(DOCTOR, "// stand-in; never actually executed (execFile mocked)\n");

// The resolved DATA root requestRoot() returns (asserted to flow into env).
const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-doctor-data-"));

// Mutable holders the (hoisted) mock factories close over.
const h = vi.hoisted(() => ({
  // stdout the fake execFile callback resolves with.
  stdout: "",
  // captured execFile call so tests can assert cmd/args/opts.
  lastCall: null as null | { cmd: string; args: string[]; opts: Record<string, unknown> },
  execFileMock: vi.fn(),
}));

h.execFileMock.mockImplementation(
  (cmd: string, args: string[], opts: Record<string, unknown>, cb: (err: Error | null, out: string) => void) => {
    h.lastCall = { cmd, args, opts };
    // The route only consumes stdout (`out || ""`); err is ignored.
    cb(null, h.stdout);
  },
);

vi.mock("node:child_process", () => ({ execFile: h.execFileMock }));

vi.mock("@/lib/career-ops", () => ({
  careerOpsRoot: () => ENGINE,
  rootScript: (name: string) => path.join(ENGINE, `${name}.mjs`),
}));

vi.mock("@/lib/profile-registry", () => ({
  requestRoot: vi.fn(async () => DATA_ROOT),
}));

import { GET } from "./route";

beforeEach(() => {
  h.stdout = "";
  h.lastCall = null;
  // Ensure the stand-in script exists at the start of every test.
  if (!fs.existsSync(DOCTOR)) fs.writeFileSync(DOCTOR, "// stand-in\n");
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  fs.rmSync(ENGINE, { recursive: true, force: true });
  fs.rmSync(DATA_ROOT, { recursive: true, force: true });
});

describe("GET /api/doctor", () => {
  it("reports available:false (and empty verdict) when doctor.mjs is absent — no spawn", async () => {
    fs.rmSync(DOCTOR, { force: true });
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ available: false, onboardingNeeded: false, missing: [], warnings: [] });
    // Short-circuited before execFile.
    expect(h.execFileMock).not.toHaveBeenCalled();
  });

  it("surfaces the core verdict (available:true) from the doctor JSON", async () => {
    h.stdout = JSON.stringify({ onboardingNeeded: true, missing: ["cv.md", "portals.yml"], warnings: ["stale token"] });
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({
      available: true,
      onboardingNeeded: true,
      missing: ["cv.md", "portals.yml"],
      warnings: ["stale token"],
    });
  });

  it("reports onboardingNeeded:false and empty arrays for an all-clear verdict", async () => {
    h.stdout = JSON.stringify({ onboardingNeeded: false, missing: [], warnings: [] });
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ available: true, onboardingNeeded: false, missing: [], warnings: [] });
  });

  it("a non-boolean onboardingNeeded is not a verdict: reports available:false", async () => {
    // Upstream hardening: `!!1` would read a malformed payload as a real answer.
    h.stdout = JSON.stringify({ onboardingNeeded: 1, missing: ["x"], warnings: [] });
    const body = await (await GET()).json();
    expect(body.available).toBe(false);
  });

  it("defaults missing/warnings to [] when the verdict omits them", async () => {
    h.stdout = JSON.stringify({ onboardingNeeded: false });
    const body = await (await GET()).json();
    expect(body).toEqual({ available: true, onboardingNeeded: false, missing: [], warnings: [] });
  });

  it("parses only the LAST line of stdout (ignores preceding log noise)", async () => {
    h.stdout = [
      "starting doctor check…",
      "scanning prerequisites",
      JSON.stringify({ onboardingNeeded: true, missing: ["modes/_profile.md"], warnings: [] }),
    ].join("\n");
    const body = await (await GET()).json();
    expect(body.available).toBe(true);
    expect(body.missing).toEqual(["modes/_profile.md"]);
  });

  it("tolerates trailing whitespace/blank lines around the JSON verdict", async () => {
    h.stdout = `\n  ${JSON.stringify({ onboardingNeeded: false, missing: [], warnings: [] })}  \n\n`;
    const body = await (await GET()).json();
    expect(body).toEqual({ available: true, onboardingNeeded: false, missing: [], warnings: [] });
  });

  it("reports available:false when the last stdout line is not valid JSON", async () => {
    h.stdout = "doctor crashed: Error: boom";
    const body = await (await GET()).json();
    expect(body).toEqual({ available: false, onboardingNeeded: false, missing: [], warnings: [] });
  });

  it("reports available:false when stdout is empty", async () => {
    h.stdout = "";
    const body = await (await GET()).json();
    // Upstream hardening: "doctor didn't answer" is never a clean bill of health.
    expect(body).toEqual({ available: false, onboardingNeeded: false, missing: [], warnings: [] });
  });

  it("invokes `node <doctor.mjs> --json` from the engine cwd with CAREER_OPS_ROOT = the resolved data root", async () => {
    h.stdout = JSON.stringify({ onboardingNeeded: false, missing: [], warnings: [] });
    await GET();
    expect(h.lastCall).not.toBeNull();
    expect(h.lastCall!.cmd).toBe(process.execPath);
    expect(h.lastCall!.args).toEqual([DOCTOR, "--json"]);
    expect(h.lastCall!.opts.cwd).toBe(ENGINE);
    const env = h.lastCall!.opts.env as Record<string, string>;
    expect(env.CAREER_OPS_ROOT).toBe(DATA_ROOT);
  });
});
