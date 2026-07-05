import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * version/route.ts reports the WEB build's own version + channel + git sha:
 *   - version: first whitespace-delimited token of a VERSION file, tried at
 *     `<cwd>/../VERSION` then `<cwd>/VERSION` (first readable non-empty wins).
 *   - channel: derived from a pre-release suffix (-rc/-beta/-alpha/-next),
 *     else "stable".
 *   - sha: read from a build-time env var (VERCEL_GIT_COMMIT_SHA, then
 *     NEXT_PUBLIC_GIT_SHA, then GIT_COMMIT_SHA), truncated to 7 chars, "" if
 *     none are set. Deliberately NOT `execSync("git ...")` — that shelled out
 *     during Next's build-time trace phase (see d2d6f4b).
 *
 * fs.readFileSync is mocked so nothing touches the real filesystem; the env
 * vars are saved/restored per test so nothing leaks between them.
 */

// Hoisted holder so the mock factory can reference the shared spy (no TDZ).
const h = vi.hoisted(() => ({
  // Map of absolute VERSION path -> contents (or a sentinel to throw).
  files: new Map<string, string>(),
  readFileSyncMock: vi.fn(),
}));

h.readFileSyncMock.mockImplementation((p: string) => {
  // Keyed by the exact resolved path the route passes (built with path.join).
  if (h.files.has(p)) return h.files.get(p)!;
  const err = new Error(`ENOENT: no such file, open '${p}'`) as NodeJS.ErrnoException;
  err.code = "ENOENT";
  throw err;
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readFileSync = (...args: unknown[]) => h.readFileSyncMock(...args);
  return { ...actual, default: { ...actual, readFileSync }, readFileSync };
});

import path from "node:path";
import { GET } from "./route";

// The route resolves these via path.join, which COLLAPSES the "..":
//   parent -> <dirname(cwd)>/VERSION ,  local -> <cwd>/VERSION
const PARENT = path.join(process.cwd(), "..", "VERSION");
const LOCAL = path.join(process.cwd(), "VERSION");

function setVersionFile(which: "parent" | "local", contents: string) {
  h.files.set(which === "parent" ? PARENT : LOCAL, contents);
}

const SHA_VARS = ["VERCEL_GIT_COMMIT_SHA", "NEXT_PUBLIC_GIT_SHA", "GIT_COMMIT_SHA"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  h.files.clear();
  h.readFileSyncMock.mockClear();
  savedEnv = Object.fromEntries(SHA_VARS.map((k) => [k, process.env[k]]));
  for (const k of SHA_VARS) delete process.env[k];
});

afterEach(() => {
  for (const k of SHA_VARS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.clearAllMocks();
});

describe("GET /api/version", () => {
  it("reads version from the PARENT VERSION file and reports the git short sha", async () => {
    setVersionFile("parent", "1.2.3\n");
    process.env.VERCEL_GIT_COMMIT_SHA = "abc1234extra";
    const body = await (await GET()).json();
    expect(body).toEqual({ version: "1.2.3", channel: "stable", sha: "abc1234" });
  });

  it("truncates the sha to 7 characters", async () => {
    setVersionFile("parent", "1.0.0");
    process.env.VERCEL_GIT_COMMIT_SHA = "deadbeefcafe";
    const body = await (await GET()).json();
    expect(body.sha).toBe("deadbee");
  });

  it("takes only the FIRST whitespace-delimited token of the VERSION file", async () => {
    // A VERSION file with trailing metadata on the same/next lines.
    setVersionFile("parent", "2.5.0   built-on-friday\nextra line");
    const body = await (await GET()).json();
    expect(body.version).toBe("2.5.0");
  });

  it("falls back to the LOCAL VERSION file when the parent is unreadable", async () => {
    // No parent entry -> readFileSync throws for parent, succeeds for local.
    setVersionFile("local", "9.9.9\n");
    const body = await (await GET()).json();
    expect(body.version).toBe("9.9.9");
    // Parent was attempted first, then local.
    const triedPaths = h.readFileSyncMock.mock.calls.map((c) => c[0] as string);
    expect(triedPaths[0]).toBe(PARENT);
    expect(triedPaths).toContain(LOCAL);
  });

  it("skips an empty/whitespace-only parent file and uses the local file", async () => {
    // Parent exists but its first token is empty -> `if (v) return v` is false,
    // so the loop continues to the local candidate.
    setVersionFile("parent", "   \n  ");
    setVersionFile("local", "3.3.3");
    const body = await (await GET()).json();
    expect(body.version).toBe("3.3.3");
  });

  it("returns version \"\" when no VERSION file is readable anywhere", async () => {
    // Both candidates throw.
    const body = await (await GET()).json();
    expect(body.version).toBe("");
    expect(body.channel).toBe("stable");
  });

  // Channel matches `/-(rc|beta|alpha|next)\b/i`. The trailing \b requires a
  // word boundary AFTER the suffix, so a suffix immediately followed by another
  // word char (e.g. `-rc1`) does NOT match. Only a bare suffix or one followed
  // by a non-word char (`.`, end-of-string) matches. See REPORTED behavior note.
  it.each([
    ["1.2.3-rc", "rc"],
    ["1.2.3-rc.1", "rc"],
    ["2.0.0-beta.4", "beta"],
    ["2.0.0-alpha", "alpha"],
    ["4.1.0-next", "next"],
  ])("derives channel %s -> %s from the pre-release suffix", async (version, channel) => {
    setVersionFile("parent", version);
    const body = await (await GET()).json();
    expect(body.version).toBe(version);
    expect(body.channel).toBe(channel);
  });

  it("lowercases an uppercase channel suffix when at a word boundary (-RC -> rc)", async () => {
    setVersionFile("parent", "1.0.0-RC");
    const body = await (await GET()).json();
    expect(body.channel).toBe("rc");
  });

  it("matches a pre-release suffix glued to a numeric build (`-rc1` → rc) (regression)", async () => {
    // The (?![a-z]) lookahead recognises conventional RC tags like -rc1 / -RC2 /
    // -beta2 so the beta banner shows, while still rejecting words like -released.
    setVersionFile("parent", "1.2.3-rc1");
    expect((await (await GET()).json()).channel).toBe("rc");
    setVersionFile("parent", "2.0.0-beta2");
    expect((await (await GET()).json()).channel).toBe("beta");
  });

  it("reports channel \"stable\" for a plain semver with no suffix", async () => {
    setVersionFile("parent", "5.0.0");
    const body = await (await GET()).json();
    expect(body.channel).toBe("stable");
  });

  it("does not treat a non-prerelease hyphen token as a channel", async () => {
    // `-build` is not in (rc|beta|alpha|next), so channel stays stable.
    setVersionFile("parent", "1.0.0-build42");
    const body = await (await GET()).json();
    expect(body.channel).toBe("stable");
  });

  it("returns sha \"\" when no build-time sha env var is set", async () => {
    setVersionFile("parent", "1.0.0");
    const body = await (await GET()).json();
    expect(body).toEqual({ version: "1.0.0", channel: "stable", sha: "" });
  });

  it("VERCEL_GIT_COMMIT_SHA takes priority over the other two", async () => {
    setVersionFile("parent", "1.0.0");
    process.env.VERCEL_GIT_COMMIT_SHA = "vercel1";
    process.env.NEXT_PUBLIC_GIT_SHA = "nextpub";
    process.env.GIT_COMMIT_SHA = "gitcomm";
    const body = await (await GET()).json();
    expect(body.sha).toBe("vercel1");
  });

  it("falls back to NEXT_PUBLIC_GIT_SHA when VERCEL_GIT_COMMIT_SHA is unset", async () => {
    setVersionFile("parent", "1.0.0");
    process.env.NEXT_PUBLIC_GIT_SHA = "nextpub";
    process.env.GIT_COMMIT_SHA = "gitcomm";
    const body = await (await GET()).json();
    expect(body.sha).toBe("nextpub");
  });

  it("falls back to GIT_COMMIT_SHA when neither of the other two is set", async () => {
    setVersionFile("parent", "1.0.0");
    process.env.GIT_COMMIT_SHA = "face123extra";
    const body = await (await GET()).json();
    expect(body.sha).toBe("face123");
  });

  it("still reports the sha even when there is no VERSION file (independent paths)", async () => {
    // version "" but the sha env var is still read independently.
    process.env.VERCEL_GIT_COMMIT_SHA = "face123extra";
    const body = await (await GET()).json();
    expect(body.version).toBe("");
    expect(body.sha).toBe("face123");
  });
});
