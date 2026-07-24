#!/usr/bin/env node

/**
 * set-status.mjs — canonical CLI to update a tracker row's status/note.
 *
 * data/applications.md is a shared surface with multiple readers and writers.
 * One canonical write path is safer than hand-editing markdown, so modes
 * (apply, followup, batch) can call this instead of editing the table.
 *
 * Usage:
 *   node set-status.mjs <report#|company> <state> [--note "..."] [--role "..."] [--force] [--dry-run] [--json]
 *
 * Row resolution:
 *   - numeric argument → exact match on the # column; if the tracker has a
 *     duplicate # (see #1704), --role narrows it, otherwise it fails ambiguous
 *     with a candidate list instead of silently editing the first match
 *   - otherwise → company match (normalized, same key style as merge-tracker's
 *     dedup); multiple hits are narrowed with --role (fuzzy, role-matcher.mjs),
 *     and anything still ambiguous fails with a numbered candidate list.
 *
 * State validation is strict against templates/states.yml (labels, ids, and
 * aliases resolve to the canonical label; anything else is rejected before the
 * tracker is touched). --note appends to the Notes cell with "; " and is
 * idempotent — re-running the same command is always safe.
 *
 * The tracker is replaced atomically (temp file + rename in the same
 * directory). Only the Status and Notes cells of the matched row change;
 * every other byte of the tracker round-trips untouched.
 *
 * NOTE on concurrency: this script now takes the SAME exclusive filesystem
 * lock merge-tracker.mjs uses (extracted into tracker-lock.mjs), and the
 * Next.js dashboard's status API takes the equivalent lock too (see
 * web/src/lib/core/tracker-lock.ts). Previously this script reasoned that
 * "adding a 4th bespoke lock wouldn't help since the other 3 don't share one"
 * and kept its read-modify-write window short instead of locking. That
 * reasoning no longer holds: merge-tracker.mjs, this script, and the web API
 * route now all acquire the identical lock (same lock-directory derivation,
 * same acquire/release protocol), so a batch merge and a dashboard status
 * click can no longer race each other into a silent lost update.
 *
 * Exit codes: 0 success (including no-op re-runs) · 1 usage error,
 * non-canonical state, unreadable states.yml, or write failure ·
 * 2 row not found or unreadable tracker · 3 ambiguous company match.
 */

import { readFileSync, existsSync, writeFileSync, renameSync, rmSync, copyFileSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { load as yamlLoad } from 'js-yaml';
import { extractTrackerReportNumbers, resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { rebuildRow } from './tracker-utils.mjs';
import { roleFuzzyMatch } from './role-matcher.mjs';
import { lockDirFor, acquireTrackerLock, canonicalizeTrackerPath } from './tracker-lock.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
// Same multi-profile resolution pattern as analyze-patterns.mjs/invite-match.mjs.
const DATA_ROOT = process.env.CAREER_OPS_ROOT ? resolve(process.env.CAREER_OPS_ROOT) : CAREER_OPS;
const APPS_FILE = process.env.CAREER_OPS_TRACKER
  ? process.env.CAREER_OPS_TRACKER
  : existsSync(join(DATA_ROOT, 'data/applications.md'))
    ? join(DATA_ROOT, 'data/applications.md')
    : join(DATA_ROOT, 'applications.md');
const STATES_FILE = join(DATA_ROOT, 'templates/states.yml');

const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_NOT_FOUND = 2;
const EXIT_AMBIGUOUS = 3;
const EXIT_LOCK_TIMEOUT = 4;

const USAGE = `Usage: node set-status.mjs <report#|company> <state> [--note "..."] [--role "..."] [--force] [--dry-run] [--json]

  <report#|company>  Row selector: tracker # (exact) or company name (normalized match)
  <state>            Canonical state from templates/states.yml (aliases accepted)
  --note "..."       Append to the Notes cell ("; "-separated, idempotent)
  --role "..."       Disambiguate when several rows share the company (fuzzy match)
  --force            Allow a numeric selector when the row's report link carries a different ID
  --dry-run          Resolve and validate, but write nothing
  --json             Machine-readable output on stdout (errors included)`;

// ── argument parsing ─────────────────────────────────────────────

const rawArgs = process.argv.slice(2);
const positional = [];
const flags = { note: null, role: null, force: false, dryRun: false, json: false };

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--note' || a === '--role') {
    // Never consume a following flag as the value: "--note --dry-run" would
    // silently disable dry-run and turn a preview into a real write.
    const value = rawArgs[i + 1];
    if (value === undefined || value.startsWith('--')) {
      failUsage(`Missing value for ${a}`);
    }
    flags[a === '--note' ? 'note' : 'role'] = value;
    i++;
  }
  else if (a === '--force') { flags.force = true; }
  else if (a === '--dry-run') { flags.dryRun = true; }
  else if (a === '--json') { flags.json = true; }
  else if (a.startsWith('--')) { failUsage(`Unknown flag: ${a}`); }
  else { positional.push(a); }
}

if (positional.length !== 2) {
  failUsage(positional.length === 0 ? null : `Expected 2 arguments (selector, state), got ${positional.length}`);
}

const [selector, stateInput] = positional;

/**
 * Emit a structured error and exit.
 *
 * With --json the error object goes to stdout so callers parse one stream; the
 * human-readable message always goes to stderr.
 *
 * @param {number} exitCode - Process exit code (see EXIT_* contract above).
 * @param {string} code - Stable machine-readable error code.
 * @param {string} message - Human-readable explanation.
 * @param {object} [extra] - Extra JSON fields (e.g. candidates).
 * @returns {never}
 */
function failWith(exitCode, code, message, extra = {}) {
  if (flags.json) {
    console.log(JSON.stringify({ error: message, code, ...extra }));
  }
  console.error(`❌ ${message}`);
  process.exit(exitCode);
}

/**
 * Print usage (plus an optional specific complaint) and exit 1.
 *
 * @param {string|null} message - What was wrong with the invocation, if known.
 * @returns {never}
 */
function failUsage(message) {
  // failUsage can fire mid-argv-parse — before flags.json is settled — so
  // JSON mode is detected from the raw argv directly.
  if (rawArgs.includes('--json')) {
    const msg = message ?? 'Expected 2 arguments: <report#|company> <state>';
    console.log(JSON.stringify({ error: msg, code: 'usage' }));
    console.error(`❌ ${msg}`);
  } else {
    if (message) console.error(`❌ ${message}\n`);
    console.error(USAGE);
  }
  process.exit(EXIT_USAGE);
}

// ── shared helpers (normally would live in tracker-utils.mjs, but that file
// currently only exports rebuildRow — keeping these local avoids widening a
// shared module's contract for a single new caller) ──────────────────────

/**
 * Normalize company names for same-company lookups.
 * Mirrors merge-tracker.mjs's normalizeCompany so a row one script would
 * match is never missed by another.
 *
 * @param {string} name
 * @returns {string}
 */
function normalizeCompany(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Neutralize characters that would corrupt the applications.md table.
 * Mirrors merge-tracker.mjs's cell() helper.
 *
 * @param {*} v
 * @returns {string}
 */
function cell(v) {
  return String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/\s*\|\s*/g, ' / ').trim();
}

/**
 * Load the canonical tracker states from templates/states.yml.
 *
 * @param {string} statesPath
 * @returns {{id:string,label:string,aliases:string[]}[]}
 */
function loadCanonicalStates(statesPath) {
  const doc = yamlLoad(readFileSync(statesPath, 'utf-8'));
  if (!doc || !Array.isArray(doc.states)) {
    throw new Error(`Malformed states file at ${statesPath}: expected a top-level "states" list`);
  }
  return doc.states.map(s => ({
    id: String(s.id ?? ''),
    label: String(s.label ?? ''),
    aliases: Array.isArray(s.aliases) ? s.aliases.map(String) : [],
  }));
}

/**
 * Resolve user input to a canonical state label, strictly (unknown input
 * returns null rather than defaulting, unlike merge-tracker's lenient batch
 * normalization).
 *
 * @param {string} input
 * @param {{id:string,label:string,aliases:string[]}[]} states
 * @returns {string|null}
 */
function resolveCanonicalState(input, states) {
  const clean = String(input ?? '').replace(/\*\*/g, '').trim().toLowerCase();
  if (!clean) return null;
  for (const s of states) {
    if (s.label.toLowerCase() === clean) return s.label;
    if (s.id.toLowerCase() === clean) return s.label;
    if (s.aliases.some(a => a.toLowerCase() === clean)) return s.label;
  }
  return null;
}

/**
 * Replace a tracker file atomically using a same-directory temporary file.
 * Mirrors merge-tracker.mjs's writeFileAtomic.
 *
 * @param {string} path
 * @param {string} content
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

// ── state validation (before anything touches the tracker) ──────

let states;
try {
  states = loadCanonicalStates(STATES_FILE);
} catch (err) {
  failWith(EXIT_USAGE, 'states-error', `Cannot load canonical states from ${STATES_FILE}: ${err.message}`);
}
const newStatus = resolveCanonicalState(stateInput, states);
if (!newStatus) {
  const valid = states.map(s => s.label).join(' · ');
  failWith(EXIT_USAGE, 'invalid-state', `"${stateInput}" is not a canonical state. Valid states: ${valid}`);
}

// ── tracker access ───────────────────────────────────────────────

if (!existsSync(APPS_FILE)) {
  failWith(EXIT_NOT_FOUND, 'no-tracker', `No tracker found at ${APPS_FILE}`);
}

/**
 * Find the tracker row matching the CLI selector.
 *
 * @param {object[]} rows - Parsed data rows (parseTrackerRow output + lineIdx).
 * @param {{release: Function}} [lock] - Held tracker lock, released before any
 *   process-exiting failure so a bad selector never leaves the lock held.
 * @returns {object} The single matched row. Exits the process on 0 or 2+ matches.
 */
function resolveRow(rows, lock) {
  if (/^\d+$/.test(selector)) {
    const num = parseInt(selector, 10);
    const matches = rows.filter(r => r.num === num);
    if (matches.length === 0) {
      lock?.release();
      failWith(EXIT_NOT_FOUND, 'not-found', `No tracker row with #${num}`);
    }
    if (matches.length > 1 && flags.role) {
      const narrowed = matches.filter(r => roleFuzzyMatch(r.role, flags.role));
      if (narrowed.length === 1) return narrowed[0];
      // Fall through with the original list so the candidates stay visible.
    }
    if (matches.length > 1) {
      // A bare report number should never match more than one row — the #1704
      // failure mode: a stale tracker # reused across 2+ rows means "the first
      // match" is a silent coin flip on which company gets edited. Refuse to
      // guess; require --role or the company selector instead.
      const candidates = matches.map(r => ({ num: r.num, company: r.company, role: r.role }));
      const listing = candidates.map(c => `#${c.num}\t${c.company}\t${c.role}`).join('\n');
      lock?.release();
      failWith(EXIT_AMBIGUOUS, 'ambiguous',
        `#${num} is a duplicate tracker number shared by ${matches.length} rows (see #1704) — pass --role to disambiguate, or use the company name instead:\n${listing}`,
        { candidates });
    }
    return matches[0];
  }

  const key = normalizeCompany(selector);
  if (!key) {
    lock?.release();
    failUsage(`Selector "${selector}" is empty after normalization`);
  }
  let matches = rows.filter(r => normalizeCompany(r.company) === key);

  if (matches.length === 0) {
    lock?.release();
    failWith(EXIT_NOT_FOUND, 'not-found', `No tracker row with company matching "${selector}"`);
  }
  if (matches.length > 1 && flags.role) {
    const narrowed = matches.filter(r => roleFuzzyMatch(r.role, flags.role));
    if (narrowed.length === 1) return narrowed[0];
    // Fall through with the original list so the candidates stay visible.
  }
  if (matches.length > 1) {
    const candidates = matches.map(r => ({ num: r.num, company: r.company, role: r.role }));
    const listing = candidates.map(c => `#${c.num}\t${c.company}\t${c.role}`).join('\n');
    lock?.release();
    failWith(EXIT_AMBIGUOUS, 'ambiguous',
      `Company "${selector}" matches ${matches.length} rows — pass the # or narrow with --role:\n${listing}`,
      { candidates });
  }
  return matches[0];
}

// ── read-modify-write (under the shared tracker lock — same lock
// merge-tracker.mjs and the web dashboard's status API use, so a batch merge
// and a CLI status update can never race each other into a lost update) ─────

// Dry-run never writes, so it must not hold the exclusive lock: a read-only
// preview should not block (or be blocked by) merge-tracker or another
// set-status writer. A stale read is acceptable for a preview.
let trackerLock = null;
if (!flags.dryRun) {
  const lockDir = lockDirFor(canonicalizeTrackerPath(APPS_FILE), process.env.CAREER_OPS_TRACKER_LOCK);
  try {
    trackerLock = await acquireTrackerLock(lockDir, {
      timeoutMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS) || 10_000,
      retryMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_RETRY_MS) || 75,
      staleMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_STALE_MS) || 10 * 60_000,
      tracker: APPS_FILE,
    });
    process.once('exit', () => trackerLock?.release());
  } catch (err) {
    // Exit 4 means "lock is busy — retry later" and must stay reserved for
    // the actual timeout. Filesystem/configuration failures (EACCES on the
    // lock dir, unwritable owner.json, …) are not retryable and fail as a
    // config error instead.
    if (err?.code === 'LOCK_TIMEOUT') {
      failWith(EXIT_LOCK_TIMEOUT, 'lock-timeout', err.message);
    }
    failWith(EXIT_USAGE, 'lock-error', `Cannot acquire tracker lock: ${err.message}`);
  }
}

let content;
try {
  content = readFileSync(APPS_FILE, 'utf-8');
} catch (err) {
  trackerLock?.release();
  failWith(EXIT_NOT_FOUND, 'read-failure', `Cannot read tracker at ${APPS_FILE}: ${err.message}`);
}
const lines = content.split('\n');
const colmap = resolveColumns(lines);

const rows = [];
for (let i = 0; i < lines.length; i++) {
  const row = parseTrackerRow(lines[i], colmap);
  if (row) rows.push({ ...row, lineIdx: i });
}
if (rows.length === 0) {
  trackerLock?.release();
  failWith(EXIT_NOT_FOUND, 'empty-tracker', `Tracker at ${APPS_FILE} has no data rows`);
}

const target = resolveRow(rows, trackerLock);

// A numeric selector is often copied from a report filename. If tracker drift
// has made the row ID disagree with its local report link, silently updating
// that row can affect the wrong application. Company selectors remain usable,
// and --force records an explicit decision to proceed despite the mismatch.
if (/^\d+$/.test(selector) && !flags.force) {
  const reportNums = extractTrackerReportNumbers(target.report);
  const mismatched = reportNums.filter(num => num !== target.num);
  if (mismatched.length > 0) {
    trackerLock?.release();
    failWith(
      EXIT_AMBIGUOUS,
      'report-number-mismatch',
      `Tracker #${target.num} points to report ID(s) ${reportNums.map(num => `#${num}`).join(', ')}. ` +
        'Use the company selector, repair the Report cell, or re-run with --force.',
      { trackerNum: target.num, reportNums },
    );
  }
}

// --role is an explicit statement of which opening the caller means, but
// resolveRow only consults it to break ties between 2+ candidates. A selector
// matching exactly one row therefore returned that row without ever checking
// it against --role, silently rewriting a status the caller never asked for.
// That is the wrong-row mutation in #2009: the intended requisition may not be
// in the tracker at all (fuzzy-deduped away, or never merged), so the lone
// survivor for that company absorbs the update instead. Fail closed and let
// --force record an explicit decision, matching the report-mismatch guard.
// Exact-title equality must be checked separately: roleFuzzyMatch is a DEDUP
// predicate, and it deliberately returns false for two titles whose overlap is
// entirely baseline vocabulary (["platform","engineer"]) so that same-titled
// sibling reqs never auto-merge. That makes it unusable on its own here — it
// would reject --role "Platform Engineer" against a row that IS exactly that.
const normalizeRoleText = s => String(s ?? '')
  .toLowerCase()
  // Preserve symbols that distinguish real titles before collapsing generic
  // punctuation — otherwise "C# Engineer" and "C++ Engineer" both fold to
  // "c engineer" and the exact-equality path treats them as the same row.
  .replace(/\+\+/g, ' plusplus ')
  .replace(/#/g, ' sharp ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
const roleMatchesTarget = normalizeRoleText(target.role) === normalizeRoleText(flags.role)
  || roleFuzzyMatch(target.role, flags.role);

if (flags.role && !flags.force && !roleMatchesTarget) {
  trackerLock?.release();
  failWith(
    EXIT_AMBIGUOUS,
    'role-mismatch',
    `Tracker #${target.num} (${target.company}) is "${target.role}", which does not match --role "${flags.role}". ` +
      'The row you meant may not be in the tracker. Re-run with --force to update this row anyway.',
    { trackerNum: target.num, rowRole: target.role, requestedRole: flags.role },
  );
}
const oldStatus = target.status;
const note = flags.note != null ? cell(flags.note) : null;

// Rebuild only the matched line: change the Status cell, append the note, keep
// every other cell exactly as parsed.
const parts = lines[target.lineIdx].split('|').map(s => s.trim());
while (parts.length <= Math.max(colmap.status, colmap.notes ?? 0)) parts.push('');

const statusChanged = parts[colmap.status] !== newStatus;
parts[colmap.status] = newStatus;

let noteChanged = false;
if (note) {
  if (colmap.notes == null) {
    trackerLock?.release();
    failWith(EXIT_USAGE, 'no-notes-column', 'Tracker has no Notes column — cannot apply --note');
  }
  const existing = parts[colmap.notes] ?? '';
  // Delimiter-aware idempotency: the note counts as already present only when
  // it appears as a whole "; "-delimited entry (or as the entire field) — a
  // bare substring of a longer entry ("sent" inside "sent CV") must not
  // suppress a genuinely new note. Matching the full note text at entry
  // boundaries (instead of splitting the field into segments) keeps retries
  // idempotent even when the note itself contains "; ".
  const hasNote = existing === note
    || existing.startsWith(`${note}; `)
    || existing.endsWith(`; ${note}`)
    || existing.includes(`; ${note}; `);
  if (!hasNote) {
    parts[colmap.notes] = existing && existing !== '—' && existing !== '-' ? `${existing}; ${note}` : note;
    noteChanged = true;
  }
}

const changed = statusChanged || noteChanged;

if (changed && !flags.dryRun) {
  lines[target.lineIdx] = rebuildRow(parts);
  try {
    // Backup first (best-effort — a failed snapshot must never block the real write).
    try { copyFileSync(APPS_FILE, APPS_FILE + '.bak'); } catch { /* non-fatal */ }
    writeFileAtomic(APPS_FILE, lines.join('\n'));
  } catch (err) {
    trackerLock?.release();
    failWith(EXIT_USAGE, 'write-failure', `Failed to write tracker at ${APPS_FILE}: ${err.message}`);
  }
}
trackerLock?.release();

// ── report ───────────────────────────────────────────────────────

const result = {
  changed,
  num: target.num,
  company: target.company,
  role: target.role,
  oldStatus,
  newStatus,
  ...(note != null ? { note } : {}),
  ...(flags.dryRun ? { dryRun: true } : {}),
  // Fire the #1430 hook only on an actual transition INTO Applied — an
  // idempotent re-run of an already-Applied row must not invite a consumer
  // to seed a duplicate follow-up.
  ...(statusChanged && newStatus === 'Applied' ? { followupSeedCandidate: true } : {}),
  tracker: APPS_FILE,
};

if (flags.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const verb = flags.dryRun ? 'would set' : changed ? 'set' : 'already';
  console.log(`✅ #${target.num} ${target.company} — ${target.role}: ${verb} ${oldStatus} → ${newStatus}${note ? ` (note: ${note})` : ''}`);
  if (statusChanged && !flags.dryRun && newStatus === 'Applied') {
    console.error('ℹ️  Status is Applied — seed follow-ups: node followup-seed.mjs ' + target.num);
  }
}
process.exit(EXIT_OK);
