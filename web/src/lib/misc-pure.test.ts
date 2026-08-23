import { describe, it, expect } from "vitest";
import { canon } from "./explore-ai";
import { companyDomain, companyInitials, monogramHue } from "./company";

describe("canon (URL canonicalization)", () => {
  // canon() now delegates to core/url-key.mjs's normalizeUrl (see that file's
  // docstring): it deliberately UNDER-normalizes — keeping scheme, path case,
  // userinfo, port, and every non-tracking query param — because the old
  // host+pathname-only key collapsed two DIFFERENT Greenhouse postings that
  // shared a host+path but differed only by `?gh_jid=` onto one dedup key,
  // silently dropping every opening after the first at that employer. Only a
  // fixed tracking-param denylist and the hash fragment are stripped.
  it("returns empty string for an empty URL", () => {
    expect(canon("")).toBe("");
  });

  it("returns empty string for a string with no scheme (new URL throws)", () => {
    // No special "fallback branch" any more — anything that isn't a
    // parseable absolute http(s) URL is simply unkeyable.
    expect(canon("example.com/Path/?q=1")).toBe("");
    expect(canon("HELLO")).toBe("");
  });

  it("returns empty string for a non-http(s) scheme", () => {
    expect(canon("mailto:a@b.com")).toBe("");
    expect(canon("ftp://example.com/a")).toBe("");
  });

  it("lowercases the host but KEEPS path case (no over-normalization)", () => {
    expect(canon("https://Example.com/Jobs/123")).toBe("https://example.com/Jobs/123");
  });

  it("strips the hash fragment but keeps a non-tracking query string", () => {
    expect(canon("https://boards.greenhouse.io/acme/jobs/42?gh_jid=111#apply")).toBe(
      "https://boards.greenhouse.io/acme/jobs/42?gh_jid=111",
    );
  });

  it("strips a trailing slash from a non-root path", () => {
    expect(canon("https://jobs.lever.co/acme/")).toBe("https://jobs.lever.co/acme");
  });

  it("normalizes http to https, so the two dedup to the same key", () => {
    expect(canon("http://example.com/a")).toBe("https://example.com/a");
    expect(canon("https://example.com/a")).toBe("https://example.com/a");
  });

  it("KEEPS userinfo and port (does not strip either)", () => {
    expect(canon("https://user:pw@example.com:8080/path")).toBe(
      "https://user:pw@example.com:8080/path",
    );
  });

  it("normalizes a bare host to the host plus its single root slash", () => {
    expect(canon("https://example.com")).toBe("https://example.com/");
    expect(canon("https://example.com/")).toBe("https://example.com/");
  });

  it("strips a real tracking param (utm_...) so the same posting still dedups", () => {
    const a = canon("https://boards.greenhouse.io/acme/jobs?gh_jid=111&utm_source=li");
    const b = canon("https://boards.greenhouse.io/acme/jobs?gh_jid=111");
    expect(a).toBe(b);
    expect(a).toBe("https://boards.greenhouse.io/acme/jobs?gh_jid=111");
  });

  it("does NOT dedup two postings that differ only by a non-tracking param (the #2429-class fix)", () => {
    const a = canon("https://boards.greenhouse.io/acme/jobs?gh_jid=111");
    const b = canon("https://boards.greenhouse.io/acme/jobs?gh_jid=222");
    expect(a).not.toBe(b);
  });

  it("does NOT dedup two URLs differing only by path case (case is preserved, not folded)", () => {
    const a = canon("https://Example.com/Jobs/?gh_jid=1");
    const b = canon("https://example.com/jobs/?gh_jid=1");
    expect(a).not.toBe(b);
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
