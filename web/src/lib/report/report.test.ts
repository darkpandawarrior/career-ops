// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { scrub, issueBody, issueUrl, collect, errorClass, fingerprint, type Diag, type Shape } from "./report";

// ---------------------------------------------------------------------------
// scrub — PII / secret redaction
// ---------------------------------------------------------------------------
describe("scrub", () => {
  it("returns an empty string for null/undefined/empty input (|| '' guard)", () => {
    expect(scrub("")).toBe("");
    // The `s || ""` guard means falsy non-strings collapse to "".
    expect(scrub(undefined as unknown as string)).toBe("");
    expect(scrub(null as unknown as string)).toBe("");
  });

  it("collapses a macOS /Users/<name> home path to ~", () => {
    expect(scrub("/Users/santifer/Repos/career-ops")).toBe("~/Repos/career-ops");
  });

  it("collapses a Linux /home/<name> home path to ~", () => {
    expect(scrub("/home/santifer/work/log.txt")).toBe("~/work/log.txt");
  });

  it("stops the home-path match at whitespace / quotes (does not eat the next token)", () => {
    expect(scrub('error in /Users/bob "next"')).toBe('error in ~ "next"');
    expect(scrub("paths: /home/alice /home/carol")).toBe("paths: ~ ~");
  });

  it("redacts a token-like secret while keeping its label + separator", () => {
    expect(scrub("token=abcdef1234567890")).toBe("token=[redacted]");
    expect(scrub("api_key: SECRETVALUE123")).toBe("api_key: [redacted]");
    expect(scrub('bearer "ABCDEFGH12345"')).toBe('bearer "[redacted]"');
  });

  it("redacts the sk-style prefix and is case-insensitive on the label", () => {
    expect(scrub("sk-ABCDEFGH1234")).toBe("sk-[redacted]");
    expect(scrub("SECRET = mypassword99")).toBe("SECRET = [redacted]");
  });

  it("does NOT redact short values below the 8-char threshold", () => {
    // The secret-value group requires {8,} chars; "short12" is 7.
    expect(scrub("token=short12")).toBe("token=short12");
  });

  it("does NOT redact a label with no separator+value following it", () => {
    expect(scrub("the secret is safe")).toBe("the secret is safe");
  });

  it("scrubs both a home path and a secret in the same string", () => {
    expect(scrub("/Users/dev ran with api-key=DEADBEEF12345")).toBe("~ ran with api-key=[redacted]");
  });
});

// ---------------------------------------------------------------------------
// issueBody — markdown assembly
// ---------------------------------------------------------------------------
const sampleShape: Shape = {
  phase: "established",
  missing: [],
  hasCv: true,
  hasData: true,
  inboxCount: 4,
  applicationCount: 12,
};

const fullDiag: Diag = {
  version: "2.0.1",
  channel: "beta",
  sha: "abc1234",
  route: "/dashboard",
  cli: "claude",
  ua: "Mozilla/5.0 (TestBrowser)",
  viewport: "1280×720",
  logs: ["[error] boom", "[onerror] kaput @ x.js:10"],
  shape: sampleShape,
};

describe("issueBody", () => {
  it("renders every section with the diag fields filled in", () => {
    const body = issueBody(fullDiag, "I clicked the button and it exploded");
    expect(body).toContain("## What happened");
    expect(body).toContain("I clicked the button and it exploded");
    expect(body).toContain("## Environment");
    expect(body).toContain("- **Version:** `2.0.1` · beta · `abc1234`");
    expect(body).toContain("- **CLI:** claude");
    expect(body).toContain("- **Screen:** `/dashboard`");
    expect(body).toContain("- **Browser:** Mozilla/5.0 (TestBrowser)");
    expect(body).toContain("- **Viewport:** 1280×720");
    expect(body).toContain("## Data shape");
    expect(body).toContain("- **Phase:** established · **CV:** yes · **Data:** yes");
    expect(body).toContain("- **Inbox:** 4 · **Applications:** 12");
    expect(body).toContain("- **Missing prereqs:** none");
    expect(body).toContain("## Recent errors");
    expect(body).toContain("```\n[error] boom\n[onerror] kaput @ x.js:10\n```");
    expect(body).toContain(`Fingerprint: ${fingerprint(fullDiag)}`);
    expect(body).toContain("Contains NO CV, profile, application answers, or job URLs.");
  });

  it("renders '_(unavailable)_' for the data shape section when shape is null", () => {
    const d: Diag = { ...fullDiag, shape: null };
    const body = issueBody(d, "x");
    expect(body).toContain("## Data shape\n_(unavailable)_");
  });

  it("lists missing prereqs when the shape reports gaps", () => {
    const d: Diag = { ...fullDiag, shape: { ...sampleShape, missing: ["cv.md", "portals.yml"] } };
    const body = issueBody(d, "x");
    expect(body).toContain("- **Missing prereqs:** cv.md, portals.yml");
  });

  it("scrubs the description (PII never reaches the issue body)", () => {
    const body = issueBody(fullDiag, "crashed at /Users/santi with token=ABCDEF123456");
    expect(body).toContain("crashed at ~ with token=[redacted]");
    expect(body).not.toContain("/Users/santi");
    expect(body).not.toContain("ABCDEF123456");
  });

  it("falls back to a placeholder when the description is empty/whitespace", () => {
    const body = issueBody(fullDiag, "   ");
    expect(body).toContain("_(describe what you were doing and what went wrong)_");
  });

  it("omits the trailing sha segment when sha is empty", () => {
    const d: Diag = { ...fullDiag, sha: "" };
    const body = issueBody(d, "x");
    expect(body).toContain("- **Version:** `2.0.1` · beta");
    expect(body).not.toContain("· `");
  });

  it("uses '?' and '—' placeholders when version / cli are empty", () => {
    const d: Diag = { ...fullDiag, version: "", cli: "", sha: "" };
    const body = issueBody(d, "x");
    expect(body).toContain("- **Version:** `?` · beta");
    expect(body).toContain("- **CLI:** —");
  });

  it("renders '_(none captured)_' when there are no logs", () => {
    const d: Diag = { ...fullDiag, logs: [] };
    const body = issueBody(d, "x");
    expect(body).toContain("## Recent errors\n_(none captured)_");
    expect(body).not.toContain("```");
  });

  it("scrubs the user-agent string in the Browser line", () => {
    const d: Diag = { ...fullDiag, ua: "UA from /Users/secretuser/agent" };
    const body = issueBody(d, "x");
    expect(body).toContain("- **Browser:** UA from ~/agent");
  });

  it("caps the body at 6000 characters", () => {
    const d: Diag = { ...fullDiag, logs: [] };
    const body = issueBody(d, "z".repeat(10000));
    expect(body.length).toBe(6000);
  });
});

// ---------------------------------------------------------------------------
// issueUrl — GitHub issue URL builder (reuses scrub + issueBody)
// ---------------------------------------------------------------------------
describe("issueUrl", () => {
  it("builds a GitHub new-issue URL with title, body and labels", () => {
    const url = issueUrl(fullDiag, "Something broke");
    expect(url.startsWith("https://github.com/kirklazar-android/hiresignal/issues/new?")).toBe(true);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("title")).toBe("[web beta] Something broke");
    expect(qs.get("labels")).toBe("2.0-beta,area:web");
    expect(qs.get("body")).toContain("## What happened");
    expect(qs.get("body")).toContain("Something broke");
  });

  it("collapses whitespace and truncates the title to 70 chars", () => {
    const url = issueUrl(fullDiag, "word ".repeat(40));
    const qs = new URLSearchParams(url.split("?")[1]);
    const title = qs.get("title")!;
    // Prefix "[web beta] " + up to 70 chars of the collapsed/trimmed description.
    const desc = title.replace("[web beta] ", "");
    expect(desc.length).toBeLessThanOrEqual(70);
    expect(desc).not.toMatch(/\s{2,}/);
  });

  it("uses the 'bug report' fallback title when description scrubs to empty", () => {
    const url = issueUrl(fullDiag, "");
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("title")).toBe("[web beta] bug report");
  });

  it("scrubs PII out of the title", () => {
    const url = issueUrl(fullDiag, "/Users/santi token=ABCDEF123456");
    const qs = new URLSearchParams(url.split("?")[1]);
    const title = qs.get("title")!;
    expect(title).not.toContain("/Users/santi");
    expect(title).not.toContain("ABCDEF123456");
    expect(title).toContain("~");
    expect(title).toContain("[redacted]");
  });
});

// ---------------------------------------------------------------------------
// errorClass — deterministic category label for an error message
// ---------------------------------------------------------------------------
describe("errorClass", () => {
  it("classifies common error message patterns", () => {
    expect(errorClass("TypeError: x is not a function")).toBe("TypeError");
    expect(errorClass("NetworkError when attempting to fetch resource")).toBe("NetworkError");
    expect(errorClass("Failed to fetch")).toBe("NetworkError");
    expect(errorClass("RangeError: invalid array length")).toBe("RangeError");
    expect(errorClass("ReferenceError: x is not defined")).toBe("ReferenceError");
    expect(errorClass("SyntaxError: unexpected token")).toBe("SyntaxError");
    expect(errorClass("[api] 500 Internal Server Error @ /api/foo")).toBe("ApiError");
  });

  it("falls back to 'Error' for an unrecognized message and 'None' for empty", () => {
    expect(errorClass("something weird happened")).toBe("Error");
    expect(errorClass("")).toBe("None");
  });
});

// ---------------------------------------------------------------------------
// fingerprint — stable dedupe ID (route + last error class + phase)
// ---------------------------------------------------------------------------
describe("fingerprint", () => {
  it("is deterministic for the same inputs", () => {
    expect(fingerprint(fullDiag)).toBe(fingerprint(fullDiag));
  });

  it("is prefixed with co-web-", () => {
    expect(fingerprint(fullDiag)).toMatch(/^co-web-[a-z0-9]+$/);
  });

  it("differs when the route differs", () => {
    const other: Diag = { ...fullDiag, route: "/other" };
    expect(fingerprint(other)).not.toBe(fingerprint(fullDiag));
  });

  it("differs when the newest error's class differs", () => {
    const other: Diag = { ...fullDiag, logs: ["[error] TypeError: boom"] };
    expect(fingerprint(other)).not.toBe(fingerprint(fullDiag));
  });
});

// ---------------------------------------------------------------------------
// collect — diagnostic snapshot (mocked fetch + jsdom location/navigator)
// ---------------------------------------------------------------------------
describe("collect", () => {
  function setLocation(pathname: string, search = "") {
    // jsdom's location is read-only via assignment; redefine the bits collect reads.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname, search } as Location,
    });
  }

  function jsonResp(payload: unknown) {
    return { json: async () => payload };
  }

  beforeEach(() => {
    setLocation("/dashboard", "?tab=jobs");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("assembles a Diag from /api/version + /api/cli + /api/report/shape and jsdom env", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input === "/api/version") {
        return jsonResp({ version: "2.0.1", channel: "beta", sha: "deadbee" });
      }
      if (input === "/api/cli") {
        return jsonResp({ selected: "codex" });
      }
      if (input === "/api/report/shape") {
        return jsonResp(sampleShape);
      }
      throw new Error(`unexpected fetch ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const d = await collect();

    expect(d.version).toBe("2.0.1");
    expect(d.channel).toBe("beta");
    expect(d.sha).toBe("deadbee");
    expect(d.cli).toBe("codex");
    expect(d.route).toBe("/dashboard?tab=jobs");
    expect(d.ua).toBe(navigator.userAgent);
    expect(d.viewport).toBe(`${window.innerWidth}×${window.innerHeight}`);
    expect(Array.isArray(d.logs)).toBe(true);
    expect(d.shape).toEqual(sampleShape);
    expect(fetchMock).toHaveBeenCalledWith("/api/version");
    expect(fetchMock).toHaveBeenCalledWith("/api/cli");
    expect(fetchMock).toHaveBeenCalledWith("/api/report/shape");
  });

  it("scrubs PII out of the route", async () => {
    setLocation("/job", "?path=/Users/santi/cv.md");
    const fetchMock = vi.fn(async () => jsonResp({}));
    vi.stubGlobal("fetch", fetchMock);

    const d = await collect();
    expect(d.route).toBe("/job?path=~/cv.md");
    expect(d.route).not.toContain("/Users/santi");
  });

  it("keeps defaults when /api/version rejects, still reads /api/cli", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input === "/api/version") throw new Error("network down");
      if (input === "/api/cli") return jsonResp({ selected: "claude" });
      if (input === "/api/report/shape") return jsonResp(sampleShape);
      throw new Error("unexpected");
    });
    vi.stubGlobal("fetch", fetchMock);

    const d = await collect();
    // version block kept its defaults
    expect(d.version).toBe("");
    expect(d.channel).toBe("stable");
    expect(d.sha).toBe("");
    // cli block still ran independently
    expect(d.cli).toBe("claude");
  });

  it("falls back to empty cli when /api/cli rejects", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input === "/api/version") return jsonResp({ version: "9.9", channel: "edge", sha: "f00" });
      if (input === "/api/cli") throw new Error("cli down");
      if (input === "/api/report/shape") return jsonResp(sampleShape);
      throw new Error("unexpected");
    });
    vi.stubGlobal("fetch", fetchMock);

    const d = await collect();
    expect(d.version).toBe("9.9");
    expect(d.channel).toBe("edge");
    expect(d.cli).toBe("");
  });

  it("defaults missing version-payload fields (channel falls back to 'stable')", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input === "/api/version") return jsonResp({}); // empty object
      if (input === "/api/cli") return jsonResp({}); // no `selected`
      if (input === "/api/report/shape") return jsonResp(sampleShape);
      throw new Error("unexpected");
    });
    vi.stubGlobal("fetch", fetchMock);

    const d = await collect();
    expect(d.version).toBe("");
    expect(d.channel).toBe("stable");
    expect(d.sha).toBe("");
    expect(d.cli).toBe("");
  });

  it("keeps all defaults when ALL endpoints reject", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("all down");
    });
    vi.stubGlobal("fetch", fetchMock);

    const d = await collect();
    expect(d.version).toBe("");
    expect(d.channel).toBe("stable");
    expect(d.sha).toBe("");
    expect(d.cli).toBe("");
    expect(d.shape).toBeNull();
    // structural fields are still populated from jsdom
    expect(d.route).toBe("/dashboard?tab=jobs");
    expect(typeof d.viewport).toBe("string");
  });

  it("produces a Diag that issueBody can render end-to-end", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input === "/api/version") return jsonResp({ version: "1.0", channel: "stable", sha: "" });
      if (input === "/api/cli") return jsonResp({ selected: "claude" });
      throw new Error("unexpected");
    });
    vi.stubGlobal("fetch", fetchMock);

    const d = await collect();
    const body = issueBody(d, "end to end");
    expect(body).toContain("- **Version:** `1.0` · stable");
    expect(body).toContain("- **CLI:** claude");
    expect(body).toContain("- **Screen:** `/dashboard?tab=jobs`");
  });
});
