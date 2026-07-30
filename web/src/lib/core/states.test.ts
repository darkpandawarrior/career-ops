import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * states.ts reads templates/states.yml (the single source of truth) under
 * careerOpsRoot(), with an internal module-level CACHE and an in-code FALLBACK if
 * the file is unreadable/malformed. We control careerOpsRoot() via a mock and a
 * throwaway engine root, and because the cache survives the first call we use
 * vi.resetModules() + dynamic import per scenario so each test starts cold.
 *
 * Nothing here touches the user's real career-ops tree.
 */

// A mutable root the mocked careerOpsRoot() returns. Each test writes (or omits)
// templates/states.yml under here, then re-imports states.ts fresh.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-states-"));
let currentRoot = ROOT;

vi.mock("@/lib/career-ops", () => ({ careerOpsRoot: () => currentRoot }));

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

// Fresh, un-cached copy of the module bound to whatever currentRoot points at.
async function freshStates() {
  vi.resetModules();
  return import("./states");
}

function writeStatesYml(root: string, body: string) {
  fs.mkdirSync(path.join(root, "templates"), { recursive: true });
  fs.writeFileSync(path.join(root, "templates", "states.yml"), body, "utf8");
}

// A minimal but realistic states.yml mirroring the real file's schema.
const GOOD_YML = `states:
  - id: evaluated
    label: Evaluated
    aliases: [evaluada]
    description: Offer evaluated with report, pending decision
    dashboard_group: evaluated
  - id: applied
    label: Applied
    aliases: [aplicado, enviada, aplicada, sent]
    description: Application submitted
    dashboard_group: applied
  - id: rejected
    label: Rejected
    aliases: [rechazado, rechazada]
    description: Rejected by company
    dashboard_group: rejected
`;

beforeEach(() => {
  currentRoot = ROOT;
});

describe("readCanonicalStates — file path (happy)", () => {
  it("parses states.yml into CanonicalState objects with mapped fields", async () => {
    const dir = fs.mkdtempSync(path.join(ROOT, "good-"));
    currentRoot = dir;
    writeStatesYml(dir, GOOD_YML);

    const { readCanonicalStates } = await freshStates();
    const states = readCanonicalStates();

    expect(states.map((s) => s.id)).toEqual(["evaluated", "applied", "rejected"]);
    const applied = states.find((s) => s.id === "applied")!;
    expect(applied.label).toBe("Applied");
    expect(applied.aliases).toEqual(["aplicado", "enviada", "aplicada", "sent"]);
    expect(applied.description).toBe("Application submitted");
    // dashboard_group -> group
    expect(applied.group).toBe("applied");
  });

  it("caches the first read (file changes after first call are ignored)", async () => {
    const dir = fs.mkdtempSync(path.join(ROOT, "cache-"));
    currentRoot = dir;
    writeStatesYml(dir, GOOD_YML);

    const { readCanonicalStates } = await freshStates();
    const first = readCanonicalStates();
    expect(first.map((s) => s.id)).toEqual(["evaluated", "applied", "rejected"]);

    // mutate the file underneath; cache must mean we still see the old list and
    // the SAME array reference is returned.
    writeStatesYml(dir, `states:\n  - id: only\n    label: Only\n`);
    const second = readCanonicalStates();
    expect(second).toBe(first);
    expect(second.map((s) => s.id)).toEqual(["evaluated", "applied", "rejected"]);
  });

  it("derives id from label when id is missing, and group from id when dashboard_group absent", async () => {
    const dir = fs.mkdtempSync(path.join(ROOT, "derive-"));
    currentRoot = dir;
    writeStatesYml(
      dir,
      `states:
  - label: Custom Stage
`,
    );
    const { readCanonicalStates } = await freshStates();
    const [s] = readCanonicalStates();
    expect(s.id).toBe("custom stage"); // label.toLowerCase()
    expect(s.label).toBe("Custom Stage");
    expect(s.aliases).toEqual([]);
    expect(s.description).toBe("");
    // no id and no dashboard_group -> group falls back to label.toLowerCase()
    expect(s.group).toBe("custom stage");
  });

  it("skips malformed entries (missing/non-string label) and filters non-string aliases", async () => {
    const dir = fs.mkdtempSync(path.join(ROOT, "skip-"));
    currentRoot = dir;
    writeStatesYml(
      dir,
      `states:
  - id: noLabel
    description: has no label
  - id: ok
    label: Ok
    aliases: [good, 42, true, alsoGood]
`,
    );
    const { readCanonicalStates } = await freshStates();
    const states = readCanonicalStates();
    // entry without a string label is dropped
    expect(states.map((s) => s.label)).toEqual(["Ok"]);
    // numeric/boolean aliases stripped, only strings survive
    expect(states[0].aliases).toEqual(["good", "alsoGood"]);
  });
});

describe("readCanonicalStates — fallback path", () => {
  it("falls back to the in-code list when the file is missing", async () => {
    const dir = fs.mkdtempSync(path.join(ROOT, "missing-"));
    currentRoot = dir; // no templates/states.yml written
    const { readCanonicalStates, canonicalLabels } = await freshStates();
    const labels = canonicalLabels();
    expect(labels).toEqual([
      "Evaluated",
      "Applied",
      "Responded",
      "Interview",
      "Offer",
      "Hired",
      "Rejected",
      "Discarded",
      "SKIP",
    ]);
    expect(readCanonicalStates().length).toBe(9);
  });

  it("falls back when the YAML has an empty/absent states list", async () => {
    const dir = fs.mkdtempSync(path.join(ROOT, "empty-"));
    currentRoot = dir;
    writeStatesYml(dir, `states: []\n`);
    const { canonicalLabels } = await freshStates();
    expect(canonicalLabels()).toHaveLength(9); // FALLBACK length
  });

  it("falls back when every entry is malformed (parsed length 0)", async () => {
    const dir = fs.mkdtempSync(path.join(ROOT, "allbad-"));
    currentRoot = dir;
    writeStatesYml(dir, `states:\n  - id: x\n  - id: y\n`); // no labels anywhere
    const { canonicalLabels } = await freshStates();
    expect(canonicalLabels()).toHaveLength(9);
  });

  it("falls back when the file is not valid YAML", async () => {
    const dir = fs.mkdtempSync(path.join(ROOT, "badyaml-"));
    currentRoot = dir;
    fs.mkdirSync(path.join(dir, "templates"), { recursive: true });
    fs.writeFileSync(path.join(dir, "templates", "states.yml"), "::: not: [valid", "utf8");
    const { canonicalLabels } = await freshStates();
    expect(canonicalLabels()).toHaveLength(9);
  });
});

describe("canonicalLabels", () => {
  it("returns labels in declared order from the file", async () => {
    const dir = fs.mkdtempSync(path.join(ROOT, "labels-"));
    currentRoot = dir;
    writeStatesYml(dir, GOOD_YML);
    const { canonicalLabels } = await freshStates();
    expect(canonicalLabels()).toEqual(["Evaluated", "Applied", "Rejected"]);
  });
});

describe("canonicalizeStatus", () => {
  async function loadWithGood() {
    const dir = fs.mkdtempSync(path.join(ROOT, "canon-"));
    currentRoot = dir;
    writeStatesYml(dir, GOOD_YML);
    return freshStates();
  }

  it("matches by canonical label, case-insensitively", async () => {
    const { canonicalizeStatus } = await loadWithGood();
    expect(canonicalizeStatus("Applied")).toBe("Applied");
    expect(canonicalizeStatus("APPLIED")).toBe("Applied");
    expect(canonicalizeStatus("applied")).toBe("Applied");
  });

  it("matches by id", async () => {
    const { canonicalizeStatus } = await loadWithGood();
    expect(canonicalizeStatus("rejected")).toBe("Rejected");
  });

  it("matches by alias (case-insensitive)", async () => {
    const { canonicalizeStatus } = await loadWithGood();
    expect(canonicalizeStatus("enviada")).toBe("Applied");
    expect(canonicalizeStatus("RECHAZADA")).toBe("Rejected");
  });

  it("strips surrounding whitespace and markdown bold (**) before matching", async () => {
    const { canonicalizeStatus } = await loadWithGood();
    expect(canonicalizeStatus("  **Applied**  ")).toBe("Applied");
    expect(canonicalizeStatus("**enviada**")).toBe("Applied");
  });

  it("returns null for an empty/blank/unknown status", async () => {
    const { canonicalizeStatus } = await loadWithGood();
    expect(canonicalizeStatus("")).toBeNull();
    expect(canonicalizeStatus("   ")).toBeNull();
    expect(canonicalizeStatus("**  **")).toBeNull(); // only bold markers -> empty
    expect(canonicalizeStatus("not-a-real-state")).toBeNull();
  });

  it("resolves the documented FALLBACK aliases when running off the fallback list", async () => {
    const dir = fs.mkdtempSync(path.join(ROOT, "fbalias-"));
    currentRoot = dir; // no file -> FALLBACK
    const { canonicalizeStatus } = await freshStates();
    expect(canonicalizeStatus("no aplicar")).toBe("SKIP");
    expect(canonicalizeStatus("oferta")).toBe("Offer");
    expect(canonicalizeStatus("entrevista")).toBe("Interview");
  });
});
