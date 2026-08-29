import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { atomicWrite } from "@/lib/core/safe-write";
import { parseReport } from "@/lib/format";
import { loadHeaderAliases } from "@/lib/tracker-table.mjs";
// One definition of the `{n}-RESERVED.md` convention, shared with
// run-cli-support.mjs — see report-files.mjs for why it lives there.
import { isReservedReportFile } from "@/lib/report-files.mjs";

/**
 * Resolve the career-ops "home" — the directory holding the user's sibling
 * files (cv.md, data/, reports/). In production the web/ app lives inside the
 * career-ops checkout, so the home is its parent (..). Dev overrides via
 * CAREER_OPS_ROOT to read the user's real (gitignored) data from a separate
 * checkout — see web/.env.local.
 */
export function careerOpsRoot(): string {
  const env = process.env.CAREER_OPS_ROOT?.trim();
  if (env) return env;
  return path.resolve(process.cwd(), "..");
}

/**
 * Absolute path to a core root script (e.g. doctor, verify-portals). The `.mjs`
 * is assembled here from the bare name so the literal never appears as a direct
 * `execFile`/`spawn` argument — Next's bundler statically traces such literals
 * as module imports and fails the production build otherwise.
 */
export function rootScript(nameNoExt: string): string {
  // The core checkout is selected at runtime and must not be bundled into the
  // web server output when Turbopack sees this dynamic script path.
  return path.join(/* turbopackIgnore: true */ careerOpsRoot(), `${nameNoExt}.mjs`);
}

// Feature-detect the core's `tracker.mjs delete --num` row-delete (#1200) by probing
// the local script source — older checkouts lack it, so the delete UI hides itself.
export function trackerCanDelete(): boolean {
  try {
    const src = fs.readFileSync(rootScript("tracker"), "utf8");
    return src.includes("delete") && src.includes("--num");
  } catch {
    return false;
  }
}

/**
 * The engine CODE root — the career-ops checkout the web app ships inside
 * (`<checkout>/web`), resolved from the server's launch cwd (always `web/`), NOT
 * from CAREER_OPS_ROOT. This is where the web's own bridge scripts live
 * (onboarding-cli.mjs, job-search-cli.mjs). It matters in dev,
 * where CAREER_OPS_ROOT points at a SEPARATE data checkout that does not carry
 * these web-only scripts; in production code and data are the same checkout.
 */
export function engineRoot(): string {
  return path.resolve(process.cwd(), "..");
}

/** Absolute path to a web-shipped bridge script, resolved against the code root. */
export function engineScript(nameNoExt: string): string {
  return path.join(engineRoot(), `${nameNoExt}.mjs`);
}

/**
 * Profile-awareness: every reader takes an optional `root` (the resolved data
 * directory for the active `?profile`). It defaults to `careerOpsRoot()`, so a
 * single-profile install behaves exactly as before. Request-scoped callers pass
 * `await requestRoot()` (from `@/lib/profile-registry`) to read a specific
 * candidate's data. The functions stay synchronous — root resolution (which may
 * read the registry / request headers) happens once, upstream, at the entry point.
 */
function read(rel: string, root: string = careerOpsRoot()): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return null;
  }
}

export type InboxJob = {
  url: string;
  company: string;
  role: string;
  done: boolean;
  location?: string;
  compensation?: string;
  postedAt?: string;
};

/** Parse data/pipeline.md — `- [ ] URL | Company | Role [| Location [| Compensation]]`.
 *  Location/compensation are optional trailing columns (#1015/#1017); anything
 *  past the 5th column is ignored rather than rejecting the whole line. */
export function readInbox(root: string = careerOpsRoot()): InboxJob[] {
  const md = read("data/pipeline.md", root);
  if (!md) return [];
  const jobs: InboxJob[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
    if (!m) continue;
    const parts = m[2].split("|").map((s) => s.trim());
    if (parts.length < 3 || !parts[0]) continue; // need at least url | company | role
    jobs.push({
      done: m[1].toLowerCase() === "x",
      url: parts[0],
      company: parts[1],
      role: parts[2],
      location: parts[3] || undefined,
      compensation: parts[4] || undefined,
    });
  }
  return jobs;
}

export type Application = {
  n: string;
  date: string;
  company: string;
  role: string;
  score: string;
  status: string;
  pdf: string;
  report: string;
  notes: string;
  /** Recruiter/agency intermediary, when the tracker has an optional Via column. */
  via?: string;
};

/**
 * Header text (lowercased) → canonical field name, loaded at RUNTIME from
 * tracker-aliases.json — the same single source tracker-parse.mjs reads.
 *
 * This used to be a hardcoded copy "mirroring" tracker-parse.mjs, and it had
 * already drifted: the shared file lists `location`, the copy didn't, so the
 * Location column this function's own docblock promises to detect was invisible
 * to the dashboard while the CLI handled it fine. A mirror that has to be
 * hand-synced is a mirror that eventually isn't one.
 */
function headerAliases(root: string): Record<string, string> {
  return loadHeaderAliases(root);
}

/**
 * Scan the table for a header row and build a field-name → cell-index map,
 * the same way the engine's tracker-parse.mjs detectColumns() does — so an
 * optional Via column (inserted after Company) is picked up without assuming
 * a fixed position. Returns null when no header with the essential columns
 * is found, so the caller falls back to the legacy fixed order.
 */
function detectColumns(lines: string[], root: string): Record<string, number> | null {
  const aliases = headerAliases(root);
  for (const line of lines) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim().toLowerCase());
    if (!cells.includes("company") || !cells.includes("role")) continue;
    const map: Record<string, number> = {};
    cells.forEach((c, i) => {
      if (aliases[c] != null) map[aliases[c]] = i;
    });
    if (["n", "company", "role", "score", "status"].every((k) => map[k] != null)) return map;
  }
  return null;
}

/**
 * Parse data/applications.md — the tracker table (source of truth).
 * Column order: # | Date | Company | [Via] | Role | [Location] | Score | Status | PDF | Report | Notes
 * (note: score BEFORE status, per the core data contract). Via and Location
 * are optional columns detected by header name; absent a recognizable header
 * row, falls back to the legacy fixed 9-column order.
 */
export function readApplications(root: string = careerOpsRoot()): Application[] {
  const md = read("data/applications.md", root);
  if (!md) return [];
  const lines = md.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"));
  const colmap = detectColumns(lines, root);

  const rows: Application[] = [];
  for (const line of lines) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (colmap) {
      const maxIdx = Math.max(...Object.values(colmap));
      if (cells.length <= maxIdx) continue;
      const at = (k: string) => (colmap[k] != null ? (cells[colmap[k]] ?? "") : "");
      const n = at("n");
      if (!/^\d+$/.test(n)) continue; // header / separator row
      rows.push({
        n, date: at("date"), company: at("company"), role: at("role"),
        score: at("score"), status: at("status"), pdf: at("pdf"), report: at("report"),
        notes: at("notes"),
        ...(colmap.via != null ? { via: at("via") } : {}),
      });
    } else {
      // Tolerate both layouts: the current 9-col tracker and older variants
      // where the Notes column is absent (8 cells). Score is always before Status.
      if (cells.length < 8) continue;
      if (cells[0] === "#" || /^:?-{2,}:?$/.test(cells[0])) continue; // header / separator
      const [n, date, company, role, score, status, pdf, report, ...rest] = cells;
      rows.push({ n, date, company, role, score, status, pdf, report, notes: rest.join(" | ") });
    }
  }
  return rows;
}

/**
 * Server-side lifecycle of the user's setup — mirrors the prerequisite list that
 * doctor.mjs uses (cv.md, config/profile.yml, modes/_profile.md, portals.yml), by
 * plain file-stat (no subprocess). Drives the home branch: first-run (no CV) →
 * the CV takeover; in-between (CV but no profile) → gentle nudges; established.
 */
export type LifecyclePhase = "first-run" | "in-between" | "established";
/**
 * Server-side lifecycle, mirroring the core doctor.mjs prerequisite list with the
 * SAME existsSync semantics (the SSOT the OnboardingBanner already reads via
 * /api/doctor). The 4 user-layer prereqs: cv.md, config/profile.yml,
 * modes/_profile.md, portals.yml.
 *   - first-run  → a TRULY empty install (no cv AND no data): the CV takeover.
 *     CRITICAL back-compat (maintainer): NEVER force onboarding on a user who
 *     already has data (a full pipeline/tracker with no cv.md is valid).
 *   - in-between → has cv/data but setup incomplete: dashboard + the nudge banner.
 *   - established → all 4 prereqs present.
 * onboardingNeeded mirrors doctor.mjs: true if ANY prereq is missing → show banner.
 */
export function doctorState(root: string = careerOpsRoot()): {
  phase: LifecyclePhase;
  onboardingNeeded: boolean;
  missing: string[];
  hasCv: boolean;
  hasData: boolean;
} {
  const has = (rel: string) => {
    try {
      return fs.existsSync(path.join(root, rel));
    } catch {
      return false;
    }
  };
  const prereqs: [string, string][] = [
    ["cv.md", "cv.md"],
    ["config/profile.yml", "config/profile.yml"],
    ["modes/_profile.md", "modes/_profile.md"],
    ["portals.yml", "portals.yml"],
  ];
  const missing = prereqs.filter(([rel]) => !has(rel)).map(([, label]) => label);
  const hasCv = has("cv.md");
  const hasData = readApplications(root).length > 0 || readInbox(root).some((j) => !j.done);
  const onboardingNeeded = missing.length > 0;
  const phase: LifecyclePhase = !hasCv && !hasData ? "first-run" : onboardingNeeded ? "in-between" : "established";
  return { phase, onboardingNeeded, missing, hasCv, hasData };
}

export type PipelineSummary = {
  root: string;
  rootExists: boolean;
  inbox: InboxJob[];
  applications: Application[];
};

export function pipelineSummary(root: string = careerOpsRoot()): PipelineSummary {
  // Join each raw posting's first_seen date (from the scan log) onto it as
  // postedAt — the inbox triage view orders/facet-filters on it entirely
  // client-side. Reuses readScanHistory's own TSV parsing (below) instead of a
  // second one; keeps the EARLIEST first_seen if a url recurs across scans.
  const scanDates = new Map<string, string>();
  for (const row of readScanHistory(root).rows) {
    if (!scanDates.has(row.url) || row.first_seen < scanDates.get(row.url)!) scanDates.set(row.url, row.first_seen);
  }
  return {
    root,
    rootExists: fs.existsSync(root),
    inbox: readInbox(root).map((j) => ({ ...j, postedAt: j.postedAt ?? scanDates.get(j.url) })),
    applications: readApplications(root),
  };
}

export type ScanRow = {
  url: string;
  first_seen: string;
  portal: string;
  title: string;
  company: string;
  status: string;
  location: string;
};

export type ScanHistory = {
  total: number;
  lastScan: string;
  byStatus: Record<string, number>;
  rows: ScanRow[];
};

/**
 * Parse data/scan-history.tsv — the discovery log written by scan.mjs. Columns:
 * url, first_seen, portal, title, company, status, location (tab-separated, with
 * a header row). Ports dashboard-web/server.mjs#parseScanHistory (newest first).
 */
export function readScanHistory(root: string = careerOpsRoot()): ScanHistory {
  const raw = read("data/scan-history.tsv", root) ?? "";
  const lines = raw.trim().split("\n").slice(1).filter(Boolean); // drop header
  const byStatus: Record<string, number> = {};
  let lastScan = "";
  const rows: ScanRow[] = [];
  for (const line of lines) {
    const [url, first_seen, portal, title, company, status, location] = line.split("\t");
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (first_seen > lastScan) lastScan = first_seen;
    rows.push({ url, first_seen, portal, title, company, status, location });
  }
  return { total: lines.length, lastScan, byStatus, rows: rows.reverse() };
}

export type AgentInboxItem = { done: boolean; text: string };

/** Parse data/agent-inbox.md — `- [ ] task` checklist the agent queues. */
export function readAgentInbox(root: string = careerOpsRoot()): AgentInboxItem[] {
  const md = read("data/agent-inbox.md", root) ?? "";
  const items: AgentInboxItem[] = [];
  for (const m of md.matchAll(/^- \[([ xX])\] (.+)$/gm)) {
    items.push({ done: m[1].toLowerCase() === "x", text: m[2].trim() });
  }
  return items;
}

export type ReportData = { content: string; file: string };

/** Locate the evaluation report for an application number.
 *  The tracker row's own report link is authoritative: report FILE numbers can
 *  differ from application numbers (e.g. app #309 → reports/308-…), so
 *  resolving only by leading filename number misses those. Links are
 *  normalized relative to the tracker file's directory (see #760). Falls back
 *  to the filename scan (reports/{n}-{slug}-{date}.md, possibly zero-padded)
 *  for rows without a parseable link.
 *
 *  `root` stays an explicit parameter in this fork: callers resolve the ACTIVE
 *  profile's data root, which is not necessarily careerOpsRoot(). */
export function findReportFile(n: string, root: string = careerOpsRoot()): string | null {
  const target = parseInt(n, 10);
  if (Number.isNaN(target)) return null;
  const app = readApplications(root).find((a) => parseInt(a.n, 10) === target);
  const linked = app?.report.match(/\]\(([^)]+)\)/)?.[1];
  if (linked) {
    const p = path.resolve(root, "data", linked);
    // Containment: a hand-edited link must not resolve outside the project.
    if (p.endsWith(".md") && !isReservedReportFile(p) && containedRealpath(p, root)) return p;
  }
  let files: string[];
  try {
    files = fs.readdirSync(path.join(root, "reports"));
  } catch {
    return null;
  }
  // Skip `{n}-RESERVED.md` placeholders. reserve-report-num.mjs writes an empty
  // NNN-RESERVED.md sentinel to claim a report number before a worker has written
  // the report; it's normally deleted once the real report lands (or GC'd after
  // 4h if abandoned). But "RESERVED" sorts before nearly every real slug, so a
  // sentinel that outlives its report — a worker driven directly instead of
  // through the orchestrator that owns cleanup — would win this .find() and make
  // the report body and the Apply/PDF-ready checks disappear.
  const match = files.find(
    (f) => f.endsWith(".md") && !/^\d+-RESERVED\.md$/.test(f) && parseInt(f, 10) === target,
  );
  if (!match) return null;
  const p = path.join(root, "reports", match);
  return containedRealpath(p, root) ? p : null;
}

/** True containment check: resolves symlinks before comparing, so a link
 *  planted under data/ or reports/ can't leak files outside the project. */
function containedRealpath(p: string, root: string): boolean {
  try {
    return fs.realpathSync(p).startsWith(fs.realpathSync(root) + path.sep);
  } catch {
    return false; // missing file or unresolvable link — treat as not found
  }
}

export function readReport(n: string, root: string = careerOpsRoot()): ReportData | null {
  const file = findReportFile(n, root);
  if (!file) return null;
  try {
    // Reports live in the user's runtime checkout, outside the web build graph.
    return {
      content: fs.readFileSync(/* turbopackIgnore: true */ file, "utf8"),
      file: path.basename(file),
    };
  } catch {
    return null;
  }
}

export function findApplication(n: string, root: string = careerOpsRoot()): Application | null {
  return readApplications(root).find((a) => a.n === n) ?? null;
}

/** The application's posting URL, resolved from its linked report's `**URL:**`
 *  field (applications.md itself has no URL column — see readApplications).
 *  Used by the apply queue to know what to open for a tracker row. */
export function applicationUrl(app: Application, root: string = careerOpsRoot()): string | null {
  const report = readReportForApplication(app, root);
  if (!report) return null;
  const url = parseReport(report.content).fields.find((f) => f.label === "URL")?.value;
  return url && /^https?:\/\//.test(url) ? url : null;
}

/**
 * Resolve the evaluation report for an application. CRITICAL: report numbers are
 * INDEPENDENT of application numbers (row #22 may link report `007`), so we must
 * read the report via the tracker row's `report` link, not the row number. Order:
 *   1. the explicit linked path  `[7](../reports/007-navi-….md)`
 *   2. the report number in `[7]` → reports/007*
 *   3. fall back to the application number (legacy installs where n == report no.)
 */
export function readReportForApplication(app: Application, root: string = careerOpsRoot()): ReportData | null {
  // 1. explicit path inside the markdown link, sandboxed to the reports dir.
  const linked = app.report.match(/\(([^)]*reports\/[^)]+\.md)\)/i);
  if (linked) {
    const rel = linked[1].replace(/^(?:\.\.\/)+/, ""); // strip leading ../
    const file = path.resolve(root, rel);
    const reportsDir = path.resolve(root, "reports");
    if (file.startsWith(reportsDir + path.sep)) {
      try {
        return { content: fs.readFileSync(file, "utf8"), file: path.basename(file) };
      } catch {
        /* fall through */
      }
    }
  }
  // 2. report number from the link label, e.g. [7] → reports/007*
  const num = app.report.match(/\[(\d+)\]/);
  if (num) {
    const byNum = readReport(num[1], root);
    if (byNum) return byNum;
  }
  // 3. legacy fallback: application number == report number.
  return readReport(app.n, root);
}

/** The CANONICAL user-customization file the CLI/TUI reads. Durable facts the
 *  web assistant learns go HERE (single source of truth) inside a managed marker
 *  block — so the CLI sees them too. No web-only memory store (that would drift). */
export function profilePath(root: string = careerOpsRoot()): string {
  return path.join(root, "modes", "_profile.md");
}

const NOTES_START = "<!-- co-web-notes:start -->";
const NOTES_END = "<!-- co-web-notes:end -->";

/** Read back ONLY the web-assistant managed notes from modes/_profile.md (small,
 *  focused — the agent reads the rest of the canonical files itself). Falls back
 *  to the legacy web-only memory file for back-compat. */
export function readMemory(root: string = careerOpsRoot()): string {
  try {
    const md = fs.readFileSync(profilePath(root), "utf8");
    const i = md.indexOf(NOTES_START);
    const j = md.indexOf(NOTES_END);
    if (i !== -1 && j !== -1 && j > i) return md.slice(i + NOTES_START.length, j).trim();
  } catch {
    /* no _profile.md yet */
  }
  try {
    return fs.readFileSync(path.join(root, ".career-ops-web", "memory.md"), "utf8").trim();
  } catch {
    return "";
  }
}

/** Append a durable fact to the canonical modes/_profile.md (creating the file +
 *  managed block if needed), PRESERVING existing user content. */
export function rememberFact(fact: string, root: string = careerOpsRoot()): "ok" | "deduped" | "error" {
  const f = fact.trim().replace(/\s+/g, " ").slice(0, 300);
  if (!f) return "deduped";
  const p = profilePath(root);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    let md = "";
    try {
      md = fs.readFileSync(p, "utf8");
    } catch {
      md = "";
    }
    const i = md.indexOf(NOTES_START);
    const j = md.indexOf(NOTES_END);
    if (i !== -1 && j !== -1 && j > i) {
      if (md.slice(i, j).includes(f)) return "deduped";
      atomicWrite(p, md.slice(0, j) + `- ${f}\n` + md.slice(j));
      return "ok";
    }
    if (md.includes(f)) return "deduped";
    const section = `\n\n## Notes from the web assistant\n${NOTES_START}\n- ${f}\n${NOTES_END}\n`;
    const base = md.trim() ? md.replace(/\n*$/, "\n") : "# Profile customization\n";
    atomicWrite(p, base + section);
    return "ok";
  } catch {
    return "error";
  }
}


/**
 * AGENTS.md's two language axes, resolved from config/profile.yml.
 *
 * `language.output` governs human-facing prose; `language.modes_dir` selects the
 * market vocabulary and local evaluation rules. They compose freely — English
 * output with DACH vocabulary is a valid configuration — so they are returned
 * as separate fields rather than collapsed into one "locale".
 */
export type LanguageConfig = {
  /** language.output — prose language for user-facing text. Default "en". */
  output: string;
  /** language.modes_dir, normalized without a trailing slash. Default "modes". */
  modesDir: string;
  /** The market's evaluation-mode file, repo-root-relative. Default "modes/oferta.md". */
  evalModeFile: string;
};

/**
 * A `modes_dir` value we are willing to turn into a filesystem path.
 *
 * profile.yml is user-editable and this value is used to read a directory and
 * to build a path handed to an agent, so it is validated rather than trusted:
 * a crafted `modes/../../etc` must not escape the checkout. Rejecting falls
 * back to the default, which is always correct, never dangerous.
 */
const MODES_DIR_RE = /^modes(?:\/[A-Za-z0-9_-]+)?$/;

/**
 * Every localized evaluation mode's title line states the block range it
 * produces — "Valutazione completa A-F", "完整的 A-G 维度评估", "전체 평가 A-G".
 * Older translations say A-F and newer ones A-G (Block G, posting legitimacy),
 * so both count; the dash may be ASCII or typographic.
 *
 * This is what identifies the evaluation mode inside a market directory, in
 * preference to a hardcoded {dir → filename} map. A map would have to list all
 * 18 market directories that exist today and would silently go stale the next
 * time a translation lands — the exact class of bug this function is fixing.
 * Verified against every market directory in the repo: each contains exactly
 * one file whose title line matches, and no apply-mode collides.
 */
const EVAL_MODE_TITLE_RE = /A[-\u2010-\u2015][FG]/;

const DEFAULT_EVAL_MODE = "modes/oferta.md";

/**
 * Find the evaluation mode inside a market directory. Returns the default when
 * the directory is unreadable or nothing in it looks like an evaluation mode —
 * a wrong-but-working English evaluation beats a run that cannot start.
 */
function resolveEvalModeFile(root: string, modesDir: string): string {
  if (modesDir === "modes") return DEFAULT_EVAL_MODE;
  let names: string[];
  try {
    names = fs.readdirSync(path.join(root, modesDir));
  } catch {
    return DEFAULT_EVAL_MODE;
  }
  for (const name of names.sort()) {
    // `_shared.md`, `_profile.md` and friends are includes, never entry points.
    if (!name.endsWith(".md") || name.startsWith("_") || name === "README.md") continue;
    try {
      const first = fs.readFileSync(path.join(root, modesDir, name), "utf8").split("\n", 1)[0] ?? "";
      if (EVAL_MODE_TITLE_RE.test(first)) return `${modesDir}/${name}`;
    } catch {
      /* unreadable file — keep looking */
    }
  }
  return DEFAULT_EVAL_MODE;
}

/**
 * Read the language configuration. Never throws: a missing or malformed
 * profile.yml yields the English/global default, because a broken config
 * should degrade the market vocabulary, not block every evaluation.
 */
export function readLanguageConfig(root: string = careerOpsRoot()): LanguageConfig {
  let modesDir = "modes";
  let output = "en";
  try {
    const parsed = yaml.load(fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const language = (parsed as Record<string, unknown>).language;
      if (language && typeof language === "object" && !Array.isArray(language)) {
        const l = language as Record<string, unknown>;
        if (typeof l.output === "string" && l.output.trim()) output = l.output.trim();
        if (typeof l.modes_dir === "string" && l.modes_dir.trim()) {
          const candidate = l.modes_dir.trim().replace(/\/+$/, "");
          if (MODES_DIR_RE.test(candidate)) modesDir = candidate;
        }
      }
    }
  } catch {
    /* no profile yet, or malformed — defaults are correct */
  }
  return { output, modesDir, evalModeFile: resolveEvalModeFile(root, modesDir) };
}
