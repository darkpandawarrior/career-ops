import { describe, it, expect } from "vitest";
import {
  cleanChips,
  parseExplorePatch,
  filtersToParams,
  paramsToFilters,
  hasExploreParams,
  paramsToAi,
  aiToParams,
  isBroadSearch,
  DEFAULT_FILTERS,
  ATS_SOURCES,
} from "./explore";

describe("cleanChips", () => {
  it("returns [] for null/undefined/non-arrays of non-strings", () => {
    expect(cleanChips(null)).toEqual([]);
    expect(cleanChips(undefined)).toEqual([]);
    expect(cleanChips([1, 2, {}, null])).toEqual([]);
  });

  it("wraps a bare string into a single-element list", () => {
    expect(cleanChips("Product Manager")).toEqual(["Product Manager"]);
  });

  it("trims, drops blanks, and dedupes case-insensitively (keeping first casing)", () => {
    expect(cleanChips([" Product Manager ", "product manager", "", "APM", "apm"])).toEqual([
      "Product Manager",
      "APM",
    ]);
  });
});

describe("parseExplorePatch", () => {
  it("replaces list fields by default and leaves unspecified fields untouched", () => {
    const base = { ...DEFAULT_FILTERS, positive: ["Android"], negative: ["iOS"] };
    const out = parseExplorePatch({ positive: ["Product Manager"] }, base);
    expect(out.positive).toEqual(["Product Manager"]);
    expect(out.negative).toEqual(["iOS"]); // untouched
  });

  it("merges list fields when merge=true (additive + deduped)", () => {
    const base = { ...DEFAULT_FILTERS, positive: ["Product Manager"] };
    const out = parseExplorePatch({ positive: ["APM", "product manager"] }, base, true);
    expect(out.positive).toEqual(["Product Manager", "APM"]);
  });

  it("clamps sinceDays to [1,60] and limit to [50,500]", () => {
    expect(parseExplorePatch({ since: 999 }).sinceDays).toBe(60);
    expect(parseExplorePatch({ since: 0 }).sinceDays).toBe(1);
    expect(parseExplorePatch({ limit: 5 }).limitPerAts).toBe(50);
    expect(parseExplorePatch({ limit: 9999 }).limitPerAts).toBe(500);
  });

  it("filters ats to known sources, falling back to all when none valid", () => {
    expect(parseExplorePatch({ ats: ["greenhouse", "bogus"] }).ats).toEqual(["greenhouse"]);
    expect(parseExplorePatch({ ats: ["nope"] }).ats).toEqual([...ATS_SOURCES]);
  });
});

describe("hasExploreParams (regression: ?profile=slug must NOT count as a search)", () => {
  it("is false for an empty query", () => {
    expect(hasExploreParams(new URLSearchParams(""))).toBe(false);
  });

  it("is false for unrelated params like profile / cache-busters", () => {
    expect(hasExploreParams(new URLSearchParams("profile=lakshita"))).toBe(false);
    expect(hasExploreParams(new URLSearchParams("profile=lakshita&_cb=123"))).toBe(false);
  });

  it("is true only when a real filter key is present", () => {
    for (const k of ["q", "not", "loc", "noloc", "home", "since", "ats", "limit"]) {
      expect(hasExploreParams(new URLSearchParams(`${k}=x`))).toBe(true);
    }
  });
});

describe("filters <-> params round trip", () => {
  it("encodes non-default fields and decodes them back", () => {
    const f = {
      ...DEFAULT_FILTERS,
      positive: ["Product Manager", "APM"],
      negative: ["Intern"],
      sinceDays: 14,
      limitPerAts: 200,
      ats: ["greenhouse", "lever"] as typeof DEFAULT_FILTERS.ats,
    };
    const sp = new URLSearchParams(filtersToParams(f));
    const back = paramsToFilters(sp);
    expect(back.positive).toEqual(["Product Manager", "APM"]);
    expect(back.negative).toEqual(["Intern"]);
    expect(back.sinceDays).toBe(14);
    expect(back.limitPerAts).toBe(200);
    expect(back.ats).toEqual(["greenhouse", "lever"]);
  });

  it("omits default-valued fields from the query string", () => {
    expect(filtersToParams(DEFAULT_FILTERS)).toBe("");
  });
});

describe("AI mode codec", () => {
  it("paramsToAi returns null unless mode=ai", () => {
    expect(paramsToAi(new URLSearchParams("q=x"))).toBeNull();
    expect(paramsToAi(new URLSearchParams("mode=ai&intent=fintech+PM"))).toBe("fintech PM");
    expect(paramsToAi(new URLSearchParams("mode=ai"))).toBe("");
  });

  it("aiToParams round-trips an intent", () => {
    expect(paramsToAi(new URLSearchParams(aiToParams("growth PM")))).toBe("growth PM");
  });
});

describe("isBroadSearch", () => {
  it("treats an empty positive list as broad", () => {
    expect(isBroadSearch(DEFAULT_FILTERS)).toBe(true);
  });
});
