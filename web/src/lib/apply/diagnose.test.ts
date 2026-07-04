import { describe, it, expect } from "vitest";
import { statusBlock, knockoutWarnings } from "./diagnose";

// statusBlock is the ONLY pure export in diagnose.ts — it maps an HTTP nav status
// (+ response headers) to a hard ApplyIssue block before any DOM work. The other
// exports (dismissConsent, dropNewTabs, tryApplyTrigger, classifyEmpty,
// captchaWarning, multiStepInfo, verifyFill) all take a live Playwright
// Page/Frame and drive a real browser, so they are out of scope for unit tests.

const NO_HEADERS: Record<string, string> = {};

describe("statusBlock — non-blocking statuses", () => {
  it("returns null for a falsy status (0 / null / undefined): no nav response yet", () => {
    expect(statusBlock(0, NO_HEADERS)).toBeNull();
    expect(statusBlock(null, NO_HEADERS)).toBeNull();
    expect(statusBlock(undefined, NO_HEADERS)).toBeNull();
  });

  it("returns null for ordinary success / redirect statuses", () => {
    expect(statusBlock(200, NO_HEADERS)).toBeNull();
    expect(statusBlock(204, NO_HEADERS)).toBeNull();
    expect(statusBlock(301, NO_HEADERS)).toBeNull();
    expect(statusBlock(302, NO_HEADERS)).toBeNull();
  });

  it("returns null for client statuses it does not special-case (e.g. 400, 405)", () => {
    expect(statusBlock(400, NO_HEADERS)).toBeNull();
    expect(statusBlock(405, NO_HEADERS)).toBeNull();
  });
});

describe("statusBlock — auth", () => {
  it("maps 401 and 407 to an auth-required block", () => {
    for (const s of [401, 407]) {
      const issue = statusBlock(s, NO_HEADERS);
      expect(issue).toMatchObject({ level: "block", code: "auth-required" });
      expect(issue!.message).toMatch(/sign in/i);
    }
  });
});

describe("statusBlock — geo / legal", () => {
  it("maps 451 to a geo-block", () => {
    expect(statusBlock(451, NO_HEADERS)).toMatchObject({ level: "block", code: "geo-block" });
  });
});

describe("statusBlock — 403 forbidden vs cloudflare bot-block", () => {
  it("maps a plain 403 (no cf-* header) to 'forbidden'", () => {
    const issue = statusBlock(403, NO_HEADERS);
    expect(issue).toMatchObject({ level: "block", code: "forbidden" });
    expect(issue!.message).toMatch(/403/);
  });

  it("maps a 403 carrying cf-ray to 'bot-block'", () => {
    const issue = statusBlock(403, { "cf-ray": "abc123" });
    expect(issue).toMatchObject({ level: "block", code: "bot-block" });
    expect(issue!.message).toMatch(/bot check/i);
  });

  it("treats cf-mitigated and cf-request-id as cloudflare signals too", () => {
    expect(statusBlock(403, { "cf-mitigated": "challenge" })!.code).toBe("bot-block");
    expect(statusBlock(403, { "cf-request-id": "xyz" })!.code).toBe("bot-block");
  });
});

describe("statusBlock — rate limiting", () => {
  it("maps 429 to a rate-limited block", () => {
    const issue = statusBlock(429, NO_HEADERS);
    expect(issue).toMatchObject({ level: "block", code: "rate-limited" });
    expect(issue!.message).toMatch(/rate-limit/i);
  });
});

describe("statusBlock — server errors (>= 500)", () => {
  it("maps 500 and 503 to a server-error block, echoing the status in the message", () => {
    expect(statusBlock(500, NO_HEADERS)).toMatchObject({ level: "block", code: "server-error" });
    const issue = statusBlock(503, NO_HEADERS);
    expect(issue!.code).toBe("server-error");
    expect(issue!.message).toContain("503");
  });
});

describe("statusBlock — gone / not found", () => {
  it("maps 404 and 410 to a not-found block", () => {
    for (const s of [404, 410]) {
      const issue = statusBlock(s, NO_HEADERS);
      expect(issue).toMatchObject({ level: "block", code: "not-found" });
      expect(issue!.message).toMatch(/404/);
    }
  });
});

describe("statusBlock — precedence", () => {
  it("checks the >=500 branch before the 404/410 branch (e.g. 500 is server-error)", () => {
    // sanity: 500 is not mistakenly classified as not-found
    expect(statusBlock(500, NO_HEADERS)!.code).toBe("server-error");
  });
});

describe("knockoutWarnings", () => {
  it("returns [] when no field label mentions visa/sponsorship/clearance/work-auth", () => {
    expect(knockoutWarnings([{ label: "First name" }, { label: "Email" }])).toEqual([]);
  });

  it("flags a visa-sponsorship field as a warn (never a block)", () => {
    const out = knockoutWarnings([{ label: "Will you now or in the future require visa sponsorship?" }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ level: "warn", code: "knockout-question" });
    expect(out[0].message).toContain("Will you now or in the future require visa sponsorship?");
  });

  it("flags work-authorization and security-clearance phrasing too", () => {
    expect(knockoutWarnings([{ label: "Are you authorized to work in the US without sponsorship?" }])).toHaveLength(1);
    expect(knockoutWarnings([{ label: "Do you hold an active security clearance?" }])).toHaveLength(1);
  });

  it("only emits ONE issue even if several fields match (not one per field)", () => {
    const out = knockoutWarnings([{ label: "Visa status" }, { label: "Do you require sponsorship?" }, { label: "Right to work" }]);
    expect(out).toHaveLength(1);
  });

  it("ignores fields with no label", () => {
    expect(knockoutWarnings([{}, { label: "" }])).toEqual([]);
  });
});
