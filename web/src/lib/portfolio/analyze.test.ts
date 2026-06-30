import { describe, it, expect } from "vitest";
import { coerceAnalysis } from "./analyze";

describe("coerceAnalysis", () => {
  it("returns null for non-objects or fully-empty analyses", () => {
    expect(coerceAnalysis(null)).toBeNull();
    expect(coerceAnalysis({})).toBeNull();
    expect(coerceAnalysis({ strengths: [], gaps: [], suggestions: [] })).toBeNull();
  });

  it("keeps strengths/gaps and well-formed suggestions, clamping the score", () => {
    const a = coerceAnalysis({
      score: 150,
      strengths: ["strong metrics", "", 5],
      gaps: ["vague case studies"],
      suggestions: [
        { title: "Quantify GPS", why: "credibility", action: "Add before/after numbers to the GPS case study." },
        { title: "no action" }, // dropped (no action)
        { action: "no title" }, // dropped (no title)
      ],
    })!;
    expect(a.score).toBe(100); // clamped
    expect(a.strengths).toEqual(["strong metrics"]);
    expect(a.gaps).toEqual(["vague case studies"]);
    expect(a.suggestions).toEqual([{ title: "Quantify GPS", why: "credibility", action: "Add before/after numbers to the GPS case study." }]);
  });

  it("omits an out-of-range / non-numeric score", () => {
    expect(coerceAnalysis({ score: "x", strengths: ["a"] })!.score).toBeUndefined();
    expect(coerceAnalysis({ score: -5, gaps: ["g"] })!.score).toBe(0);
  });

  it("is resilient to a suggestions value that isn't an array", () => {
    const a = coerceAnalysis({ strengths: ["a"], suggestions: "nope" })!;
    expect(a.suggestions).toEqual([]);
    expect(a.strengths).toEqual(["a"]);
  });
});
