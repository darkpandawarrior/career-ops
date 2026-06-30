import { describe, it, expect } from "vitest";
import { cvReadiness, parseCvStream } from "./quality";

// Helper: build a body of N words (single-word tokens joined by spaces).
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

describe("cvReadiness — word counting", () => {
  it("counts zero words for empty / whitespace-only input", () => {
    expect(cvReadiness("").words).toBe(0);
    expect(cvReadiness("   \n\t  ").words).toBe(0);
    // null-ish coercion via (md || "")
    expect(cvReadiness(undefined as unknown as string).words).toBe(0);
  });

  it("splits on arbitrary whitespace runs", () => {
    expect(cvReadiness("one two three").words).toBe(3);
    expect(cvReadiness("one   two\nthree\t\tfour").words).toBe(4);
    // leading/trailing whitespace is trimmed first, so no empty tokens
    expect(cvReadiness("  hello world  ").words).toBe(2);
  });

  it("counts a single word as 1", () => {
    expect(cvReadiness("solo").words).toBe(1);
  });
});

describe("cvReadiness — hasExperience (EN + ES)", () => {
  it("detects English experience/work/employment headings", () => {
    expect(cvReadiness("## Experience\nstuff").hasExperience).toBe(true);
    expect(cvReadiness("# Work\nstuff").hasExperience).toBe(true);
    expect(cvReadiness("### Employment\nstuff").hasExperience).toBe(true);
  });

  it("detects Spanish empleo/experiencia headings", () => {
    expect(cvReadiness("## Experiencia\ncosas").hasExperience).toBe(true);
    expect(cvReadiness("# Empleo\ncosas").hasExperience).toBe(true);
  });

  it("detects a heading on the very first line (^ anchor)", () => {
    expect(cvReadiness("# Experience").hasExperience).toBe(true);
  });

  it("is case-insensitive for headings", () => {
    expect(cvReadiness("## EXPERIENCE\nx").hasExperience).toBe(true);
    expect(cvReadiness("## experiencia\nx").hasExperience).toBe(true);
  });

  it("detects a year-range pattern as experience even without a heading", () => {
    expect(cvReadiness("Acme Corp 2019 - 2022").hasExperience).toBe(true);
    expect(cvReadiness("Role 2020–present").hasExperience).toBe(true); // en-dash + present
    expect(cvReadiness("Empresa 2018—actualidad").hasExperience).toBe(true); // em-dash + ES
    expect(cvReadiness("Job 2021 - now").hasExperience).toBe(true);
  });

  it("requires 4-digit 20xx years for the range pattern", () => {
    // 19xx is not matched by the (20\d\d) anchor
    expect(cvReadiness("1998 - 2002").hasExperience).toBe(false);
  });

  it("is false when there is no heading and no year range", () => {
    expect(cvReadiness("Just a paragraph about me and my hobbies.").hasExperience).toBe(false);
  });

  it("does not match 'experience' as inline prose (heading must follow #)", () => {
    // No leading # before 'experience', and no year range -> false
    expect(cvReadiness("I have lots of experience in things").hasExperience).toBe(false);
  });
});

describe("cvReadiness — hasSkills (EN + ES)", () => {
  it("detects English skills/technologies/competenc headings", () => {
    expect(cvReadiness("## Skills\nx").hasSkills).toBe(true);
    expect(cvReadiness("# Technologies\nx").hasSkills).toBe(true);
    expect(cvReadiness("### Competencies\nx").hasSkills).toBe(true); // 'competenc' stem
  });

  it("detects Spanish habilidad heading (stem match)", () => {
    expect(cvReadiness("## Habilidades\nx").hasSkills).toBe(true);
  });

  it("is case-insensitive and anchors on a fresh line", () => {
    expect(cvReadiness("intro\n## SKILLS\nx").hasSkills).toBe(true);
    expect(cvReadiness("# skills").hasSkills).toBe(true);
  });

  it("is false without a recognized skills heading", () => {
    expect(cvReadiness("My skills are great").hasSkills).toBe(false);
    expect(cvReadiness("## Education\nx").hasSkills).toBe(false);
  });
});

describe("cvReadiness — scoreable threshold logic", () => {
  it("is NOT scoreable below 80 words even with experience + skills", () => {
    const md = "## Experience\n## Skills\n" + words(40);
    const r = cvReadiness(md);
    expect(r.words).toBeLessThan(80);
    expect(r.scoreable).toBe(false);
  });

  it("is scoreable at >=80 words when experience heading present", () => {
    const md = "## Experience\n" + words(85);
    const r = cvReadiness(md);
    expect(r.words).toBeGreaterThanOrEqual(80);
    expect(r.hasExperience).toBe(true);
    expect(r.scoreable).toBe(true);
  });

  it("is scoreable at >=80 words when skills heading present", () => {
    const md = "## Skills\n" + words(85);
    const r = cvReadiness(md);
    expect(r.hasSkills).toBe(true);
    expect(r.scoreable).toBe(true);
  });

  it("is scoreable at the exact 80-word boundary with a heading", () => {
    // "## Experience" contributes 2 tokens, so add 78 words to hit exactly 80
    const md = "## Experience " + words(78);
    const r = cvReadiness(md);
    expect(r.words).toBe(80);
    expect(r.scoreable).toBe(true);
  });

  it("is NOT scoreable at 80 words with neither heading nor 200+ words", () => {
    // plain prose, no heading, no year range, between 80 and 199 words
    const md = words(120);
    const r = cvReadiness(md);
    expect(r.words).toBe(120);
    expect(r.hasExperience).toBe(false);
    expect(r.hasSkills).toBe(false);
    expect(r.scoreable).toBe(false);
  });

  it("becomes scoreable at >=200 words even without any heading (word-count fallback)", () => {
    const md = words(200);
    const r = cvReadiness(md);
    expect(r.words).toBe(200);
    expect(r.hasExperience).toBe(false);
    expect(r.hasSkills).toBe(false);
    expect(r.scoreable).toBe(true); // words >= 200 satisfies the OR clause
  });

  it("just below the 200-word fallback with no heading is not scoreable", () => {
    const md = words(199);
    const r = cvReadiness(md);
    expect(r.words).toBe(199);
    expect(r.scoreable).toBe(false);
  });
});

describe("cvReadiness — hint branches", () => {
  it("gives the 'very short' hint when under 40 words and not scoreable", () => {
    const r = cvReadiness(words(10));
    expect(r.scoreable).toBe(false);
    expect(r.hint).toBe("That's very short — add your experience for real matches (you can save anyway).");
  });

  it("gives the 'very short' hint at the empty boundary (0 words)", () => {
    const r = cvReadiness("");
    expect(r.words).toBe(0);
    expect(r.hint).toBe("That's very short — add your experience for real matches (you can save anyway).");
  });

  it("gives the 'looks thin' hint at exactly 40 words (boundary: <40 is false)", () => {
    const r = cvReadiness(words(40));
    expect(r.words).toBe(40);
    expect(r.scoreable).toBe(false);
    expect(r.hint).toBe("Looks thin — add a role or two for better matches (you can save anyway).");
  });

  it("gives the 'looks thin' hint between 40 and 79 words", () => {
    const r = cvReadiness(words(60));
    expect(r.scoreable).toBe(false);
    expect(r.hint).toBe("Looks thin — add a role or two for better matches (you can save anyway).");
  });

  it("omits the hint entirely when scoreable", () => {
    const r = cvReadiness("## Experience\n" + words(85));
    expect(r.scoreable).toBe(true);
    expect(r.hint).toBeUndefined();
  });
});

describe("parseCvStream — error path (<<cv:error>>)", () => {
  it("extracts the reason from a JSON error envelope and preserves pre-error trace", () => {
    const buf = 'thinking about the file...\n<<cv:error>> {"reason":"password protected"}';
    const r = parseCvStream(buf);
    expect(r.error).toBe("password protected");
    expect(r.markdown).toBe("");
    expect(r.seed).toBeNull();
    expect(r.trace).toBe("thinking about the file...");
  });

  it("falls back to 'unreadable' when the error JSON has no reason field", () => {
    const buf = '<<cv:error>> {"foo":"bar"}';
    const r = parseCvStream(buf);
    expect(r.error).toBe("unreadable");
  });

  it("falls back to 'unreadable' when the matched error JSON is malformed (parse error path)", () => {
    // The regex /\{[^}]*\}/ requires a closing '}'. Here it matches the braces
    // but the inner content is not valid JSON (unquoted key), so JSON.parse
    // throws inside the try and the 'unreadable' default is kept.
    const buf = "<<cv:error>> {reason: x}";
    const r = parseCvStream(buf);
    expect(r.error).toBe("unreadable");
  });

  it("does NOT enter the error path when the error envelope has no closing brace (regex miss)", () => {
    // Without a '}' the /\{[^}]*\}/ group cannot match, so the whole error
    // branch is skipped and parsing continues normally -> error stays null.
    const buf = '<<cv:error>> {"reason":"x';
    const r = parseCvStream(buf);
    expect(r.error).toBeNull();
  });

  it("error path takes precedence over any markdown markers present", () => {
    const buf = '<<cv:start>>some md<<cv:end>>\n<<cv:error>> {"reason":"too big"}';
    const r = parseCvStream(buf);
    expect(r.error).toBe("too big");
    expect(r.markdown).toBe(""); // error path returns before markdown extraction
  });

  it("trims the trace and stops it at the error marker", () => {
    const buf = '  leading trace text   \n<<cv:error>> {"reason":"r"}';
    const r = parseCvStream(buf);
    expect(r.trace).toBe("leading trace text");
  });
});

describe("parseCvStream — markdown extraction (start/end)", () => {
  it("extracts markdown between start and end markers", () => {
    const buf = "pre-trace\n<<cv:start>>\n# My CV\nbody text\n<<cv:end>>trailing";
    const r = parseCvStream(buf);
    expect(r.markdown).toBe("# My CV\nbody text");
    expect(r.error).toBeNull();
    expect(r.trace).toBe("pre-trace");
  });

  it("strips a single leading blank line and trailing whitespace from markdown", () => {
    const buf = "<<cv:start>>\n\n# Heading\nbody\n\n   <<cv:end>>";
    const r = parseCvStream(buf);
    // /^\s*\n/ removes the first blank line; trimEnd removes trailing whitespace
    expect(r.markdown).toBe("# Heading\nbody");
  });

  it("treats a still-streaming buffer (start, no end) as partial markdown", () => {
    const buf = "trace\n<<cv:start>>\n# Partial CV\nstill writin";
    const r = parseCvStream(buf);
    expect(r.markdown).toBe("# Partial CV\nstill writin");
    expect(r.error).toBeNull();
    expect(r.trace).toBe("trace");
  });

  it("returns empty markdown and full-ish trace when start marker is absent", () => {
    const buf = "just a pre-start trace with no markers yet";
    const r = parseCvStream(buf);
    expect(r.markdown).toBe("");
    expect(r.seed).toBeNull();
    expect(r.error).toBeNull();
    expect(r.trace).toBe("just a pre-start trace with no markers yet");
  });

  it("handles an empty buffer", () => {
    const r = parseCvStream("");
    expect(r.markdown).toBe("");
    expect(r.seed).toBeNull();
    expect(r.error).toBeNull();
    expect(r.trace).toBe("");
  });

  it("strips a partial trailing cv-marker from the pre-start trace", () => {
    // No start marker, but a partial '<<cv:see' is dangling -> the
    // /<<cv:[a-z]+>>.*$/s cleanup only strips a *complete* marker; a partial
    // one without '>>' survives. Use a complete one to exercise the cleanup.
    const buf = "real trace<<cv:seed>>{\"title\":\"X\"} leftover";
    const r = parseCvStream(buf);
    // start === -1, so trace = whole buf with the complete marker (and rest) stripped
    expect(r.trace).toBe("real trace");
    expect(r.markdown).toBe("");
  });
});

describe("parseCvStream — seed extraction", () => {
  it("parses a well-formed seed with title, roles and location", () => {
    const buf =
      '<<cv:seed>> {"title":"Senior Android Engineer","roles":["Android","Lead"],"location":"Pune"}\n' +
      "<<cv:start>>\n# CV\nbody\n<<cv:end>>";
    const r = parseCvStream(buf);
    expect(r.seed).toEqual({
      title: "Senior Android Engineer",
      roles: ["Android", "Lead"],
      location: "Pune",
    });
    expect(r.markdown).toBe("# CV\nbody");
  });

  it("filters non-string roles and caps roles at 6", () => {
    const roles = ["a", 1, "b", null, "c", "d", "e", "f", "g", "h"];
    const buf = `<<cv:seed>> {"roles":${JSON.stringify(roles)}}\n<<cv:start>>\nx\n<<cv:end>>`;
    const r = parseCvStream(buf);
    // non-strings filtered (a,b,c,d,e,f,g,h) then sliced to first 6
    expect(r.seed?.roles).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("leaves optional seed fields undefined when absent or wrong-typed", () => {
    const buf = '<<cv:seed>> {"title":123,"location":true}\n<<cv:start>>\nx\n<<cv:end>>';
    const r = parseCvStream(buf);
    expect(r.seed).toEqual({ title: undefined, roles: undefined, location: undefined });
  });

  it("ignores a malformed seed JSON (seed stays null)", () => {
    const buf = '<<cv:seed>> {not valid json}\n<<cv:start>>\nx\n<<cv:end>>';
    const r = parseCvStream(buf);
    expect(r.seed).toBeNull();
    expect(r.markdown).toBe("x");
  });

  it("does NOT parse the seed until a start marker appears (early return on start === -1)", () => {
    // When start === -1 the function returns before the seed-extraction block,
    // so a seed emitted ahead of <<cv:start>> is not yet surfaced.
    const buf = '<<cv:seed>> {"title":"Dev"}';
    const r = parseCvStream(buf);
    expect(r.seed).toBeNull();
    expect(r.markdown).toBe("");
  });

  it("surfaces a seed emitted before the start marker once start arrives", () => {
    // The seed regex scans the whole buffer, so a seed that precedes
    // <<cv:start>> is picked up as soon as the start marker is present.
    const buf = '<<cv:seed>> {"title":"Dev"}\n<<cv:start>>\nmd\n<<cv:end>>';
    const r = parseCvStream(buf);
    expect(r.seed).toEqual({ title: "Dev", roles: undefined, location: undefined });
    expect(r.markdown).toBe("md");
  });

  it("parses a multi-line seed object (the [\\s\\S] match)", () => {
    const buf =
      '<<cv:seed>> {\n  "title": "Multi",\n  "roles": ["x"]\n}\n<<cv:start>>\nmd\n<<cv:end>>';
    const r = parseCvStream(buf);
    expect(r.seed).toEqual({ title: "Multi", roles: ["x"], location: undefined });
  });

  it("returns null seed when there is no seed marker", () => {
    const buf = "<<cv:start>>\nmd\n<<cv:end>>";
    const r = parseCvStream(buf);
    expect(r.seed).toBeNull();
  });
});
