import fs from "node:fs";
import path from "node:path";
import { atomicWrite } from "@/lib/core/safe-write";

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
  return path.join(careerOpsRoot(), `${nameNoExt}.mjs`);
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

export type InboxJob = { url: string; company: string; role: string; done: boolean };

/** Parse data/pipeline.md — lines like `- [ ] URL | Company | Role`. */
export function readInbox(root: string = careerOpsRoot()): InboxJob[] {
  const md = read("data/pipeline.md", root);
  if (!md) return [];
  const jobs: InboxJob[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\s*-\s*\[([ xX])\]\s*(\S+)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$/);
    if (!m) continue;
    jobs.push({
      done: m[1].toLowerCase() === "x",
      url: m[2],
      company: m[3].trim(),
      role: m[4].trim(),
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
};

/**
 * Parse data/applications.md — the tracker table (source of truth).
 * Column order: # | Date | Company | Role | Score | Status | PDF | Report | Notes
 * (note: score BEFORE status, per the core data contract).
 */
export function readApplications(root: string = careerOpsRoot()): Application[] {
  const md = read("data/applications.md", root);
  if (!md) return [];
  const rows: Application[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    // Tolerate both layouts: the current 9-col tracker and older variants
    // where the Notes column is absent (8 cells). Score is always before Status.
    if (cells.length < 8) continue;
    if (cells[0] === "#" || /^:?-{2,}:?$/.test(cells[0])) continue; // header / separator
    const [n, date, company, role, score, status, pdf, report, ...rest] = cells;
    rows.push({ n, date, company, role, score, status, pdf, report, notes: rest.join(" | ") });
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
  return {
    root,
    rootExists: fs.existsSync(root),
    inbox: readInbox(root),
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

/** Locate the evaluation report for an application number
 *  (reports/{n}-{slug}-{date}.md; the leading number may be zero-padded). */
export function findReportFile(n: string, root: string = careerOpsRoot()): string | null {
  const target = parseInt(n, 10);
  if (Number.isNaN(target)) return null;
  let files: string[];
  try {
    files = fs.readdirSync(path.join(root, "reports"));
  } catch {
    return null;
  }
  const match = files.find((f) => f.endsWith(".md") && parseInt(f, 10) === target);
  return match ? path.join(root, "reports", match) : null;
}

export function readReport(n: string, root: string = careerOpsRoot()): ReportData | null {
  const file = findReportFile(n, root);
  if (!file) return null;
  try {
    return { content: fs.readFileSync(file, "utf8"), file: path.basename(file) };
  } catch {
    return null;
  }
}

export function findApplication(n: string, root: string = careerOpsRoot()): Application | null {
  return readApplications(root).find((a) => a.n === n) ?? null;
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
