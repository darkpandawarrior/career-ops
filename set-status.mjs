#!/usr/bin/env node

/**
 * set-status.mjs — canonical CLI to update a tracker row's status/note.
 *
 * data/applications.md is a shared surface with multiple readers and writers.
 * One canonical write path is safer than hand-editing markdown, so modes
 * (apply, followup, batch) can call this instead of editing the table.
 *
 * Usage:
 *   node set-status.mjs <report#|company> <state> [--note "..."] [--role "..."] [--dry-run] [--json]
 *
 * Row resolution:
 *   - numeric argument → exact match on the # column
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
 * NOTE on concurrency: unlike merge-tracker.mjs (which holds an exclusive
 * filesystem lock across its read-modify-write), this script does not lock
 * the tracker — see the maintenance note in the porting report about the
 * multiple independent tracker-writing code paths already in this repo
 * (merge-tracker.mjs, tracker.mjs, web/src/app/api/status/route.ts). Adding a
 * 4th writer with its own bespoke lock would not actually protect against the
 * other 3, so this script keeps its read-modify-write window short instead.
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
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { rebuildRow } from './tracker-utils.mjs';
import { roleFuzzyMatch } from './role-matcher.mjs';

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

const USAGE = `Usage: node set-status.mjs <report#|company> <state> [--note "..."] [--role "..."] [--dry-run] [--json]

  <report#|company>  Row selector: tracker # (exact) or company name (normalized match)
  <state>            Canonical state from templates/states.yml (aliases accepted)
  --note "..."       Append to the Notes cell ("; "-separated, idempotent)
  --role "..."       Disambiguate when several rows share the company (fuzzy match)
  --dry-run          Resolve and validate, but write nothing
  --json             Machine-readable output on stdout (errors included)`;

// ── argument parsing ─────────────────────────────────────────────

const rawArgs = process.argv.slice(2);
const positional = [];
const flags = { note: null, role: null, dryRun: false, json: false };

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--note') { flags.note = rawArgs[++i] ?? ''; }
  else if (a === '--role') { flags.role = rawArgs[++i] ?? ''; }
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
  if (message) console.error(`❌ ${message}\n`);
  console.error(USAGE);
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
 * @returns {object} The single matched row. Exits the process on 0 or 2+ matches.
 */
function resolveRow(rows) {
  if (/^\d+$/.test(selector)) {
    const num = parseInt(selector, 10);
    const row = rows.find(r => r.num === num);
    if (!row) {
      failWith(EXIT_NOT_FOUND, 'not-found', `No tracker row with #${num}`);
    }
    return row;
  }

  const key = normalizeCompany(selector);
  if (!key) failUsage(`Selector "${selector}" is empty after normalization`);
  let matches = rows.filter(r => normalizeCompany(r.company) === key);

  if (matches.length === 0) {
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
    failWith(EXIT_AMBIGUOUS, 'ambiguous',
      `Company "${selector}" matches ${matches.length} rows — pass the # or narrow with --role:\n${listing}`,
      { candidates });
  }
  return matches[0];
}

// ── read-modify-write ─────────────────────────────────────────────

let content;
try {
  content = readFileSync(APPS_FILE, 'utf-8');
} catch (err) {
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
  failWith(EXIT_NOT_FOUND, 'empty-tracker', `Tracker at ${APPS_FILE} has no data rows`);
}

const target = resolveRow(rows);
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
    failWith(EXIT_USAGE, 'no-notes-column', 'Tracker has no Notes column — cannot apply --note');
  }
  const existing = parts[colmap.notes] ?? '';
  // Substring check keeps retries idempotent even when the note itself
  // contains "; " — a segment-wise comparison would re-append it forever.
  const hasNote = existing.includes(note);
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
    failWith(EXIT_USAGE, 'write-failure', `Failed to write tracker at ${APPS_FILE}: ${err.message}`);
  }
}

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
  tracker: APPS_FILE,
};

if (flags.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const verb = flags.dryRun ? 'would set' : changed ? 'set' : 'already';
  console.log(`✅ #${target.num} ${target.company} — ${target.role}: ${verb} ${oldStatus} → ${newStatus}${note ? ` (note: ${note})` : ''}`);
}
process.exit(EXIT_OK);
