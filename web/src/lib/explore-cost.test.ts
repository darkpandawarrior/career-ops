import { describe, it, expect } from "vitest";
import { COST_META, type CostClass } from "./explore-cost";

// explore-cost is a pure taxonomy table: the FREE vs $ boundary the Explorer
// teaches by repetition. There is no math/estimate function exported — the module
// is a single frozen-by-convention record. These tests pin its shape and content
// so a future edit that drops a class, flips a label, or loosens the cost framing
// is caught.

const ALL_CLASSES: CostClass[] = ["free", "free-network", "spend", "free-gemini"];

describe("COST_META — taxonomy completeness", () => {
  it("has exactly the four cost classes, no more, no fewer", () => {
    expect(Object.keys(COST_META).sort()).toEqual([...ALL_CLASSES].sort());
  });

  it("every class has a non-empty label and tip", () => {
    for (const cls of ALL_CLASSES) {
      const meta = COST_META[cls];
      expect(meta, `missing meta for ${cls}`).toBeDefined();
      expect(typeof meta.label).toBe("string");
      expect(meta.label.length).toBeGreaterThan(0);
      expect(typeof meta.tip).toBe("string");
      expect(meta.tip.length).toBeGreaterThan(0);
    }
  });
});

describe("COST_META — the free/spend boundary", () => {
  it("labels the three free classes as Free-ish and spend as Uses tokens", () => {
    expect(COST_META.free.label).toBe("Free");
    expect(COST_META["free-network"].label).toBe("Free");
    expect(COST_META["free-gemini"].label).toBe("Free · Gemini");
    expect(COST_META.spend.label).toBe("Uses tokens");
  });

  it("only the spend class label mentions tokens being used", () => {
    // The whole point of the taxonomy: exactly one class is the token-spender.
    const tokenSpenders = ALL_CLASSES.filter((c) =>
      /uses tokens/i.test(COST_META[c].label),
    );
    expect(tokenSpenders).toEqual(["spend"]);
  });

  it("the free tips promise no tokens; the spend tip frames it as the ONLY spender", () => {
    expect(COST_META.free.tip).toMatch(/no tokens/i);
    expect(COST_META["free-network"].tip).toMatch(/no\s+tokens/i);
    expect(COST_META["free-gemini"].tip).toMatch(/no token cost/i);
    expect(COST_META.spend.tip).toMatch(/only thing that spends tokens/i);
  });

  it("the free-network tip keeps the local-first / nothing-sent framing", () => {
    const tip = COST_META["free-network"].tip;
    expect(tip).toMatch(/nothing sent/i);
    expect(tip).toMatch(/writes nothing until you choose/i);
  });

  it("the free-gemini tip credits Google's free tier", () => {
    expect(COST_META["free-gemini"].tip).toMatch(/gemini/i);
    expect(COST_META["free-gemini"].tip).toMatch(/free/i);
  });
});

describe("COST_META — lookup robustness", () => {
  it("indexing by every CostClass returns a stable {label, tip} object", () => {
    for (const cls of ALL_CLASSES) {
      const meta = COST_META[cls];
      expect(Object.keys(meta).sort()).toEqual(["label", "tip"]);
    }
  });

  it("indexing by an unknown key yields undefined (no silent default)", () => {
    // Defensive: callers must guard against an unmapped class.
    expect((COST_META as Record<string, unknown>)["nope"]).toBeUndefined();
  });
});
