import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  setAppCell,
  togglePipeline,
  queueAgentTask,
  removeAgentTask,
} from "./tracker-edit";

// Each function takes an explicit `root` and writes into `root/data/*.md` via the
// real atomicWrite (real fs). We point `root` at a throwaway tmp tree per test so
// the suite is hermetic and never touches the user's real profiles/ data.

let ROOT: string;
const created: string[] = [];

function dataDir(): string {
  return path.join(ROOT, "data");
}
function writeFixture(name: string, content: string): string {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, "utf8");
  return file;
}
function read(name: string): string {
  return fs.readFileSync(path.join(dataDir(), name), "utf8");
}

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-tracker-edit-"));
  created.push(ROOT);
});

afterAll(() => {
  for (const d of created) fs.rmSync(d, { recursive: true, force: true });
});

// A representative applications.md: header row, separator, two data rows.
// Columns (0-based after split on "|"): 0 = "" (leading), 1 = #, 2 = Date,
// 3 = Company, 4 = Role, 5 = Source, 6 = Status, 7 = Link, 8 = Resume, 9 = Notes,
// 10 = "" (trailing).
const APPLICATIONS_MD = `# Applications

| # | Date | Company | Role | Source | Status | Link | Resume | Notes |
|---|------|---------|------|--------|--------|------|--------|-------|
| 1 | 2026-06-01 | Acme | PM | greenhouse | applied | http://x | r1 | old note |
| 2 | 2026-06-02 | Globex | APM | lever | screen | http://y | r2 | n2 |
`;

describe("setAppCell", () => {
  it("rewrites the Status column for the matched application number", async () => {
    writeFixture("applications.md", APPLICATIONS_MD);
    expect(await setAppCell("1", "Status", "interview", ROOT)).toBe("ok");
    const out = read("applications.md");
    const row1 = out.split("\n").find((l) => l.startsWith("| 1 "))!;
    expect(row1.split("|")[6].trim()).toBe("interview");
    // Other cells in the row are preserved.
    expect(row1.split("|")[3].trim()).toBe("Acme");
    expect(row1.split("|")[9].trim()).toBe("old note");
  });

  it("rewrites the Notes column and leaves Status untouched", async () => {
    writeFixture("applications.md", APPLICATIONS_MD);
    expect(await setAppCell("1", "Notes", "follow up tue", ROOT)).toBe("ok");
    const row1 = read("applications.md").split("\n").find((l) => l.startsWith("| 1 "))!;
    expect(row1.split("|")[9].trim()).toBe("follow up tue");
    expect(row1.split("|")[6].trim()).toBe("applied");
  });

  it("only edits the matched row, not other rows", async () => {
    writeFixture("applications.md", APPLICATIONS_MD);
    await setAppCell("2", "Status", "rejected", ROOT);
    const lines = read("applications.md").split("\n");
    expect(lines.find((l) => l.startsWith("| 1 "))!.split("|")[6].trim()).toBe("applied");
    expect(lines.find((l) => l.startsWith("| 2 "))!.split("|")[6].trim()).toBe("rejected");
  });

  it("returns not-found when the application number does not exist", async () => {
    writeFixture("applications.md", APPLICATIONS_MD);
    expect(await setAppCell("99", "Status", "interview", ROOT)).toBe("not-found");
  });

  it("returns not-found when the file does not exist", async () => {
    // No fixture written.
    expect(await setAppCell("1", "Status", "interview", ROOT)).toBe("not-found");
  });

  it("rejects values containing pipe or newline chars (would scramble the row)", async () => {
    writeFixture("applications.md", APPLICATIONS_MD);
    expect(await setAppCell("1", "Status", "a|b", ROOT)).toBe("invalid");
    expect(await setAppCell("1", "Status", "a\nb", ROOT)).toBe("invalid");
    expect(await setAppCell("1", "Notes", "a\rb", ROOT)).toBe("invalid");
    // File untouched.
    expect(read("applications.md")).toBe(APPLICATIONS_MD);
  });

  it("does an exact (non-prefix) match on the application number", async () => {
    // n="1" must NOT match the row whose # is "12" (exact cell equality, not prefix).
    // Row needs >=8 parts to clear the `parts.length < 8` guard.
    const md = `| # | Date | Company | Role | Source | Status | Link | Resume | Notes |
|---|------|---------|------|--------|--------|------|--------|-------|
| 12 | 2026-06-01 | Acme | PM | greenhouse | applied | http://x | r1 | note |
`;
    writeFixture("applications.md", md);
    expect(await setAppCell("1", "Status", "x", ROOT)).toBe("not-found");
    expect(await setAppCell("12", "Status", "interview", ROOT)).toBe("ok");
    const row = read("applications.md").split("\n").find((l) => l.startsWith("| 12 "))!;
    expect(row.split("|")[6].trim()).toBe("interview");
  });

  it("falls back to default column index (6=Status) when no header row is present", async () => {
    // A bare row with no header. columnIndex returns null → Status defaults to 6.
    const md = `| 1 | 2026-06-01 | Acme | PM | greenhouse | applied | http://x | r1 | note |
`;
    writeFixture("applications.md", md);
    expect(await setAppCell("1", "Status", "offer", ROOT)).toBe("ok");
    const row = read("applications.md").split("\n")[0];
    expect(row.split("|")[6].trim()).toBe("offer");
  });
});

describe("togglePipeline", () => {
  const PIPELINE_MD = `# Pipeline Inbox

- [ ] https://boards.greenhouse.io/acme/jobs/123
- [x] https://jobs.lever.co/globex/abc-def
- [ ] https://example.com/path/to/job?ref=a/b/c
`;

  it("marks an unchecked item as done", () => {
    writeFixture("pipeline.md", PIPELINE_MD);
    expect(
      togglePipeline("https://boards.greenhouse.io/acme/jobs/123", true, ROOT),
    ).toBe("ok");
    expect(read("pipeline.md")).toContain(
      "- [x] https://boards.greenhouse.io/acme/jobs/123",
    );
  });

  it("marks a checked item as not-done", () => {
    writeFixture("pipeline.md", PIPELINE_MD);
    expect(
      togglePipeline("https://jobs.lever.co/globex/abc-def", false, ROOT),
    ).toBe("ok");
    expect(read("pipeline.md")).toContain(
      "- [ ] https://jobs.lever.co/globex/abc-def",
    );
  });

  it("handles URLs containing forward slashes and query strings (regex-escaped)", () => {
    writeFixture("pipeline.md", PIPELINE_MD);
    const url = "https://example.com/path/to/job?ref=a/b/c";
    expect(togglePipeline(url, true, ROOT)).toBe("ok");
    expect(read("pipeline.md")).toContain(`- [x] ${url}`);
  });

  it("treats regex-special chars in the URL as literals (no false matches)", () => {
    // The '.' and '?' must be escaped — a URL with these only matches itself.
    writeFixture(
      "pipeline.md",
      "- [ ] https://a.co/x?y=1\n- [ ] https://aXco/xZy=1\n",
    );
    expect(togglePipeline("https://a.co/x?y=1", true, ROOT)).toBe("ok");
    const out = read("pipeline.md");
    expect(out).toContain("- [x] https://a.co/x?y=1");
    // The lookalike line (where . and ? were literal-class chars) is untouched.
    expect(out).toContain("- [ ] https://aXco/xZy=1");
  });

  it("returns not-found when the URL is absent (no change to file)", () => {
    writeFixture("pipeline.md", PIPELINE_MD);
    expect(togglePipeline("https://nope.example/none", true, ROOT)).toBe("not-found");
    expect(read("pipeline.md")).toBe(PIPELINE_MD);
  });

  it("returns not-found when the file does not exist", () => {
    expect(togglePipeline("https://x.test/1", true, ROOT)).toBe("not-found");
  });

  it("matches an uppercase-X checkbox too", () => {
    writeFixture("pipeline.md", "- [X] https://up.test/job\n");
    expect(togglePipeline("https://up.test/job", false, ROOT)).toBe("ok");
    expect(read("pipeline.md")).toContain("- [ ] https://up.test/job");
  });

  it("toggles only the first matching occurrence", () => {
    writeFixture(
      "pipeline.md",
      "- [ ] https://dup.test/j\n- [ ] https://dup.test/j\n",
    );
    expect(togglePipeline("https://dup.test/j", true, ROOT)).toBe("ok");
    const lines = read("pipeline.md").split("\n");
    expect(lines[0]).toBe("- [x] https://dup.test/j");
    expect(lines[1]).toBe("- [ ] https://dup.test/j");
  });
});

describe("queueAgentTask", () => {
  it("appends a timestamped task to an existing inbox", () => {
    writeFixture("agent-inbox.md", "# Agent Inbox\n\n- [ ] existing task\n");
    expect(queueAgentTask("review acme offer", ROOT)).toBe("ok");
    const out = read("agent-inbox.md");
    expect(out).toContain("- [ ] existing task");
    // New line ends with the cleaned text after an em dash.
    expect(out).toMatch(/- \[ \] \d{4}-\d{2}-\d{2} \d{2}:\d{2} — review acme offer\n$/);
  });

  it("creates the inbox file when it does not exist", () => {
    expect(queueAgentTask("first task", ROOT)).toBe("ok");
    const out = read("agent-inbox.md");
    expect(out).toContain("# Agent Inbox");
    expect(out).toMatch(/— first task\n$/);
  });

  it("collapses newlines and trims before queueing", () => {
    expect(queueAgentTask("  multi\nline\ntask  ", ROOT)).toBe("ok");
    expect(read("agent-inbox.md")).toContain("— multi line task\n");
  });

  it("returns invalid for empty / whitespace-only text", () => {
    expect(queueAgentTask("", ROOT)).toBe("invalid");
    expect(queueAgentTask("   \n  ", ROOT)).toBe("invalid");
  });

  it("dedupes on the first 80 chars and does not append a second time", () => {
    expect(queueAgentTask("ping recruiter at globex about timeline", ROOT)).toBe("ok");
    const after1 = read("agent-inbox.md");
    expect(queueAgentTask("ping recruiter at globex about timeline", ROOT)).toBe("ok");
    // Deduped: file content is unchanged on the second call.
    expect(read("agent-inbox.md")).toBe(after1);
  });

  it("normalizes a missing trailing newline before appending", () => {
    // Existing content WITHOUT a trailing newline → the replace(/\n*$/) ensures
    // exactly one newline separates old content from the new task.
    writeFixture("agent-inbox.md", "# Agent Inbox");
    expect(queueAgentTask("brand new", ROOT)).toBe("ok");
    const out = read("agent-inbox.md");
    expect(out.startsWith("# Agent Inbox\n- [ ] ")).toBe(true);
  });
});

describe("removeAgentTask", () => {
  it("removes the unchecked line whose text matches the substring", () => {
    writeFixture(
      "agent-inbox.md",
      "# Agent Inbox\n\n- [ ] 2026-06-01 12:00 — call acme\n- [ ] 2026-06-02 09:00 — email globex\n",
    );
    expect(removeAgentTask("call acme", ROOT)).toBe("ok");
    const out = read("agent-inbox.md");
    expect(out).not.toContain("call acme");
    expect(out).toContain("email globex");
  });

  it("returns not-found when no matching unchecked task exists", () => {
    writeFixture("agent-inbox.md", "# Agent Inbox\n\n- [ ] keep me\n");
    expect(removeAgentTask("absent text", ROOT)).toBe("not-found");
    expect(read("agent-inbox.md")).toContain("- [ ] keep me");
  });

  it("does NOT remove a matching but already-checked (done) task", () => {
    // Filter only drops lines starting with "- [ ]" (a space). A "- [x]" line
    // with the same text is preserved.
    writeFixture("agent-inbox.md", "# Agent Inbox\n\n- [x] 2026-06-01 — done thing\n");
    expect(removeAgentTask("done thing", ROOT)).toBe("not-found");
    expect(read("agent-inbox.md")).toContain("- [x] 2026-06-01 — done thing");
  });

  it("removes every matching unchecked line", () => {
    writeFixture(
      "agent-inbox.md",
      "- [ ] dupe target one\n- [ ] dupe target two\n- [ ] other\n",
    );
    expect(removeAgentTask("dupe target", ROOT)).toBe("ok");
    const out = read("agent-inbox.md");
    expect(out).not.toContain("dupe target");
    expect(out).toContain("- [ ] other");
  });

  it("returns not-found when the file does not exist", () => {
    expect(removeAgentTask("anything", ROOT)).toBe("not-found");
  });

  it("trims the search text before matching", () => {
    writeFixture("agent-inbox.md", "- [ ] please review the doc\n");
    expect(removeAgentTask("  review the doc  ", ROOT)).toBe("ok");
    expect(read("agent-inbox.md")).not.toContain("review the doc");
  });
});
