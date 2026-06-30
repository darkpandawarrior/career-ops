import { describe, it, expect } from "vitest";
import { isRememberable } from "./remember";
import type { ApplyField } from "./extract";

// isRememberable is a pure heuristic: given a form field + the user's typed value,
// decide whether to offer "remember this for future applications". We test the
// gates documented in the source: length bounds, type exclusions, and the
// identity / consent / sensitive label regexes.

// Minimal ApplyField factory — only the fields the heuristic reads matter.
const field = (over: Partial<ApplyField> = {}): ApplyField => ({
  id: "co0",
  type: "text",
  label: "",
  required: false,
  ...over,
});

describe("isRememberable — value length bounds", () => {
  it("rejects values shorter than 4 chars (after trim)", () => {
    expect(isRememberable(field(), "abc")).toBe(false);
    expect(isRememberable(field(), "  x ")).toBe(false); // trims to 1
  });

  it("accepts a value at exactly 4 chars", () => {
    expect(isRememberable(field({ label: "Favourite talk" }), "abcd")).toBe(true);
  });

  it("accepts a value at exactly 400 chars (upper boundary inclusive)", () => {
    expect(isRememberable(field({ label: "Bio" }), "x".repeat(400))).toBe(true);
  });

  it("rejects a value longer than 400 chars (a long essay, not reusable verbatim)", () => {
    expect(isRememberable(field({ label: "Bio" }), "x".repeat(401))).toBe(false);
  });

  it("rejects undefined / empty value", () => {
    expect(isRememberable(field(), undefined)).toBe(false);
    expect(isRememberable(field(), "")).toBe(false);
  });
});

describe("isRememberable — field type exclusions", () => {
  it("rejects checkbox fields regardless of value", () => {
    expect(isRememberable(field({ type: "checkbox", label: "Speaking link" }), "https://talk.example")).toBe(false);
  });

  it("rejects file fields", () => {
    expect(isRememberable(field({ type: "file", label: "Portfolio" }), "resume.pdf")).toBe(false);
  });

  it("allows textarea / select / url / text types", () => {
    expect(isRememberable(field({ type: "textarea", label: "Where have you spoken?" }), "DroidconNYC 2025")).toBe(true);
    expect(isRememberable(field({ type: "url", label: "Conference talk" }), "https://youtu.be/abc")).toBe(true);
    expect(isRememberable(field({ type: "select", label: "Preferred stack" }), "Kotlin")).toBe(true);
  });
});

describe("isRememberable — identity / contact labels are not reusable facts", () => {
  it.each([
    "First name",
    "Last name",
    "Full name",
    "Preferred name",
    "Name",
    "Email",
    "E-mail",
    "Phone",
    "Mobile",
    "Tel",
    "Location",
    "City",
    "Country",
    "Address",
    "LinkedIn URL",
    "GitHub profile",
    "GitLab handle",
  ])("rejects identity label %s", (label) => {
    expect(isRememberable(field({ label }), "some value here")).toBe(false);
  });
});

describe("isRememberable — consent / agreement labels", () => {
  it.each([
    "Privacy policy",
    "Community guidelines",
    "I consent to processing",
    "Terms and conditions",
    "I acknowledge the above",
    "I agree to the policy",
    "I have read this",
    "I understand the requirements",
  ])("rejects consent label %s", (label) => {
    expect(isRememberable(field({ label }), "I agree to all of this")).toBe(false);
  });
});

describe("isRememberable — sensitive demographic / EEO labels", () => {
  it.each([
    "Gender",
    "Veteran status",
    "Disability status",
    "Ethnicity",
    "Race",
    "Hispanic or Latino",
    "Latino background",
    "Sexual orientation",
    "Preferred pronoun",
    "Are you transgender?",
  ])("never offers to remember sensitive label %s", (label) => {
    expect(isRememberable(field({ label }), "prefer not to say")).toBe(false);
  });
});

describe("isRememberable — the gold (open-ended reusable facts)", () => {
  it("remembers a 'where have you spoken' style answer", () => {
    expect(isRememberable(field({ label: "Where have you given a talk?" }), "Droidcon, KotlinConf")).toBe(true);
  });

  it("remembers a niche profile / talk URL", () => {
    expect(isRememberable(field({ label: "Link to a recent presentation" }), "https://youtu.be/xyz")).toBe(true);
  });

  it("matches identity regex case-insensitively (regex has /i flag)", () => {
    expect(isRememberable(field({ label: "EMAIL ADDRESS" }), "alex@example.com")).toBe(false);
  });

  it("treats a label with no sensitive/identity/consent keyword as rememberable", () => {
    expect(isRememberable(field({ label: "What is your favourite open-source project?" }), "AndroidX")).toBe(true);
  });

  it("rememberable when the field has no label at all (empty label clears the regexes)", () => {
    // Empty label string -> none of the regexes fire, so only length/type gates apply.
    expect(isRememberable(field({ label: "" }), "a reusable fact")).toBe(true);
  });
});
