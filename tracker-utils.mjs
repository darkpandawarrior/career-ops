/**
 * tracker-utils.mjs — shared helpers for rewriting `data/applications.md` rows.
 *
 * The tracker is a markdown table that several scripts mutate in place
 * (`dedup-tracker.mjs`, `normalize-statuses.mjs`). Keeping the row-rewrite logic
 * here means a fix lands once instead of drifting between copies.
 */

import { readFileSync, existsSync, writeFileSync, renameSync, rmSync } from 'fs';
import { join, dirname, basename } from 'path';
import { randomUUID } from 'node:crypto';
import * as yaml from 'js-yaml';
import { canonicalizeTrackerPath, acquireTrackerLock, lockDirFor } from './tracker-lock.mjs';

/**
 * Resolve the canonical tracker path for a project root.
 *
 * Honours CAREER_OPS_TRACKER, then prefers data/applications.md over the flat
 * applications.md layout, and canonicalizes the result so every reader/writer
 * agrees on one spelling.
 *
 * @param {string} rootDir - Project root (career-ops directory).
 * @returns {string} Canonical absolute tracker path.
 */
export function resolveTrackerPath(rootDir) {
  const raw = process.env.CAREER_OPS_TRACKER
    ? process.env.CAREER_OPS_TRACKER
    : existsSync(join(rootDir, 'data/applications.md'))
      ? join(rootDir, 'data/applications.md')
      : join(rootDir, 'applications.md');
  return canonicalizeTrackerPath(raw);
}

/**
 * Load the canonical states list from templates/states.yml.
 *
 * @param {string} statesPath - Path to states.yml.
 * @returns {{id:string,label:string,aliases:string[]}[]} Parsed states.
 */
export function loadCanonicalStates(statesPath) {
  const doc = yaml.load(readFileSync(statesPath, 'utf-8'));
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
 * Resolve user input to a canonical state label, strictly.
 *
 * Case-insensitive match against each state's label, id, and aliases, after
 * stripping markdown bold. Unknown input returns null so the caller can reject
 * it before anything touches the tracker.
 *
 * @param {string} input - Raw state text.
 * @param {{id:string,label:string,aliases:string[]}[]} states - From loadCanonicalStates().
 * @returns {string|null} Canonical label, or null when unknown.
 */
export function resolveCanonicalState(input, states) {
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
 * Rebuild a markdown table row from the cells produced by `line.split('|')`.
 *
 * `split('|')` yields a leading empty element (before the opening `|`) and,
 * when the row ends with a trailing `|`, a trailing empty element too. A naive
 * `slice(1, -1)` assumes that trailing empty always exists — but a row written
 * without a trailing pipe (`| 5 | … | note`, still a valid row) keeps its real
 * last cell (the notes) at the end, so `slice(1, -1)` silently drops it. Here we
 * drop the leading empty and only drop a trailing element when it is genuinely
 * empty, preserving every real cell regardless of trailing-pipe style (and
 * tolerating extra columns like a custom Location).
 *
 * @param {string[]} parts - Trimmed cells from `line.split('|').map(s => s.trim())`.
 * @returns {string} The rebuilt `| a | b | … |` row.
 */
export function rebuildRow(parts) {
  const cells = parts.slice(1);
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return '| ' + cells.join(' | ') + ' |';
}

/**
 * Normalize company names for same-company lookups across tracker scripts.
 *
 * Company names can contain spaces, punctuation, or branding variants in the
 * tracker and incoming rows. Removing non-alphanumeric characters gives every
 * consumer (merge-tracker dedup, set-status row resolution, scan blacklist
 * matching) the same stable company key, so a row one script would match is
 * never missed by another.
 *
 * @param {string} name - Company name from the tracker or an input row.
 * @returns {string} Lowercase alphanumeric company key.
 */
export function normalizeCompany(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
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
export function writeFileAtomic(path, content) {
  const tmpPath = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, path);
  } catch (err) {
    rmSync(tmpPath, { force: true });
    throw err;
  }
}

/**
 * Canonical process-exit codes shared by every locked, single-purpose
 * tracker-writer CLI (set-status.mjs, mark-pdf-ready.mjs, ...) — one source
 * so a new script can't drift from the numbering an existing one already
 * commits to (callers/CI may depend on these exact values).
 */
export const CLI_EXIT = { OK: 0, USAGE: 1, NOT_FOUND: 2, AMBIGUOUS: 3, LOCK_TIMEOUT: 4 };

/**
 * Build a failWith(exitCode, code, message, extra) bound to a --json flag,
 * shared by every canonical tracker-writer CLI so the JSON-vs-human error
 * contract can't drift between them.
 *
 * With json:true the error object goes to stdout so machine callers always
 * parse one stream; the human-readable message always goes to stderr.
 *
 * @param {boolean} json - The CLI's --json flag.
 * @returns {(exitCode: number, code: string, message: string, extra?: object) => never}
 */
export function makeCliFailWith(json) {
  return function failWith(exitCode, code, message, extra = {}) {
    if (json) {
      console.log(JSON.stringify({ error: message, code, ...extra }));
    }
    console.error(`❌ ${message}`);
    process.exit(exitCode);
  };
}

/**
 * Acquire the shared tracker lock for a locked read-modify-write CLI,
 * routing any failure through the caller's failWith so every canonical
 * writer surfaces lock errors identically (LOCK_TIMEOUT → CLI_EXIT.LOCK_TIMEOUT,
 * anything else → CLI_EXIT.USAGE as a non-retryable config/filesystem error).
 *
 * Dry-run never writes, so it must not hold the exclusive lock: a read-only
 * preview should not block (or be blocked by) another writer — returns null
 * in that case. Registers the `process.exit` release safety net these CLIs
 * rely on (failWith/failUsage/row-resolution all exit directly and skip an
 * explicit release — release() is idempotent, so both firing is fine).
 *
 * @param {string} appsFile - Canonical tracker path (resolveTrackerPath()).
 * @param {{dryRun: boolean, failWith: (exitCode: number, code: string, message: string, extra?: object) => never}} options
 * @returns {Promise<{release: Function}|null>}
 */
export async function acquireTrackerLockForCli(appsFile, { dryRun, failWith }) {
  if (dryRun) return null;
  let lock;
  try {
    lock = await acquireTrackerLock(lockDirFor(appsFile, process.env.CAREER_OPS_TRACKER_LOCK), {
      timeoutMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS) || 60_000,
      retryMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_RETRY_MS) || 75,
      staleMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_STALE_MS) || 10 * 60_000,
      tracker: appsFile,
    });
  } catch (err) {
    // Exit 4 means "lock is busy — retry later" and must stay reserved for
    // the actual timeout. Filesystem/configuration failures (EACCES on the
    // lock dir, unwritable owner.json, …) are not retryable and fail as a
    // config error instead.
    if (err?.code === 'LOCK_TIMEOUT') {
      failWith(CLI_EXIT.LOCK_TIMEOUT, 'lock-timeout', err.message);
    } else {
      failWith(CLI_EXIT.USAGE, 'lock-error', `Cannot acquire tracker lock: ${err.message}`);
    }
    // failWith is documented (and, today, always) to exit the process — but
    // this function is now shared, so don't let a future non-exiting failWith
    // silently fall through to releasing/returning an undefined lock; fail
    // loudly instead.
    throw err;
  }
  process.once('exit', () => lock.release());
  return lock;
}
