import { describe, it, expect } from "vitest";
import {
  CANONICAL_STATES,
  canonStatus,
  statusDot,
  scoreNum,
  scoreTone,
  legitimacyTone,
  parseReport,
} from "./format";

describe("CANONICAL_STATES", () => {
  it("exposes the canonical state list in dashboard order", () => {
    expect(CANONICAL_STATES).toEqual([
      "Evaluated",
      "Applied",
      "Responded",
      "Assessment",
      "Interview",
      "Offer",
      "Hired",
      "Rejected",
      "Discarded",
      "SKIP",
    ]);
  });
});

describe("canonStatus", () => {
  it("maps empty / dash sentinels to DISCARDED", () => {
    expect(canonStatus("")).toBe("DISCARDED");
    expect(canonStatus("   ")).toBe("DISCARDED");
    expect(canonStatus("—")).toBe("DISCARDED"); // em-dash
    expect(canonStatus("-")).toBe("DISCARDED"); // hyphen
  });

  it("translates Spanish + legacy aliases to canonical English (case/space tolerant)", () => {
    expect(canonStatus("evaluada")).toBe("EVALUATED");
    expect(canonStatus("EVALUADO")).toBe("EVALUATED");
    expect(canonStatus("  Hold ")).toBe("EVALUATED");
    expect(canonStatus("aplicada")).toBe("APPLIED");
    expect(canonStatus("sent")).toBe("APPLIED");
    expect(canonStatus("respondida")).toBe("RESPONDED");
    expect(canonStatus("entrevista")).toBe("INTERVIEW");
    expect(canonStatus("oferta")).toBe("OFFER");
    expect(canonStatus("rechazada")).toBe("REJECTED");
    expect(canonStatus("descartada")).toBe("DISCARDED");
    expect(canonStatus("repost")).toBe("DISCARDED");
    expect(canonStatus("monitor")).toBe("SKIP");
    expect(canonStatus("no aplicar")).toBe("SKIP");
    expect(canonStatus("no_aplicar")).toBe("SKIP");
  });

  it("uppercases unknown statuses as a fallback", () => {
    expect(canonStatus("applied")).toBe("APPLIED");
    expect(canonStatus("something_weird")).toBe("SOMETHING_WEIRD");
    expect(canonStatus("MixedCase")).toBe("MIXEDCASE");
  });
});

describe("statusDot", () => {
  it("uses emerald for interview / offer", () => {
    expect(statusDot("entrevista")).toBe("bg-emerald-400");
    expect(statusDot("oferta")).toBe("bg-emerald-400");
    expect(statusDot("INTERVIEW")).toBe("bg-emerald-400");
    expect(statusDot("offer")).toBe("bg-emerald-400");
  });

  it("uses sky for applied / responded", () => {
    expect(statusDot("aplicada")).toBe("bg-sky-400");
    expect(statusDot("respondida")).toBe("bg-sky-400");
    expect(statusDot("APPLIED")).toBe("bg-sky-400");
  });

  it("uses red for rejected / skip", () => {
    expect(statusDot("rechazada")).toBe("bg-red-400");
    expect(statusDot("monitor")).toBe("bg-red-400"); // -> SKIP
    expect(statusDot("REJECTED")).toBe("bg-red-400");
  });

  it("uses zinc-600 for discarded (including empty sentinel)", () => {
    expect(statusDot("descartada")).toBe("bg-zinc-600");
    expect(statusDot("")).toBe("bg-zinc-600"); // empty -> DISCARDED
    expect(statusDot("—")).toBe("bg-zinc-600");
  });

  it("falls back to neutral zinc-500 for evaluated / unknown", () => {
    expect(statusDot("evaluada")).toBe("bg-zinc-500");
    expect(statusDot("totally-unknown-state")).toBe("bg-zinc-500");
  });
});

describe("scoreNum", () => {
  it("extracts the first number from a fraction string", () => {
    expect(scoreNum("4.1/5")).toBe(4.1);
    expect(scoreNum("3.0")).toBe(3.0);
  });

  it("extracts integers and embedded numbers", () => {
    expect(scoreNum("5")).toBe(5);
    expect(scoreNum("score: 4 out of 5")).toBe(4);
    expect(scoreNum("B+ (3.7)")).toBe(3.7);
  });

  it("returns NaN when no digit is present", () => {
    expect(scoreNum("B+")).toBeNaN();
    expect(scoreNum("")).toBeNaN();
    expect(scoreNum("N/A")).toBeNaN();
  });
});

describe("scoreTone", () => {
  it("maps numeric scores by the Go TUI thresholds", () => {
    expect(scoreTone("4.5")).toBe("good"); // >= 4.2
    expect(scoreTone("4.2")).toBe("good"); // boundary
    expect(scoreTone("4.0")).toBe("warn"); // >= 3.8
    expect(scoreTone("3.8")).toBe("warn"); // boundary
    expect(scoreTone("3.5")).toBe("muted"); // >= 3.0
    expect(scoreTone("3.0")).toBe("muted"); // boundary
    expect(scoreTone("2.9")).toBe("bad"); // < 3.0
    expect(scoreTone("0")).toBe("bad");
  });

  it("respects the numeric reading even with a trailing denominator", () => {
    expect(scoreTone("4.3/5")).toBe("good");
    expect(scoreTone("2.0/5")).toBe("bad");
  });

  it("falls back to letter grades when there is no number", () => {
    expect(scoreTone("A")).toBe("good");
    expect(scoreTone("a-")).toBe("good");
    expect(scoreTone("B+")).toBe("warn");
    expect(scoreTone("C")).toBe("muted");
    expect(scoreTone("D")).toBe("bad");
    expect(scoreTone("E")).toBe("bad");
    expect(scoreTone("F")).toBe("bad");
  });

  it("defaults to muted for unrecognized non-numeric input", () => {
    expect(scoreTone("")).toBe("muted");
    expect(scoreTone("Z")).toBe("muted");
    expect(scoreTone("   ")).toBe("muted");
  });
});

describe("legitimacyTone", () => {
  it("maps high-confidence / legit phrasing (EN + ES) to good", () => {
    expect(legitimacyTone("High confidence")).toBe("good");
    expect(legitimacyTone("Alta confianza")).toBe("good");
    expect(legitimacyTone("Looks legit")).toBe("good");
  });

  it("maps caution phrasing (EN + ES) to warn", () => {
    expect(legitimacyTone("Proceed with caution")).toBe("warn");
    expect(legitimacyTone("Precaución")).toBe("warn");
    expect(legitimacyTone("caut")).toBe("warn");
  });

  it("maps suspicious / scam / fake phrasing (EN + ES) to bad", () => {
    expect(legitimacyTone("Suspicious posting")).toBe("bad");
    expect(legitimacyTone("Sospechoso")).toBe("bad");
    expect(legitimacyTone("Likely a scam")).toBe("bad");
    expect(legitimacyTone("Fake listing")).toBe("bad");
  });

  it("defaults to muted for unknown / empty legitimacy", () => {
    expect(legitimacyTone("")).toBe("muted");
    expect(legitimacyTone("unknown")).toBe("muted");
  });

  it("prioritizes good over later branches when both keywords appear", () => {
    // 'high' (good) is checked before 'suspic' (bad)
    expect(legitimacyTone("high but slightly suspicious")).toBe("good");
  });
});

describe("parseReport — header parsing", () => {
  it("extracts title (stripping the Evaluation: prefix) and bold fields, splitting on ---", () => {
    const md = [
      "# Evaluation: Senior Android Engineer",
      "**Date:** 2026-06-30",
      "**URL:** https://example.com/job",
      "**Score:** 4.1/5",
      "**Legitimacy:** High confidence",
      "---",
      "## Summary",
      "Great role.",
    ].join("\n");

    const meta = parseReport(md);
    expect(meta.title).toBe("Senior Android Engineer");
    expect(meta.legitimacy).toBe("High confidence");
    expect(meta.fields).toEqual([
      { label: "Date", value: "2026-06-30" },
      { label: "URL", value: "https://example.com/job" },
      { label: "Score", value: "4.1/5" },
      { label: "Legitimacy", value: "High confidence" },
    ]);
    // The --- divider line is consumed; body starts after it.
    expect(meta.body).toBe("## Summary\nGreat role.");
  });

  it("cuts the header at the first ## section when there is no --- divider", () => {
    const md = [
      "# Job Title",
      "**Date:** 2026-01-01",
      "## Details",
      "Body text here.",
    ].join("\n");

    const meta = parseReport(md);
    expect(meta.title).toBe("Job Title");
    expect(meta.fields).toEqual([{ label: "Date", value: "2026-01-01" }]);
    // No --- so the ## line is NOT consumed; it is part of the body.
    expect(meta.body).toBe("## Details\nBody text here.");
  });

  it("maps Spanish field keys (fecha/arquetipo/legitimidad) to canonical labels", () => {
    const md = [
      "# Mi Trabajo",
      "**fecha:** 2025-12-01",
      "**arquetipo:** Scaleup",
      "**legitimidad:** Alta confianza",
      "---",
      "cuerpo",
    ].join("\n");

    const meta = parseReport(md);
    expect(meta.fields).toEqual([
      { label: "Date", value: "2025-12-01" },
      { label: "Archetype", value: "Scaleup" },
      { label: "Legitimacy", value: "Alta confianza" },
    ]);
    expect(meta.legitimacy).toBe("Alta confianza");
    expect(meta.body).toBe("cuerpo");
  });

  it("ignores unknown bold keys and empty-valued known keys", () => {
    const md = [
      "# Title",
      "**Unknown:** ignored",
      "**Score:**", // empty value -> dropped
      "**PDF:** report.pdf",
      "---",
      "body",
    ].join("\n");

    const meta = parseReport(md);
    expect(meta.fields).toEqual([{ label: "PDF", value: "report.pdf" }]);
    expect(meta.legitimacy).toBeNull();
  });
});

describe("parseReport — fallback / malformed input", () => {
  it("returns the whole document as body when there is no header field and no body", () => {
    // No title, no fields, no divider, no ## section. body slice is empty so it
    // falls back to the raw md.
    const md = "just some plain text with no structure";
    const meta = parseReport(md);
    expect(meta.title).toBeNull();
    expect(meta.fields).toEqual([]);
    expect(meta.legitimacy).toBeNull();
    expect(meta.body).toBe(md);
  });

  it("handles an empty string by returning empty meta and the empty body fallback", () => {
    const meta = parseReport("");
    expect(meta.title).toBeNull();
    expect(meta.fields).toEqual([]);
    expect(meta.legitimacy).toBeNull();
    // body is "" (falsy) so it falls back to md, which is also "".
    expect(meta.body).toBe("");
  });

  it("caps the header scan at 10 lines when no divider/section exists", () => {
    // 12 content lines, no --- and no ## anywhere. Header = first 10 lines,
    // body = remaining lines (from index 10 onward).
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i}`);
    const md = lines.join("\n");
    const meta = parseReport(md);
    expect(meta.title).toBeNull();
    expect(meta.fields).toEqual([]);
    expect(meta.body).toBe("line 10\nline 11");
  });

  it("does not treat a leading-line divider (index 0) as the cut", () => {
    // The findIndex requires i > 0, so a --- on line 0 is not a divider.
    const md = ["---", "# Title", "**Date:** 2026-06-30", "## Body", "text"].join("\n");
    const meta = parseReport(md);
    // The first qualifying cut is the "## Body" line at index 3.
    expect(meta.title).toBe("Title");
    expect(meta.fields).toEqual([{ label: "Date", value: "2026-06-30" }]);
    expect(meta.body).toBe("## Body\ntext");
  });

  it("tolerates a title-only report (no fields, body present)", () => {
    const md = ["# Lonely Title", "Some body without bold fields"].join("\n");
    const meta = parseReport(md);
    expect(meta.title).toBe("Lonely Title");
    expect(meta.fields).toEqual([]);
    expect(meta.legitimacy).toBeNull();
    // No divider/##: header capped at 10 lines (only 2 here), body slice empty
    // -> falls back to full md.
    expect(meta.body).toBe(md);
  });

  it("trims surrounding whitespace on field values", () => {
    const md = ["# T", "**Score:**    4.5/5   ", "---", "b"].join("\n");
    const meta = parseReport(md);
    expect(meta.fields).toEqual([{ label: "Score", value: "4.5/5" }]);
  });

  it("strips the English 'Evaluation:' title prefix", () => {
    expect(parseReport("# Evaluation: Role B\n---\nx").title).toBe("Role B");
  });

  it("strips the Spanish 'Evaluación:' / 'Evaluacion:' title prefix (regression)", () => {
    // Regex /^Evalua(?:ti|ci)[oó]n:?/i now matches the Spanish '-ción' spelling
    // as well as English, so neither leaks into the title.
    expect(parseReport("# Evaluación: Role A\n---\nx").title).toBe("Role A");
    expect(parseReport("# Evaluacion: Role C\n---\nx").title).toBe("Role C");
  });
});
