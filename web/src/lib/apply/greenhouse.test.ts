import { describe, it, expect, vi, afterEach } from "vitest";
import { parseGreenhouse, fetchGreenhouseSchema } from "./greenhouse";

// ─────────────────────────────────────────────────────────────────────────────
// parseGreenhouse — PURE URL parsing (token + jobId from a Greenhouse board URL).
// ─────────────────────────────────────────────────────────────────────────────
describe("parseGreenhouse", () => {
  it("parses the canonical job-boards path form .../{token}/jobs/{id}", () => {
    expect(parseGreenhouse("https://job-boards.greenhouse.io/acme/jobs/123456")).toEqual({
      token: "acme",
      jobId: "123456",
    });
  });

  it("parses the legacy boards.greenhouse.io host", () => {
    expect(parseGreenhouse("https://boards.greenhouse.io/globex/jobs/987")).toEqual({
      token: "globex",
      jobId: "987",
    });
  });

  it("parses the embed form ?for={token}&token={id}", () => {
    expect(parseGreenhouse("https://boards.greenhouse.io/embed/job_app?for=initech&token=42")).toEqual({
      token: "initech",
      jobId: "42",
    });
  });

  it("prefers the path form over query params when both could match", () => {
    // The /jobs/<id> path match is tried first.
    expect(parseGreenhouse("https://job-boards.greenhouse.io/acme/jobs/555?for=other&token=999")).toEqual({
      token: "acme",
      jobId: "555",
    });
  });

  it("matches the hostname suffix anchor (foo.greenhouse.io)", () => {
    expect(parseGreenhouse("https://anything.greenhouse.io/widget/jobs/7")).toEqual({
      token: "widget",
      jobId: "7",
    });
  });

  it("returns null for a non-greenhouse host", () => {
    expect(parseGreenhouse("https://boards.lever.co/acme/jobs/123")).toBeNull();
    expect(parseGreenhouse("https://jobs.ashbyhq.com/acme/abc")).toBeNull();
  });

  it("rejects a host that merely contains 'greenhouse.io' as a non-suffix (anti-spoof)", () => {
    // The regex is anchored with $, so greenhouse.io.evil.com is not greenhouse.
    expect(parseGreenhouse("https://greenhouse.io.evil.com/acme/jobs/123")).toBeNull();
  });

  it("returns null for a greenhouse URL with neither a /jobs/ path nor for+token params", () => {
    expect(parseGreenhouse("https://boards.greenhouse.io/acme")).toBeNull();
    expect(parseGreenhouse("https://boards.greenhouse.io/embed/job_app?for=acme")).toBeNull();
  });

  it("requires a numeric job id in the path form", () => {
    // \d+ — a non-numeric segment falls through to the query check, then null.
    expect(parseGreenhouse("https://boards.greenhouse.io/acme/jobs/not-a-number")).toBeNull();
  });

  it("returns null for a malformed / unparseable URL (caught)", () => {
    expect(parseGreenhouse("not a url")).toBeNull();
    expect(parseGreenhouse("")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchGreenhouseSchema — async; fetch is stubbed so the test is hermetic. We
// assert: the type mapping table, label cleanup, dual keying (name + label:),
// option extraction, and the null-on-failure paths.
// ─────────────────────────────────────────────────────────────────────────────
const okJson = (body: unknown) =>
  ({ ok: true, json: async () => body }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchGreenhouseSchema", () => {
  it("builds a map keyed by both field name and label:<lowercased>", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okJson({
          questions: [
            {
              label: "Why this role? *",
              required: true,
              fields: [{ name: "question_123", type: "textarea" }],
            },
          ],
        }),
      ),
    );
    const map = await fetchGreenhouseSchema("acme", "1");
    expect(map).not.toBeNull();
    // keyed by the DOM-id name…
    expect(map!.get("question_123")).toEqual({
      label: "Why this role?", // trailing " *" stripped
      type: "textarea",
      required: true,
      options: [],
    });
    // …and by the lowercased label
    expect(map!.get("label:why this role?")).toBe(map!.get("question_123"));
  });

  it("maps every known Greenhouse field type to the canonical UI type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okJson({
          questions: [
            { label: "T", fields: [{ name: "t", type: "input_text" }] },
            { label: "Area", fields: [{ name: "a", type: "textarea" }] },
            { label: "File", fields: [{ name: "f", type: "input_file" }] },
            { label: "Single", fields: [{ name: "s1", type: "single_select" }] },
            { label: "MultiSingle", fields: [{ name: "ms1", type: "multi_value_single_select" }] },
            { label: "MultiMulti", fields: [{ name: "mm", type: "multi_value_multi_select" }] },
            { label: "Multi", fields: [{ name: "m", type: "multi_select" }] },
            { label: "Bool", fields: [{ name: "b", type: "boolean" }] },
            { label: "Weird", fields: [{ name: "w", type: "totally_unknown" }] },
          ],
        }),
      ),
    );
    const map = await fetchGreenhouseSchema("acme", "1");
    expect(map!.get("t")!.type).toBe("text");
    expect(map!.get("a")!.type).toBe("textarea");
    expect(map!.get("f")!.type).toBe("file");
    expect(map!.get("s1")!.type).toBe("select");
    expect(map!.get("ms1")!.type).toBe("select");
    expect(map!.get("mm")!.type).toBe("select");
    expect(map!.get("m")!.type).toBe("select");
    expect(map!.get("b")!.type).toBe("select");
    expect(map!.get("w")!.type).toBe("text"); // unknown type falls back to text
  });

  it("extracts and trims option labels, dropping blanks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okJson({
          questions: [
            {
              label: "Region",
              fields: [
                {
                  name: "region",
                  type: "single_select",
                  values: [{ label: " US " }, { label: "EU" }, { label: "" }, {}],
                },
              ],
            },
          ],
        }),
      ),
    );
    const map = await fetchGreenhouseSchema("acme", "1");
    expect(map!.get("region")!.options).toEqual(["US", "EU"]);
  });

  it("skips fields with no name and does not add a label: key for an empty label", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okJson({
          questions: [
            {
              label: "", // empty -> no label: alias
              fields: [{ name: "kept", type: "input_text" }, { type: "input_text" /* no name */ }],
            },
          ],
        }),
      ),
    );
    const map = await fetchGreenhouseSchema("acme", "1");
    expect(map!.has("kept")).toBe(true);
    expect(map!.has("label:")).toBe(false);
    // only the named field made it in
    expect(map!.size).toBe(1);
  });

  it("URL-encodes token + jobId into the boards-api request", async () => {
    const fetchMock = vi.fn(async () =>
      okJson({ questions: [{ label: "Q", fields: [{ name: "q", type: "input_text" }] }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await fetchGreenhouseSchema("a c/me", "12 3");
    const calledUrl = (fetchMock.mock.calls[0] as unknown[])[0] as string;
    expect(calledUrl).toBe(
      "https://boards-api.greenhouse.io/v1/boards/a%20c%2Fme/jobs/12%203?questions=true",
    );
  });

  it("returns null when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response));
    expect(await fetchGreenhouseSchema("acme", "1")).toBeNull();
  });

  it("returns null when fetch rejects (network / abort)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    expect(await fetchGreenhouseSchema("acme", "1")).toBeNull();
  });

  it("returns null when the schema yields zero usable fields (map.size === 0)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ questions: [] })));
    expect(await fetchGreenhouseSchema("acme", "1")).toBeNull();
  });

  it("treats a missing questions array as empty -> null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson({})));
    expect(await fetchGreenhouseSchema("acme", "1")).toBeNull();
  });
});
