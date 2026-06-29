import { describe, it, expect } from "vitest";
import { canon } from "./explore-ai";
import { companyDomain, companyInitials, monogramHue } from "./company";

describe("canon (URL canonicalization)", () => {
  it("returns empty string for an empty URL (new URL throws, catch branch)", () => {
    expect(canon("")).toBe("");
  });

  it("lowercases host and path, keeping host+pathname only", () => {
    expect(canon("https://Example.com/Jobs/123")).toBe("example.com/jobs/123");
  });

  it("strips query string and hash fragment for a valid URL", () => {
    expect(canon("https://boards.greenhouse.io/acme/jobs/42?utm=x#apply")).toBe(
      "boards.greenhouse.io/acme/jobs/42",
    );
  });

  it("strips a trailing slash from a valid URL path", () => {
    expect(canon("https://jobs.lever.co/acme/")).toBe("jobs.lever.co/acme");
  });

  it("drops the scheme/protocol entirely (host+pathname only)", () => {
    // http vs https on the same host+path canonicalize to the SAME key
    expect(canon("http://example.com/a")).toBe("example.com/a");
    expect(canon("https://example.com/a")).toBe("example.com/a");
  });

  it("drops userinfo but KEEPS the port (uses URL.host, not URL.hostname)", () => {
    // URL.host includes the port; the source intentionally uses x.host, so two
    // URLs that differ only by an explicit port do NOT dedup. Asserting current
    // behavior.
    expect(canon("https://user:pw@example.com:8080/path")).toBe("example.com:8080/path");
  });

  it("normalizes a bare host with no path to just the host (root '/' stripped)", () => {
    // new URL adds pathname '/', then trailing-slash strip removes it
    expect(canon("https://example.com")).toBe("example.com");
    expect(canon("https://example.com/")).toBe("example.com");
  });

  it("two URLs differing only in query/hash/case canonicalize identically (dedup intent)", () => {
    const a = canon("https://Example.com/Jobs/?ref=1");
    const b = canon("https://example.com/jobs/#section");
    expect(a).toBe(b);
    expect(a).toBe("example.com/jobs");
  });

  describe("fallback branch (string that is not a parseable URL)", () => {
    it("lowercases, strips from '?' onward, and strips a trailing slash", () => {
      // "example.com/Path/" is not absolute -> new URL throws -> catch branch
      expect(canon("example.com/Path/?q=1")).toBe("example.com/path");
    });

    it("strips from '#' onward in the fallback branch", () => {
      expect(canon("example.com/Path#frag")).toBe("example.com/path");
    });

    it("lowercases a plain non-URL token unchanged otherwise", () => {
      expect(canon("HELLO")).toBe("hello");
    });

    it("strips only a single trailing slash (regex /\\/$/)", () => {
      // Two trailing slashes -> only the last one removed
      expect(canon("example.com//")).toBe("example.com/");
    });
  });
});

describe("company identity helpers", () => {
  describe("companyDomain", () => {
    it("returns null for null/undefined/empty/whitespace names", () => {
      expect(companyDomain(null)).toBeNull();
      expect(companyDomain(undefined)).toBeNull();
      expect(companyDomain("")).toBeNull();
      expect(companyDomain("   ")).toBeNull();
    });

    it("resolves a curated override (case-insensitive) before any heuristic", () => {
      expect(companyDomain("Anthropic")).toBe("anthropic.com");
      expect(companyDomain("OpenAI")).toBe("openai.com");
      expect(companyDomain("HUGGING FACE")).toBe("huggingface.co");
      expect(companyDomain("Notion")).toBe("notion.so");
    });

    it("maps brand aliases to the canonical domain", () => {
      expect(companyDomain("facebook")).toBe("meta.com");
      expect(companyDomain("twitter")).toBe("x.com");
    });

    it("re-checks overrides after stripping a legal suffix (e.g. 'Stripe, Inc.')", () => {
      expect(companyDomain("Stripe, Inc.")).toBe("stripe.com");
    });

    it("falls back to slug + '.com' for an unknown multi-word name", () => {
      // legal suffix "Technologies" stripped, spaces collapsed into the slug
      expect(companyDomain("Acme Technologies")).toBe("acme.com");
    });

    it("collapses internal spaces/punctuation into a single slug", () => {
      expect(companyDomain("Foo & Bar")).toBe("foobar.com");
    });

    it("strips registered/trademark symbols before slugging", () => {
      expect(companyDomain("Acme®")).toBe("acme.com");
    });

    it("returns null when the slug is shorter than 2 chars after cleaning", () => {
      // single letter that is not an override -> slug length 1 -> null
      expect(companyDomain("Z")).toBeNull();
    });

    it("returns null when a name is entirely a legal suffix (cleaned to empty)", () => {
      // "Inc" is stripped by LEGAL_SUFFIX -> cleaned empty -> null
      expect(companyDomain("Inc")).toBeNull();
    });
  });

  describe("companyInitials", () => {
    it("returns '?' for null/undefined", () => {
      expect(companyInitials(null)).toBe("?");
      expect(companyInitials(undefined)).toBe("?");
    });

    it("returns two uppercase initials for a two-word name", () => {
      expect(companyInitials("Hugging Face")).toBe("HF");
    });

    it("returns up to two letters of a single-word name", () => {
      expect(companyInitials("Stripe")).toBe("ST");
    });

    it("uses the first two significant words, skipping a stripped legal suffix", () => {
      // "Inc" is stripped, leaving "Acme Labs"? no -> "Labs" is also a suffix.
      // "Acme Corp" -> "Corp" stripped -> single word "Acme" -> "AC"
      expect(companyInitials("Acme Corp")).toBe("AC");
    });

    it("falls back to the first char when name is only a legal suffix", () => {
      // "Inc" stripped -> words empty -> trimmed first char uppercased
      expect(companyInitials("Inc")).toBe("I");
    });

    it("returns '?' when name is only punctuation/whitespace (no words, empty trim slice)", () => {
      // "--" -> LEGAL_SUFFIX no match, non-alnum replaced with spaces -> no words,
      // then name.trim().slice(0,1) = "-" ... actually "-" is truthy -> "-"
      // Use whitespace-only to hit the "?" branch.
      expect(companyInitials("   ")).toBe("?");
    });

    it("uppercases lowercase input", () => {
      expect(companyInitials("acme bricks")).toBe("AB");
    });
  });

  describe("monogramHue", () => {
    it("returns a number in [0, 360)", () => {
      const h = monogramHue("Anthropic");
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    });

    it("is deterministic for the same name", () => {
      expect(monogramHue("Stripe")).toBe(monogramHue("Stripe"));
    });

    it("is case- and whitespace-insensitive (trim + lowercase before hashing)", () => {
      expect(monogramHue("  Stripe ")).toBe(monogramHue("stripe"));
    });

    it("returns 0 for null/undefined/empty (empty string hashes to 0)", () => {
      expect(monogramHue(null)).toBe(0);
      expect(monogramHue(undefined)).toBe(0);
      expect(monogramHue("")).toBe(0);
    });

    it("distinguishes different names (not all collapsing to one hue)", () => {
      const hues = new Set(
        ["Anthropic", "OpenAI", "Google", "Meta", "Stripe"].map(monogramHue),
      );
      expect(hues.size).toBeGreaterThan(1);
    });
  });
});
