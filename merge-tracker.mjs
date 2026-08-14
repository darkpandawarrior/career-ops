#!/usr/bin/env node
/**
 * merge-tracker.mjs — Merge batch tracker additions into applications.md
 *
 * Handles multiple TSV formats:
 * - 9-col: num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes
 * - 8-col: num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport (no notes)
 * - Pipe-delimited (markdown table row): | col | col | ... |
 *
 * Dedup: company normalized + role fuzzy match + report number match
 * If duplicate with higher score → update in-place, update report link
 * Validates status against states.yml (rejects non-canonical, logs warning)
 *
 * Run: node career-ops/merge-tracker.mjs [--dry-run] [--verify]
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, renameSync, existsSync, rmSync, copyFileSync } from 'fs';
import { join, basename, dirname } from 'path';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { normalizeReportLink as normalizeLink } from './tracker-links.mjs';
import { roleFuzzyMatch } from './role-matcher.mjs';
import { LEGACY_COLMAP, detectColumns, normalizeVia, resolveScoreStatus, SEPARATOR_ROW_RE } from './tracker-parse.mjs';
import { resolveCareerOpsRoot } from './path-resolver.mjs';
import { lockDirFor } from './tracker-lock.mjs';
import { acquireTrackerLock, canonicalizeTrackerPath, normalizeCompany, resolveWorkspaceRoot } from './tracker-utils.mjs';
import { normalizeUrl } from './url-key.mjs';

const { engineRoot: CAREER_OPS, dataRoot: CAREER_OPS_DATA } = resolveCareerOpsRoot(import.meta.url);
// Support both layouts: data/applications.md (boilerplate) and applications.md (original).
// CAREER_OPS_TRACKER overrides the path (used by tests and non-standard layouts).
const APPS_FILE_RAW = process.env.CAREER_OPS_TRACKER
  ? process.env.CAREER_OPS_TRACKER
  : existsSync(join(CAREER_OPS_DATA, 'data/applications.md'))
    ? join(CAREER_OPS_DATA, 'data/applications.md')
    : join(CAREER_OPS_DATA, 'applications.md');
const APPS_FILE = canonicalizeTrackerPath(APPS_FILE_RAW);
const TRACKER_DIR = dirname(APPS_FILE);
// CAREER_OPS_ADDITIONS overrides the additions dir (used by tests, mirrors CAREER_OPS_TRACKER).
const ADDITIONS_DIR = process.env.CAREER_OPS_ADDITIONS
  ? process.env.CAREER_OPS_ADDITIONS
  : join(CAREER_OPS_DATA, 'batch/tracker-additions');
const MERGED_DIR = join(ADDITIONS_DIR, 'merged');
const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');
const MIGRATE = process.argv.includes('--migrate');
const MIGRATE_VIA = process.argv.includes('--migrate-via');
const BACKFILL_URLS = process.argv.includes('--backfill-urls');
const MERGE_HOLD_MS = Number(process.env.CAREER_OPS_MERGE_HOLD_MS) || 0;
const MERGE_READY_IPC = process.env.CAREER_OPS_MERGE_READY_IPC === '1';

const TRACKER_LOCK_DIR = lockDirFor(APPS_FILE, process.env.CAREER_OPS_TRACKER_LOCK);

// The reports/ dir sits at the repo root, which is the tracker's parent in the
// data/ layout (data/applications.md) and the tracker's own dir at root layout.
// Shared with tracker-utils.mjs so every reader of the tracker's siblings
// agrees on where they live (#2471).
const REPORTS_ROOT = resolveWorkspaceRoot(APPS_FILE);

/**
 * Normalize report links before writing them into the tracker file.
 *
 * TSV additions use root-relative report links so they are easy for agents to
 * generate. The tracker may live either at `data/applications.md` or at the
 * repository root, so this wrapper binds the correct tracker and reports
 * directories before delegating to the shared link normalizer.
 *
 * @param {string} reportField - Raw report cell from a TSV addition.
 * @returns {string} Markdown report link relative to the tracker file.
 */
const normalizeReportLink = (reportField) => normalizeLink(reportField, TRACKER_DIR, REPORTS_ROOT);

// Ensure required directories exist (fresh setup)
mkdirSync(join(CAREER_OPS_DATA, 'data'), { recursive: true });
mkdirSync(ADDITIONS_DIR, { recursive: true });

/**
 * Pause the async merge flow for a fixed number of milliseconds.
 *
 * Used by the regression test hook (`CAREER_OPS_MERGE_HOLD_MS`), which
 * deliberately holds the first merge after it reads `applications.md` so a
 * second merge can try to enter the same critical section. (The lock's own
 * retry/backoff sleep now lives in tracker-lock.mjs.)
 *
 * @param {number} ms - Milliseconds to wait before resolving.
 * @returns {Promise<void>} Resolves after the requested delay.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Replace a tracker file atomically using a same-directory temporary file.
 *
 * Writing into the same directory keeps the final `renameSync` atomic on normal
 * filesystems and avoids exposing a partially written `applications.md` to other
 * readers. If the write or rename fails, the temporary file is cleaned up before
 * the original error is rethrown.
 *
 * @param {string} path - Final file path to replace.
 * @param {string} content - Complete file content to write.
 * @returns {void}
 */
function writeFileAtomic(path, content) {
  const tmpPath = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, path);
  } catch (err) {
    rmSync(tmpPath, { force: true });
    throw err;
  }
}

let trackerLock;
try {
  trackerLock = await acquireTrackerLock(TRACKER_LOCK_DIR, {
    timeoutMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS) || 60_000,
    retryMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_RETRY_MS) || 75,
    staleMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_STALE_MS) || 10 * 60_000,
    tracker: APPS_FILE,
  });
  process.once('exit', () => trackerLock?.release());
  if (trackerLock.waitMs > 0 || trackerLock.staleRecovered) {
    console.log(`🔒 Tracker merge lock acquired (wait_ms=${trackerLock.waitMs} | attempts=${trackerLock.attempts} | stale_recovered=${trackerLock.staleRecovered})`);
  }
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}

// Canonical states and aliases
const CANONICAL_STATES = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Hired', 'Rejected', 'Discarded', 'SKIP'];

/**
 * Convert raw addition status text into one canonical tracker state.
 *
 * Batch workers and older tracker additions may emit Spanish labels, bold
 * Markdown, legacy date suffixes, or repost markers. The merge script normalizes
 * all of those variants here so applications.md keeps the states defined by
 * templates/states.yml.
 *
 * @param {string} status - Raw status string from a TSV or pipe-delimited row.
 * @returns {string} Canonical tracker status.
 */
function validateStatus(status) {
  const clean = status.replace(/\*\*/g, '').replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  const lower = clean.toLowerCase();

  for (const valid of CANONICAL_STATES) {
    if (valid.toLowerCase() === lower) return valid;
  }

  // Aliases
  const aliases = {
    // Spanish → English
    'evaluada': 'Evaluated', 'condicional': 'Evaluated', 'hold': 'Evaluated', 'evaluar': 'Evaluated', 'verificar': 'Evaluated',
    'aplicado': 'Applied', 'enviada': 'Applied', 'aplicada': 'Applied', 'applied': 'Applied', 'sent': 'Applied',
    'respondido': 'Responded',
    'entrevista': 'Interview',
    'oferta': 'Offer',
    'contratado': 'Hired', 'contratada': 'Hired', 'accepted': 'Hired', 'accept': 'Hired',
    'rechazado': 'Rejected', 'rechazada': 'Rejected',
    'descartado': 'Discarded', 'descartada': 'Discarded', 'cerrada': 'Discarded', 'cancelada': 'Discarded',
    'no aplicar': 'SKIP', 'no_aplicar': 'SKIP', 'skip': 'SKIP', 'monitor': 'SKIP',
    'geo blocker': 'SKIP',
  };

  if (aliases[lower]) return aliases[lower];

  // DUPLICADO/Repost → Discarded
  if (/^(duplicado|dup|repost)/i.test(lower)) return 'Discarded';

  console.warn(`⚠️  Non-canonical status "${status}" → defaulting to "Evaluated"`);
  return 'Evaluated';
}

/**
 * Extract the bracketed report number from a Markdown report link.
 *
 * Report-number equality is an exact duplicate signal, but only after company
 * equality is confirmed by the caller. This helper reads links such as
 * `[123](../reports/123-company-role-date.md)` and returns the numeric id.
 *
 * @param {string} reportStr - Raw report cell from applications.md or TSV input.
 * @returns {number|null} Parsed report number, or null when absent.
 */
function extractReportNum(reportStr) {
  const m = reportStr.match(/\[(\d+)\]/);
  return m ? parseInt(m[1]) : null;
}

/**
 * Derive a posting URL from a row's linked report (`**URL:**` header).
 *
 * ONE derivation shared by the merge loop and --backfill-urls. The key has to be
 * written on the way IN, not only by a migration: the documented TSV is nine
 * columns with the URL optional, so a row added through the normal batch flow
 * carries no URL of its own and Pass 0 would have nothing to match until a human
 * remembered to run the backfill. A dedup key that only exists after a manual
 * step is a dedup key that is usually absent.
 *
 * @param {string} reportField - Report cell, e.g. `[42](reports/042-acme.md)`.
 * @returns {{url: string, reason: 'ok'|'no-report'|'no-url'}} The URL plus why
 *   it is empty, so the backfill can report the two cases separately.
 */
function resolveReportUrl(reportField) {
  const linkMatch = (reportField || '').match(/\]\(([^)]+)\)/);
  if (!linkMatch) return { url: '', reason: 'no-report' };
  // Containment, not cosmetics: resolve and assert the path stays under
  // REPORTS_ROOT. Stripping leading `../` alone still let an embedded
  // `reports/../../..` walk out of the tree, and the tracker is user-editable.
  const reportPath = resolve(REPORTS_ROOT, linkMatch[1].trim().replace(/^(\.\.\/)+/, ''));
  if (!reportPath.startsWith(REPORTS_ROOT + sep)) return { url: '', reason: 'no-report' };
  if (!existsSync(reportPath)) return { url: '', reason: 'no-report' };
  // [ \t]* NOT \s*: \s matches newlines, so an empty `**URL:**` header swallowed
  // the line break and captured the NEXT header's text. Every such report then
  // minted the same bogus key (`**Legitimacy:**`), and the backfill counted it
  // as a successful fill.
  const m = readFileSync(reportPath, 'utf-8').match(/^\*\*URL:\*\*[ \t]*(\S+)/m);
  if (!m) return { url: '', reason: 'no-url' };
  // Strip a markdown autolink wrapper and trailing punctuation, then require a
  // real http(s) URL. `**URL:** N/A` is legitimate for recruiter-sourced roles,
  // and normalizeUrl deliberately yields no key for it — writing the placeholder
  // into the column would hand every such row the same key.
  const raw = m[1].replace(/^<|>$/g, '').replace(/[),.;]+$/, '');
  return normalizeUrl(raw) ? { url: raw, reason: 'ok' } : { url: '', reason: 'no-url' };
}

// Matches the req/job-number labels actually seen in this tracker's free-text
// Notes column: `R_1488728`, `Req PRACT011038`, `Req #1311`, `REQ-2026-32061`,
// `Job 202606-116491`, `Job ID 65136`, `Posting ID 5340`, `JR00124259`,
// `Ref R2857957`. The label is required so we don't grab an unrelated number
// (a salary figure, a date fragment) — only text explicitly tagged as a
// req/job/posting/reference id counts.
const REQ_NUMBER_RE = /\b(?:job\s*id|posting\s*id|requisition|req|jr|job|posting|ref(?:erence)?|r_)[\s:#_-]*([a-z][a-z0-9-]*\d[a-z0-9-]*|\d[a-z0-9-]*)\b/i;

/**
 * Extract a requisition/job-ID number from a free-text notes field.
 *
 * The tier-3 fuzzy company+role match has no way to tell apart two distinct
 * postings with similar/generic titles (#1524 — e.g. two TD Bank L&D postings
 * distinguished only by `R_1494379` vs `R_1488728`). When the notes field
 * carries a req or job ID, it's a stronger identity signal than title
 * similarity — use it as an additional guard so same-title-different-req rows
 * are never collapsed. Broadened beyond bare numeric IDs (#1524/#1427) to also
 * catch `R_…`, `JR…`, hyphenated `REQ-2026-…`, and `Posting ID …` forms.
 *
 * @param {string} notes - Free-text notes cell from the tracker or TSV addition.
 * @returns {string|null} The extracted requisition number (uppercased), or null when absent.
 */
function extractReqNumber(notes) {
  if (!notes) return null;
  const m = String(notes).match(REQ_NUMBER_RE);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Company equality for duplicate detection.
 *
 * normalizeCompany() strips everything outside letters/digits (any script), so
 * a company name written entirely in a non-Latin script that has no Unicode
 * letter category (rare, but punctuation-only names like `?` do) can still
 * normalize to the empty string — and every such name would compare equal to
 * every other one. When the normalized key carries no signal, fall back to raw
 * trimmed equality so two genuinely keyless companies stay distinct; the
 * unknown-employer `?` marker still matches itself, so the #1596 cross-channel
 * guard keeps its existing behavior.
 *
 * @param {string} a - Company cell from one side of the comparison.
 * @param {string} b - Company cell from the other side.
 * @returns {boolean} True when the two cells name the same company.
 */
function companiesMatch(a, b) {
  const key = normalizeCompany(String(a));
  if (key !== normalizeCompany(String(b))) return false;
  return key !== '' || String(a).trim() === String(b).trim();
}

/**
 * Combine an existing row's Notes with a re-evaluation's Notes.
 *
 * The update path used to overwrite Notes with
 * `Re-eval {date} ({old}→{new}). {new notes}`, discarding the existing cell
 * outright (#2392 gap 2). The Notes column is not decoration: it carries the
 * `Applied YYYY-MM-DD` marker that followup-cadence.mjs prefers over the Date
 * column (dropping it silently resets the follow-up clock to the evaluation
 * date), the req/job number that this script's OWN sibling-req guard reads back
 * via extractReqNumber(), contact addresses, and whatever the user wrote with
 * `set-status --note`. None of it is recoverable if lost: applications.md is
 * gitignored, so only this run's own `.bak` snapshot (see the write-back
 * section below) could recover it.
 *
 * Format: the existing notes are kept verbatim and FIRST, with the re-eval
 * marker and any new notes appended after them. Order is deliberate, not
 * cosmetic — parseAppliedDate() and extractReqNumber() both return their FIRST
 * match, so leading with the established text keeps a row's apply date and req
 * number stable across re-evaluations instead of letting each new evaluation's
 * text take over. The cost is that Notes grows by one clause per re-evaluation.
 *
 * @param {string} existingNotes - Notes cell currently on the tracker row.
 * @param {object} addition - Parsed TSV addition (uses `notes` and `date`).
 * @param {number} oldScore - Score currently on the row.
 * @param {number} newScore - Score from the addition.
 * @param {string} [extraMarker] - Appended to the re-eval marker, before any
 *   incoming notes. Used by the downgrade path to record the superseded report
 *   (#2411). It rides on the marker rather than on `addition.notes` so that the
 *   repeat detection below keeps comparing the user's own text against the
 *   user's own text — a generated fragment in that comparison would make every
 *   downgrade look like a new note and defeat it.
 * @returns {string} Combined Notes cell.
 */
function mergeNotes(existingNotes, addition, oldScore, newScore, extraMarker = '') {
  // Trailing period trimmed only so the '. ' join does not produce '..'; no
  // other character of the existing text is touched. The tracker's "no data"
  // sentinels (the looksLikeScoreCell set minus the score-only DUP) count as
  // empty here: a placeholder cell collapses to the marker instead of gaining
  // a `—. ` separator the row never had (#2483).
  const prevRaw = String(existingNotes ?? '').trim();
  const prev = ['—', '-', 'N/A'].includes(prevRaw)
    ? ''
    : prevRaw.replace(/\s*\.\s*$/, '');
  const incoming = String(addition.notes ?? '').trim();
  const marker = extraMarker
    ? `Re-eval ${addition.date} (${oldScore}→${newScore}) — ${extraMarker}`
    : `Re-eval ${addition.date} (${oldScore}→${newScore})`;
  // Re-running the same evaluation would otherwise repeat its own text; the
  // marker still records that the re-evaluation happened. Repeats are detected
  // per CLAUSE — the same '. ' separator this function joins with — not by raw
  // substring: `prev.includes(incoming)` dropped any new note that happened to
  // appear INSIDE an existing clause ("Remote" vanished against "Remote OK").
  // A clause equals the incoming text either bare or in the marker-prefixed
  // form a previous run of this function appended (`{marker}: {incoming}`).
  const clause = (s) => s.replace(/\.+$/, '').trim();
  const incomingClause = clause(incoming);
  const isRepeat = incoming !== '' && prev.split(/\.\s+/).map(clause)
    .some(c => c === incomingClause || c.endsWith(`: ${incomingClause}`));
  const tail = incoming && !isRepeat ? `${marker}: ${incoming}` : marker;
  return prev ? `${prev}. ${tail}` : tail;
}

/**
 * Parse a score cell into a numeric value for score-upgrade decisions.
 *
 * The merge path compares old and new scores to decide whether to update an
 * existing duplicate row. Markdown bolding and `/5` suffixes are presentation
 * details, so only the first numeric value is used.
 *
 * @param {string} s - Raw score cell such as `4.2/5`.
 * @returns {number} Parsed score, or 0 when no numeric value is present.
 */
function parseScore(s) {
  const m = s.replace(/\*\*/g, '').match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

// Column layout for the applications.md table. The tracker may use the original
// 9-column layout, or a customized one with an extra/reordered column (e.g. a
// Location column after Role). We map columns by header NAME rather than fixed
// position so both work — fixed-position indexing would otherwise read, say,
// Location where it expects Score. Falls back to the legacy layout when no
// recognizable header row is found.
// LEGACY_COLMAP, HEADER_ALIASES and detectColumns are the shared header-name
// mapping, now sourced from tracker-parse.mjs so every tracker reader stays in
// lockstep (see imports above). COLMAP stays mutable here — it is reassigned to
// the detected layout once the table is read (below).
let COLMAP = LEGACY_COLMAP;

// Neutralize characters that would corrupt the applications.md table. Both this
// file and tracker-parse.mjs read rows with a raw `line.split('|')`, so a literal
// pipe or a newline in a free-text value (company/role/location/notes) would shift
// every later column. Replace rather than backslash-escape: `\|` would still split
// on the inner pipe. This is additive — normal cells are unchanged; only values
// that would already break the table get sanitized (also keeps the web reader safe).
function cell(v) {
  return String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/\s*\|\s*/g, ' / ').trim();
}

// Build a tracker row string matching the detected layout (with or without the
// optional Via and Location columns) so writes round-trip through the same
// schema. Optional columns follow the documented positions: Via after Company
// (#1596), Location after Role (#946).
function buildRow(o) {
  const cells = [o.num, o.date, cell(o.company)];
  if (COLMAP.via != null) cells.push(cell(o.via) || '—');
  cells.push(cell(o.role));
  if (COLMAP.location != null) cells.push(cell(o.location) || '—');
  cells.push(o.score, o.status, o.pdf, o.report, cell(o.notes));
  // Optional trailing URL column — the stable natural key.
  if (COLMAP.url != null) cells.push(cell(o.url) || '');
  return `| ${cells.join(' | ')} |`;
}

// Header + separator for the DETECTED layout, mirroring buildRow's column
// order. The abort path below prints these as repair guidance, so hard-coding
// the nine-column form would hand a user with a Via or Location column a
// header that silently drops it — repair instructions that reintroduce the
// drift they exist to fix.
function buildHeaderRows() {
  const labels = ['#', 'Date', 'Company'];
  if (COLMAP.via != null) labels.push('Via');
  labels.push('Role');
  if (COLMAP.location != null) labels.push('Location');
  labels.push('Score', 'Status', 'PDF', 'Report', 'Notes');
  return {
    header: `| ${labels.join(' | ')} |`,
    separator: `|${labels.map((l) => '-'.repeat(Math.max(3, l.length + 2))).join('|')}|`,
  };
}

/**
 * Parse one Markdown applications.md table row into a tracker object.
 *
 * Header/separator rows and malformed rows return null. Valid rows preserve the
 * original raw line so the merge logic can locate and replace the exact tracker
 * line when a higher-scored re-evaluation arrives.
 *
 * @param {string} line - One line from applications.md.
 * @returns {object|null} Parsed tracker row, or null for non-data rows.
 */
function parseAppLine(line) {
  const parts = line.split('|').map(s => s.trim());
  const maxIdx = Math.max(...Object.values(COLMAP));
  if (parts.length <= maxIdx) return null;
  const num = parseInt(parts[COLMAP.num]);
  if (isNaN(num) || num === 0) return null;
  return {
    num,
    date: parts[COLMAP.date],
    company: parts[COLMAP.company],
    via: COLMAP.via != null ? parts[COLMAP.via] : '',
    role: parts[COLMAP.role],
    location: COLMAP.location != null ? parts[COLMAP.location] : '',
    score: parts[COLMAP.score],
    status: parts[COLMAP.status],
    pdf: parts[COLMAP.pdf],
    report: parts[COLMAP.report],
    notes: COLMAP.notes != null ? (parts[COLMAP.notes] || '') : '',
    // The posting URL, when the tracker carries the column.
    url: COLMAP.url != null ? (parts[COLMAP.url] || '') : '',
    raw: line,
  };
}

/**
 * Resolve the optional trailing TSV fields (index ≥ 9) into { via, location }.
 *
 * Via travels as a TAGGED field (`via=Hays`) rather than another positional
 * slot: TSV writers are LLM agents following prompt instructions, and a writer
 * that skips an empty padding field would silently shift a positional Via into
 * the Location slot. A single untagged extra remains the legacy positional
 * location (stale prompts stay valid forever). Anything ambiguous — two
 * untagged extras, duplicate via= tags — returns null so the row is rejected
 * loudly instead of merged with scrambled columns.
 *
 * @param {string[]} parts - All fields of the TSV/pipe row.
 * @param {string} filename - Source filename used in warning messages.
 * @returns {{via: string, location: string}|null}
 */
function parseTsvExtras(parts, filename) {
  // Drop placeholders outright. A generator emitting the documented trailing
  // `url` field for a posting that has none writes "N/A"/"TBD"/"—", and by shape
  // that is not a URL — it would fall into the untagged bucket and be recorded
  // as the row's LOCATION. An absent value must read as absent, not as some
  // other column's content.
  const PLACEHOLDER = /^(n\/?a|tbd|none|null|-|—|–)$/i;
  const extras = parts.slice(9)
    .map(s => String(s).trim())
    .filter(s => s !== '' && !PLACEHOLDER.test(s));
  const viaTags = extras.filter(s => /^via=/i.test(s));
  // Classify trailing fields by SHAPE, not position. A URL is
  // unambiguous (starts with http(s)://), so the posting URL and an older
  // location cell are order-independent and a row carrying both is not read as
  // two ambiguous locations. Location-only rows keep working untouched.
  const urls = extras.filter(s => !/^via=/i.test(s) && /^https?:\/\//i.test(s));
  const untagged = extras.filter(s => !/^via=/i.test(s) && !/^https?:\/\//i.test(s));
  if (viaTags.length > 1 || untagged.length > 1 || urls.length > 1) {
    console.warn(`⚠️  Skipping ${filename}: ambiguous extra fields [${extras.join(', ')}] — expected at most one "via=Firm" tag, one location and one URL`);
    return null;
  }
  return {
    via: viaTags.length ? viaTags[0].replace(/^via=/i, '').trim() : '',
    location: untagged[0] || '',
    url: urls[0] || '',
  };
}

/**
 * Parse a TSV file content into a structured addition object.
 *
 * Handles 9-column TSV, 8-column TSV, and pipe-delimited Markdown rows. The
 * parser also tolerates old score/status column ordering, validates status, and
 * rejects additions without a usable tracker number so malformed batch output
 * cannot corrupt applications.md.
 *
 * @param {string} content - Raw file content from batch/tracker-additions.
 * @param {string} filename - Source filename used in warning messages.
 * @returns {object|null} Parsed tracker addition, or null when malformed.
 */
function parseTsvContent(content, filename) {
  content = content.trim();
  if (!content) return null;

  let parts;
  let addition;

  // Detect pipe-delimited (markdown table row)
  if (content.startsWith('|')) {
    parts = content.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length < 8) {
      console.warn(`⚠️  Skipping malformed pipe-delimited ${filename}: ${parts.length} fields`);
      return null;
    }
    // Format: num | date | company | role | score | status | pdf | report | notes [| location] [| via=Firm]
    addition = {
      num: parseInt(parts[0]),
      date: parts[1],
      company: parts[2],
      role: parts[3],
      score: parts[4],
      status: validateStatus(parts[5]),
      pdf: parts[6],
      report: parts[7],
      notes: parts[8] || '',
    };
    const extras = parseTsvExtras(parts, filename);
    if (!extras) return null;
    Object.assign(addition, extras);
  } else {
    // Tab-separated
    parts = content.split('\t');
    if (parts.length < 8) {
      console.warn(`⚠️  Skipping malformed TSV ${filename}: ${parts.length} fields`);
      return null;
    }

    // Detect column order: some TSVs have (status, score), others have (score, status)
    // Content-based first: a column matching a score pattern (N/5, N.N/5, N/A, DUP) IS
    // the score column, and the other of the two ambiguous columns is then the status
    // column — regardless of position. Only when content is inconclusive (both or
    // neither column looks like a score) do we fall back to the fixed-position
    // assumption (col4=status, col5=score), and that fallback is logged since it's
    // a guess rather than a detection.
    // Shared with tracker-parse.mjs's resolveColumns/resolveScoreStatus (#1427)
    // so the score/status discriminator can't drift between the TSV ingester
    // here and the markdown-table readers.
    const col4 = parts[4].trim();
    const col5 = parts[5].trim();
    const resolved = resolveScoreStatus(col4, col5);

    let statusCol, scoreCol;
    if (resolved) {
      statusCol = resolved.status; scoreCol = resolved.score;
    } else {
      // Inconclusive (both or neither column looks like a score) — fall back to the
      // fixed-position assumption and flag it rather than silently guessing.
      console.warn(`⚠️  ${filename}: could not detect status/score column order by content, defaulting to position (col4=status, col5=score)`);
      statusCol = col4; scoreCol = col5;
    }

    addition = {
      num: parseInt(parts[0]),
      date: parts[1],
      company: parts[2],
      role: parts[3],
      status: validateStatus(statusCol),
      score: scoreCol,
      pdf: parts[6],
      report: parts[7],
      notes: parts[8] || '',
    };
    // Optional trailing fields: tab-separated TSVs may append a location
    // and/or a tagged via=Firm value.
    const extras = parseTsvExtras(parts, filename);
    if (!extras) return null;
    Object.assign(addition, extras);
  }

  if (isNaN(addition.num) || addition.num === 0) {
    console.warn(`⚠️  Skipping ${filename}: invalid entry number`);
    return null;
  }

  return addition;
}

// ---- Main ----

// Read applications.md
if (!existsSync(APPS_FILE)) {
  console.log('No applications.md found. Nothing to merge into.');
  process.exit(0);
}
const appContent = readFileSync(APPS_FILE, 'utf-8');
// Test-only synchronization hook: the concurrent merge test waits for the
// first worker to read the tracker while still holding the lock, then starts a
// second worker to prove the lock prevents the old lost-update race.
if (MERGE_READY_IPC && typeof process.send === 'function') {
  process.send({ type: 'merge-tracker-ready' });
}
if (MERGE_HOLD_MS > 0) {
  await sleep(MERGE_HOLD_MS);
}

// One-time migration: rewrite existing report links so they resolve relative
// to the tracker file's directory (see #760). Run with: node merge-tracker.mjs --migrate
if (MIGRATE) {
  const migrated = appContent
    .split('\n')
    .map(line => (line.startsWith('|') ? normalizeReportLink(line) : line));
  const before = appContent.split('\n');
  const changed = migrated.filter((l, i) => l !== before[i]).length;

  if (DRY_RUN) {
    console.log(`🔎 Migration (dry-run): ${changed} row(s) would be rewritten in ${basename(APPS_FILE)}`);
  } else {
    writeFileAtomic(APPS_FILE, migrated.join('\n'));
    console.log(`✅ Migration: rewrote ${changed} report link(s) in ${basename(APPS_FILE)} relative to ${TRACKER_DIR === CAREER_OPS ? 'repo root' : 'data/'}`);
  }
  process.exit(0);
}

// Opt-in migration (#1596): insert a Via column (intermediary channel) after
// Company. Header-aware readers auto-detect both layouts, so this is optional —
// it exists for users who want the column added to an existing tracker.
// Idempotent: a tracker that already has a Via column is left untouched.
// Run with: node merge-tracker.mjs --migrate-via [--dry-run]
if (MIGRATE_VIA) {
  const lines = appContent.split('\n');
  const colmap = detectColumns(lines) || LEGACY_COLMAP;
  if (colmap.via != null) {
    console.log('✅ Via column already present — nothing to migrate.');
    process.exit(0);
  }
  const companyIdx = colmap.company;
  let changed = 0;
  const migrated = lines.map(line => {
    if (!line.startsWith('|')) return line;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length <= companyIdx) return line;
    const isHeader = parts[colmap.num] === '#';
    const isSeparator = /^[-: ]*$/.test(parts.join(''));
    const insert = isHeader ? 'Via' : isSeparator ? '-----' : '—';
    const cells = [...parts.slice(1, companyIdx + 1), insert, ...parts.slice(companyIdx + 1, parts.length - 1)];
    changed++;
    return isSeparator
      ? `|${cells.map(c => c || '---').join('|')}|`
      : `| ${cells.join(' | ')} |`;
  });
  if (DRY_RUN) {
    console.log(`🔎 Migration (dry-run): Via column would be inserted after Company (${changed} table line(s) rewritten)`);
  } else {
    writeFileAtomic(APPS_FILE, migrated.join('\n'));
    console.log(`✅ Migration: inserted Via column after Company (${changed} table line(s) rewritten). Direct applications are marked —.`);
  }
  process.exit(0);
}

const appLines = appContent.split('\n');
// Detect the tracker's column layout via header names so parsing and writing
// both work whether the table uses the original 9-column layout or a customized
// one (e.g. with a Location column after Role). Falls back to the legacy layout.
COLMAP = detectColumns(appLines) || LEGACY_COLMAP;
if (COLMAP.location != null) console.log('🧭 Detected Location column.');
if (COLMAP.via != null) console.log('🧭 Detected Via column.');
if (COLMAP.url != null) console.log('🧭 Detected URL column (deterministic dedup active).');
const existingApps = [];
let maxNum = 0;

for (const line of appLines) {
  if (line.startsWith('|') && !line.includes('---') && !line.includes('Empresa')) {
    const app = parseAppLine(line);
    if (app) {
      existingApps.push(app);
      if (app.num > maxNum) maxNum = app.num;
    }
  }
}

// Full set of numbers already on the tracker (#1704). A narrower pass than the
// existingApps loop above: it reads only the numeric # cell and skips a row via
// the same NaN check verify-pipeline.mjs uses, instead of the
// `.includes('---') / .includes('Empresa')` heuristic — so a company/role field
// that happens to contain "Empresa" or "---" can't hide that row's number. Used
// below so a new entry's number is checked against every number actually on the
// tracker, not just the largest one the existingApps loop happened to see.
const usedNumbers = new Set();
const MAX_COL_IDX = Math.max(...Object.values(COLMAP));
for (const line of appLines) {
  if (!line.startsWith('|')) continue;
  const parts = line.split('|').map(s => s.trim());
  if (parts.length <= MAX_COL_IDX) continue;
  const n = parseInt(parts[COLMAP.num]);
  if (!isNaN(n) && n !== 0) {
    usedNumbers.add(n);
    if (n > maxNum) maxNum = n;
  }
}

console.log(`📊 Existing: ${existingApps.length} entries, max #${maxNum}`);

// Read tracker additions
if (!existsSync(ADDITIONS_DIR)) {
  console.log('No tracker-additions directory found.');
  process.exit(0);
}

const tsvFiles = readdirSync(ADDITIONS_DIR).filter(f => f.endsWith('.tsv'));
if (tsvFiles.length === 0) {
  console.log('✅ No pending additions to merge.');
  process.exit(0);
}

// Sort files numerically by their LEADING report number for deterministic
// processing. parseInt stops at the first non-digit, so trailing digits in a
// company slug (e.g. "42-acme2.tsv") no longer get concatenated into the sort
// key the way `replace(/\D/g, '')` did.
tsvFiles.sort((a, b) => {
  const numA = parseInt(a, 10) || 0;
  const numB = parseInt(b, 10) || 0;
  return numA - numB;
});

console.log(`📥 Found ${tsvFiles.length} pending additions`);

let added = 0;
let updated = 0;
let skipped = 0;
const newLines = [];
// TSVs whose evaluation could not be applied to the tracker. They are kept out
// of merged/ so a re-run picks them up, and they make the process exit non-zero
// instead of reporting a success that did not happen.
const failedAdditions = [];

/**
 * Replace one tracker row line wherever it currently lives.
 *
 * A row added earlier in THIS run is still queued in `newLines` and has not
 * been spliced into `appLines` yet, so an update targeting it would not be
 * found by an appLines-only lookup (#2392 gap 3). Searching both keeps the
 * intra-run dedup below able to update a row it just created.
 *
 * @param {string} oldLine - The row line as it currently stands.
 * @param {string} updatedLine - Replacement row line.
 * @returns {boolean} True when the line was found and replaced.
 */
function replaceTrackerLine(oldLine, updatedLine) {
  const idx = appLines.indexOf(oldLine);
  if (idx >= 0) {
    appLines[idx] = updatedLine;
    return true;
  }
  const pendingIdx = newLines.indexOf(oldLine);
  if (pendingIdx >= 0) {
    newLines[pendingIdx] = updatedLine;
    return true;
  }
  return false;
}

for (const file of tsvFiles) {
  const content = readFileSync(join(ADDITIONS_DIR, file), 'utf-8').trim();
  const addition = parseTsvContent(content, file);
  if (!addition) { skipped++; continue; }

  // Normalize the report link to be relative to the tracker file's directory.
  // The TSV convention carries a root-relative `reports/...` link; rewrite it
  // so it resolves correctly when clicked from applications.md (see #760).
  addition.report = normalizeReportLink(addition.report);

  // A via= tag can only be stored if the tracker has a Via column — warn
  // instead of dropping the channel silently (#1596). Clear the value too:
  // existing rows parse with via='' on this layout, so a set addition.via would
  // make the cross-channel duplicate guard see a channel mismatch and add a
  // second row instead of updating the same-agency re-blast.
  if (addition.via && COLMAP.via == null) {
    console.warn(`⚠️  ${file}: carries via=${addition.via} but the tracker has no Via column — value dropped. Add it with: node merge-tracker.mjs --migrate-via`);
    addition.via = '';
  }

  // Check for duplicate by:
  // 0. Exact normalized posting URL (deterministic, authoritative)
  // 1. Exact report number match
  // 2. Company + role fuzzy match
  const reportNum = extractReportNum(addition.report);
  let duplicate = null;
  // Tier-1 only. A report-number match (plus the company guard below) means the
  // addition is provably the SAME evaluation as the existing row, so its role
  // title may replace the row's. Tier-2 (entry num) and tier-3 (fuzzy role)
  // matches keep the existing title: a fuzzy false positive that also rewrites
  // the title destroys the evidence that two reqs were ever distinct, and that
  // evidence is the only thing a human could use to spot the bad merge.
  let reportNumMatched = false;

  // Pass 0 — the posting URL is the stable natural key. When it hits it is
  // authoritative and no heuristic runs. Tiers 1-3 below remain the fallback
  // for rows with no URL yet.
  const addUrl = normalizeUrl(addition.url);
  let dupReason = null;
  if (addUrl) {
    duplicate = existingApps.find(a => a.url && normalizeUrl(a.url) === addUrl);
    if (duplicate) dupReason = 'url';
  }

  // Guard the report/num/fuzzy fallback against collapsing distinct postings.
  //
  // ONLY TWO PRESENT-AND-DIFFERENT KEYS ARE EVIDENCE. A key that is absent on
  // either side says nothing at all, so it must let the tier proceed and decide
  // on its own signals. This is SQL's three-valued logic: a comparison against
  // an unknown is UNKNOWN, not "different" — the same reason `x = NULL` is never
  // true. The earlier version returned true when the ADDITION had no key, which
  // silently turned "I don't know" into "definitely a different posting" and
  // made every URL-bearing row unmatchable by the documented 9-column TSV: a
  // routine re-evaluation appended a duplicate row instead of updating, both
  // rows pointing at the same report. Record-linkage practice names this
  // directly — treating missing as disagreement is a known bias, not a safe
  // default.
  // Two present-and-different keys are PROOF the rows are distinct postings.
  const urlDiffers = (cand) => {
    const candUrl = normalizeUrl(cand.url);
    if (!candUrl || !addUrl) return false;   // unknown → not evidence
    return candUrl !== addUrl;
  };

  // The heuristic tiers additionally refuse to let an UNKEYED addition claim a
  // row whose posting we do know. That asymmetry is the point of the whole
  // change: tier 1 matches on the report number, which is provable identity, so
  // an absent key there must not block — it is UNKNOWN, not "different", and
  // treating it as different is what made a routine nine-column re-evaluation
  // append a duplicate row. Tiers 2 and 3 match on an entry number or a fuzzy
  // title, which are guesses; there, "this row is a specific known posting and
  // you have not told me which posting you are" is a good reason to stay out.
  const urlBlocksHeuristic = (cand) => {
    if (urlDiffers(cand)) return true;
    return Boolean(normalizeUrl(cand.url)) && !addUrl;
  };

  if (!duplicate && reportNum) {
    // Report-number match must also confirm company (#912). Report-file
    // sequence and tracker-row sequence are independent, so the same number
    // appearing for two different companies is sequence drift, not a duplicate.
    // Without the company guard, a NewCo TSV with report [1] silently overwrites
    // the existing tracker row [1] belonging to an unrelated company.
    duplicate = existingApps.find(app => {
      // Provable tier: only a CONFLICT disqualifies, never a missing key.
      if (urlDiffers(app)) return false;
      const existingReportNum = extractReportNum(app.report);
      return existingReportNum === reportNum && companiesMatch(app.company, addition.company);
    });
    if (duplicate) reportNumMatched = true;
  }

  if (!duplicate) {
    // Exact entry number match — but only when the company also matches.
    // The TSV `num` doubles as the tracker row id, yet report-file numbering
    // and tracker-row numbering can drift out of sync (e.g. reports maxed at
    // 067 while the tracker was already at #69). A bare num collision across
    // *different* companies is that drift, not a duplicate — matching on num
    // alone silently merges a brand-new role into an unrelated existing row.
    duplicate = existingApps.find(app =>
      !urlBlocksHeuristic(app) && app.num === addition.num && companiesMatch(app.company, addition.company)
      // Same-run num collisions are reservation races, not row-id references:
      // two TSVs that both claimed num=5 for DIFFERENT roles at one company
      // are two distinct evaluations, and folding them keeps the first title
      // with the second score (main renumbers and keeps both via the
      // #1704/#1733 path). For a row queued THIS run, only accept the num
      // match when the roles also fuzzy-match — consistent with tier-3's
      // cross-run semantics. For rows already on disk, num remains the
      // tracker row id and behavior is unchanged.
      && (!app.addedThisRun || roleFuzzyMatch(addition.role, app.role))
    );
  }

  if (!duplicate) {
    // Company + role fuzzy match
    const additionReqNum = extractReqNumber(addition.notes);
    duplicate = existingApps.find(app => {
      // Two different posting URLs are two different postings — a fuzzy title
      // collision must never collapse them. This is the structural version of
      // the #1524 req-number guard, and the tier where an unkeyed addition is
      // also held back from claiming a row whose posting is known.
      if (urlBlocksHeuristic(app)) return false;
      if (!companiesMatch(app.company, addition.company)) return false;
      if (!roleFuzzyMatch(addition.role, app.role)) return false;
      // Cross-channel guard (#1596): unknown-employer rows (`?`) all normalize
      // to the same empty company key, but the same role via two DIFFERENT
      // agencies is two real submissions — merging them silently is exactly
      // the double-submission hazard the Via column exists to surface. Only
      // the same channel (the agency re-blasting one listing) is a duplicate.
      // Via comparison is Unicode-aware: normalizeCompany() would collapse
      // distinct non-Latin agency names to the same empty key.
      if ((String(addition.company).trim() === '?' || String(app.company).trim() === '?')
          && normalizeVia(addition.via || '') !== normalizeVia(app.via || '')) return false;
      // A different req/job-ID in the notes means these are distinct postings
      // (e.g. two separate "Software Engineer" reqs) even if the fuzzy title
      // match would otherwise say they're the same opening — don't collapse them.
      const appReqNum = extractReqNumber(app.notes);
      if (additionReqNum && appReqNum && additionReqNum !== appReqNum) return false;
      return true;
    });
  }

  if (duplicate) {
    const newScore = parseScore(addition.score);
    const oldScore = parseScore(duplicate.score);

    // A re-evaluation writes through in BOTH directions. A lower score is not
    // noise to discard — it is newer information, and often the most valuable
    // kind: a targeting/policy change, a freshly-discovered staleness signal (a
    // requisition turning out to be a year old), or a gap re-weighted from
    // "ramp-up item" to "decisive gate". The former `newScore > oldScore` gate
    // sent all of those to a bare `else`, so the tracker kept asserting a stale
    // optimistic score, the new report was orphaned, and the TSV was archived to
    // merged/ as if it had landed (#2411). Equal scores write through too, since
    // the notes and report link are still fresher than what the row holds.
    //
    // Because the fuzzy matcher can mis-pair genuinely different roles (see
    // role-matcher.mjs — "Senior" is a stopword and short tokens are dropped), a
    // downgrade records the superseded report number so a bad match stays
    // recoverable from the tracker alone. mergeNotes() keeps the existing cell
    // verbatim and first, so a second downgrade preserves the earlier marker
    // rather than overwriting it.
    const downgrade = newScore < oldScore;
    const oldReportNum = extractReportNum(duplicate.report);
    const supersededNote = downgrade && oldReportNum && oldReportNum !== reportNum
      ? `Superseded report [${oldReportNum}] (was ${oldScore}/5)`
      : '';

    console.log(
      `${downgrade ? '🔽' : '🔄'} Update: #${duplicate.num} ${addition.company} — ${addition.role} (${oldScore}→${newScore})`
      + (downgrade ? ' — DOWNGRADE, re-eval scored lower' : ''),
    );
    const updatedLine = buildRow({
      num: duplicate.num, date: addition.date, company: addition.company,
      // A URL match is a CONFIRMED same-posting identity, so the incoming title
      // is authoritative the same way a report-number match is — employers do
      // edit a live posting's title. The fuzzy tiers stay conservative and keep
      // the existing role, since there the pairing is only a guess.
      role: (reportNumMatched || dupReason === 'url') ? addition.role : duplicate.role,
      via: addition.via || duplicate.via || '—',
      location: addition.location || duplicate.location || '—',
      score: addition.score, status: duplicate.status, pdf: duplicate.pdf,
      report: addition.report,
      notes: mergeNotes(duplicate.notes, addition, oldScore, newScore, supersededNote),
      // Carry the key forward. Without this the update path rewrites the row
      // with an empty URL cell and the posting loses the very key that matched
      // it, silently demoting every later merge back to the fuzzy tiers.
      url: addition.url || duplicate.url || '',
    });
    if (replaceTrackerLine(duplicate.raw, updatedLine)) {
      // Refresh the cached row from the line just written (#2392). `raw` was
      // captured when applications.md was parsed and used to be left stale
      // after the write, so a SECOND addition matching this same row found
      // nothing at indexOf(), fell through a branch with no else, and was
      // archived as merged — the evaluation was gone with no warning and no
      // recoverable copy (applications.md is gitignored). The stale `score`
      // was just as damaging: the second comparison read the pre-update
      // score, so which of several re-evaluations survived depended on TSV
      // filename sort order. Re-parsing the written line is the faithful
      // refresh — the cached row then holds exactly what a fresh read of
      // the tracker would produce.
      const refreshed = parseAppLine(updatedLine);
      if (refreshed) Object.assign(duplicate, refreshed);
      else duplicate.raw = updatedLine;
      updated++;
    } else {
      // Unreachable in practice, but never silent again: a row we cannot
      // locate means the addition was NOT applied, so say so, keep the TSV
      // out of merged/, and fail the run.
      console.error(
        `❌ ${file}: could not locate tracker row #${duplicate.num} ` +
        `(${duplicate.company} — ${duplicate.role}) to update; this evaluation was NOT merged.`,
      );
      failedAdditions.push(file);
    }
  } else {
    // New entry — preserve the TSV's reserved ID whenever it is actually
    // free. Parallel workers can finish out of order, so a valid reservation
    // may be lower than the current tracker maximum (#1733). Renumber only on
    // a real collision, using the next free ID above the current maximum and
    // warning loudly so report/tracker drift is visible (#1704).
    let entryNum;
    if (!usedNumbers.has(addition.num)) {
      entryNum = addition.num;
    } else {
      entryNum = maxNum + 1;
      while (usedNumbers.has(entryNum)) entryNum++;
      console.warn(
        `⚠️  Tracker #${addition.num} already used; assigning #${entryNum} to ` +
        `${addition.company} — ${addition.role}. Report link remains ${addition.report}.`,
      );
    }
    usedNumbers.add(entryNum);
    if (entryNum > maxNum) maxNum = entryNum;

    const newLine = buildRow({
      num: entryNum, date: addition.date, company: addition.company, role: addition.role,
      via: addition.via || '—',
      location: addition.location || '—',
      score: addition.score, status: addition.status, pdf: addition.pdf,
      report: addition.report, notes: addition.notes,
      // Write the key on the way in. Backfill is the one-time EXPAND phase for
      // rows that predate the column; a row added today must carry its own URL
      // or Pass 0 can never match it and dedup stays fuzzy-only for new work.
      url: addition.url || '',
    });
    newLines.push(newLine);
    // Register the row with the dedup index right away (#2392 gap 3). All
    // three dedup tiers search `existingApps`, which only ever held rows read
    // from the file, so two TSVs for the same company+role in ONE run both
    // appended and the tracker gained duplicate rows — exactly the outcome
    // AGENTS.md's "NEVER create new entries if company+role already exists"
    // rule forbids. The parsed row's `raw` is the queued line, and
    // replaceTrackerLine() knows how to find it in `newLines`, so a later
    // higher-scored addition updates it in place just like a row already on
    // disk.
    const parsedNew = parseAppLine(newLine);
    if (parsedNew) {
      // Mark the row as queued this run: tier-2 treats a num collision with a
      // same-run row as a reservation race unless the roles also fuzzy-match
      // (see the tier-2 guard above). Object.assign() in the update path never
      // deletes the flag, so it survives in-place refreshes within the run.
      parsedNew.addedThisRun = true;
      existingApps.push(parsedNew);
    }
    added++;
    console.log(`➕ Add #${entryNum}: ${addition.company} — ${addition.role} (${addition.score})`);
  }
}

// Insert new lines after the header (line index of first data row)
if (newLines.length > 0) {
  // Find header separator (|---|...) and insert after it. Match the row's
  // structure rather than a bare `---` substring, so a data row carrying three
  // hyphens in its free text can never be mistaken for the separator.
  let insertIdx = -1;
  for (let i = 0; i < appLines.length; i++) {
    if (SEPARATOR_ROW_RE.test(appLines[i])) {
      insertIdx = i + 1;
      break;
    }
  }
  if (insertIdx < 0) {
    // #2394: no separator row means no insert point. The old code left
    // insertIdx at -1, skipped the splice with no else, then carried on to
    // write the file, archive every TSV into merged/ and print "+N added" —
    // so a tracker whose table header had been damaged (or a fresh file that
    // only ever got its `# Applications Tracker` line) swallowed a whole batch
    // of evaluations while reporting success. Nothing survived — applications.md
    // is gitignored, and a run this broken never reaches the write-back section
    // below where the `.bak` snapshot is taken.
    //
    // Abort before writing anything. Leaving the tracker and the additions dir
    // exactly as they were makes the run a no-op that replays cleanly once the
    // table is repaired.
    console.error(`❌ Aborting merge: ${basename(APPS_FILE)} has no table separator row ("|---|------|...").`);
    console.error(`   There is no insert point for ${newLines.length} new row(s), so NOTHING was written and no TSV was archived.`);
    console.error('   Repair the tracker table header, then re-run — the pending additions in');
    console.error(`   ${ADDITIONS_DIR} will merge then. Expected header:`);
    const { header, separator } = buildHeaderRows();
    console.error(`     ${header}`);
    console.error(`     ${separator}`);
    for (const line of newLines) console.error(`   not merged: ${line}`);
    trackerLock.release();
    process.exit(1);
  }
  appLines.splice(insertIdx, 0, ...newLines);
}

// Write back
if (!DRY_RUN) {
  // Backup first (best-effort — a failed snapshot must never block the real write).
  try { copyFileSync(APPS_FILE, APPS_FILE + '.bak'); } catch { /* non-fatal */ }
  writeFileAtomic(APPS_FILE, appLines.join('\n'));

  // Move processed files to merged/ — but only the ones actually applied.
  // Archiving a TSV whose row never reached the tracker would make a bug into
  // permanent data loss if the `.bak` snapshot above were ever unavailable.
  if (!existsSync(MERGED_DIR)) mkdirSync(MERGED_DIR, { recursive: true });
  const archivable = tsvFiles.filter(f => !failedAdditions.includes(f));
  for (const file of archivable) {
    renameSync(join(ADDITIONS_DIR, file), join(MERGED_DIR, file));
  }
  console.log(`\n✅ Moved ${archivable.length} TSVs to merged/`);
}

console.log(`\n📊 Summary: +${added} added, 🔄${updated} updated, ⏭️${skipped} skipped${failedAdditions.length ? `, ❌${failedAdditions.length} NOT merged` : ''}`);
if (DRY_RUN) console.log('(dry-run — no changes written)');
trackerLock.release();

// Optional verify
if (VERIFY && !DRY_RUN) {
  console.log('\n--- Running verification ---');
  try {
    execFileSync('node', [join(CAREER_OPS, 'verify-pipeline.mjs')], { stdio: 'inherit' });
  } catch (e) {
    process.exit(1);
  }
}

// Any addition that could not be applied fails the run. The TSVs stay in the
// additions dir, so re-running after the tracker is repaired merges them once.
if (failedAdditions.length > 0) {
  console.error(
    `\n❌ ${failedAdditions.length} addition(s) were NOT merged and were left in ${ADDITIONS_DIR}: ` +
    failedAdditions.join(', '),
  );
  process.exit(1);
}
