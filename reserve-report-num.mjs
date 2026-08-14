#!/usr/bin/env node

/**
 * reserve-report-num.mjs - shared atomic report-number allocator.
 *
 * Fixes the race condition described in #749 (and its followups): when two
 * Claude Code windows, batch workers, or a worker racing a tracker write all
 * run simultaneously, `max(existing)+1` computed from reports/ ALONE can
 * collide with a number the tracker already claims (e.g. a report link
 * written before its file lands on disk). Reservations now account for BOTH
 * report files/sentinels in reports/ AND report numbers already referenced
 * by the tracker (row `#` and Report-column links), and sentinel creation
 * runs under the SAME lock merge-tracker.mjs/set-status.mjs use for tracker
 * writes (tracker-lock.mjs's acquireTrackerLock) — one lock, one source of
 * truth, instead of two independent mechanisms that could each be right on
 * their own and still collide with each other.
 *
 * `fs.writeFileSync(path, data, { flag: 'wx' })` (O_CREAT|O_EXCL) remains the
 * ground-truth atomicity primitive for the sentinel file itself; the tracker
 * lock closes the remaining gap where the tracker and reports/ disagree.
 *
 * The sentinel is `NNN-RESERVED.md` inside `reports/`, now holding a small
 * JSON body `{pid, token, created_at}` instead of being zero-byte: `token`
 * lets releaseReportNumbers() refuse to drop a sentinel it doesn't own, and
 * `pid` lets GC skip a sentinel whose owning process is still alive even past
 * the TTL. verify-pipeline.mjs's own stale-sentinel check only looks at the
 * filename suffix and mtime, so this body change doesn't affect it.
 *
 * The caller (mode file or agent) must:
 *   1. Run this script to get a number.
 *   2. Write the real report file `NNN-{slug}-{date}.md`.
 *   3. Delete the sentinel (or let verify-pipeline.mjs GC it on next run).
 *
 * Usage:
 *   node reserve-report-num.mjs
 *   node reserve-report-num.mjs --count 8
 *   node reserve-report-num.mjs --release 035
 *   node reserve-report-num.mjs --release 042-049
 *   node reserve-report-num.mjs --gc
 *
 * Also usable as a module by future callers (evaluators, merge-tracker, etc.)
 * that want to skip the subprocess round-trip:
 *   import { reserveReportNumbers, releaseReportNumbers } from './reserve-report-num.mjs';
 */

import {
  existsSync, mkdirSync, readFileSync, readdirSync, realpathSync,
  statSync, unlinkSync, writeFileSync,
} from 'fs';
import { randomUUID } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseTrackerRow, resolveColumns, extractTrackerReportNumbers } from './tracker-parse.mjs';
import { resolveTrackerPath } from './tracker-utils.mjs';
import { acquireTrackerLock, canonicalizeTrackerPath } from './tracker-utils.mjs';
import { lockDirFor } from './tracker-lock.mjs';
import { resolveCareerOpsRoot } from './path-resolver.mjs';

// engineRoot = where this script and its siblings live; dataRoot = the ACTIVE
// profile's data (CAREER_OPS_ROOT), which is a different directory under the
// multi-profile setup. Data paths below must use CAREER_OPS_DATA, never CAREER_OPS.
const { engineRoot: CAREER_OPS, dataRoot: CAREER_OPS_DATA } = resolveCareerOpsRoot(import.meta.url);
const MAX_SENTINEL_AGE_MS = 4 * 60 * 60 * 1000;
const MAX_RETRIES = 50;
const MAX_COUNT = 50;
const RESERVATION_TOKEN = Symbol('career-ops-report-reservation-token');

/** Format a report ID with a minimum width of three digits. */
export function formatReportNumber(num) {
  if (!Number.isSafeInteger(num) || num < 1) {
    throw new TypeError(`Report number must be a positive integer, got ${num}`);
  }
  return String(num).padStart(3, '0');
}

function reportsDirFor(options = {}) {
  return resolve(options.reportsDir
    || process.env.CAREER_OPS_REPORTS_DIR
    || join(options.rootDir || CAREER_OPS, 'reports'));
}

function trackerPathFor(options = {}) {
  return options.trackerPath
    ? canonicalizeTrackerPath(options.trackerPath)
    : resolveTrackerPath(options.rootDir || CAREER_OPS);
}

function trackerLockOptions(trackerPath, options = {}) {
  return {
    timeoutMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS) || 60_000,
    retryMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_RETRY_MS) || 75,
    staleMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_STALE_MS) || 10 * 60_000,
    tracker: trackerPath,
    ...options.lockOptions,
  };
}

// ── tracker report-number extraction ────────────────────────────────────────
// ponytail: tracker-parse.mjs (the shared home for tracker-row parsing used by
// merge-tracker/dedup-tracker/followup-cadence) doesn't yet export an
// extractTrackerReportNumbers() helper, and this port is scoped to this file
// only. Kept local for now; hoist to tracker-parse.mjs as a shared export
// (matching upstream career-ops 1.21.0) once that file is in scope, so this
// copy doesn't drift from the one other tracker readers would use.

/** Parse one Report-cell link destination (markdown `[label](target)` or `<target>`). */
function markdownLinkDestination(raw) {
  const value = String(raw).trimStart();
  if (value.startsWith('<')) {
    for (let i = 1; i < value.length; i++) {
      if (value[i] === '\\') {
        i++;
      } else if (value[i] === '>') {
        return value.slice(1, i).replace(/\\([\\()<> ])/g, '$1');
      }
    }
    return null;
  }

  let depth = 0;
  let end = value.length;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\') {
      i++;
      continue;
    }
    if (value[i] === '(') depth++;
    else if (value[i] === ')' && depth > 0) depth--;
    else if (/\s/.test(value[i]) && depth === 0) {
      end = i;
      break;
    }
  }
  const destination = value.slice(0, end).trim();
  return destination ? destination.replace(/\\([\\()<> ])/g, '$1') : null;
}

function parseMarkdownLinks(value) {
  const links = [];
  let cursor = 0;
  while (cursor < value.length) {
    const labelStart = value.indexOf('[', cursor);
    if (labelStart === -1) break;

    let labelEnd = -1;
    for (let i = labelStart + 1; i < value.length; i++) {
      if (value[i] === '\\') i++;
      else if (value[i] === ']') {
        labelEnd = i;
        break;
      }
    }
    if (labelEnd === -1 || value[labelEnd + 1] !== '(') {
      cursor = labelStart + 1;
      continue;
    }

    let depth = 1;
    let linkEnd = -1;
    for (let i = labelEnd + 2; i < value.length; i++) {
      if (value[i] === '\\') {
        i++;
      } else if (value[i] === '(') {
        depth++;
      } else if (value[i] === ')' && --depth === 0) {
        linkEnd = i;
        break;
      }
    }
    if (linkEnd === -1) {
      cursor = labelStart + 1;
      continue;
    }

    const target = markdownLinkDestination(value.slice(labelEnd + 2, linkEnd));
    if (target != null) links.push({ label: value.slice(labelStart + 1, labelEnd), target });
    cursor = linkEnd + 1;
  }
  return links;
}


// ── occupancy + slot claiming ────────────────────────────────────────────────

// A bare date file is not a report. `scan-ats-full.mjs --md-out reports/` writes
// its digest as `reports/YYYY-MM-DD.md`, which matches `/^(\d+)-/` and is read
// as report #2026 — pushing every later reservation to 2027+, silently and
// permanently.
//
// Deliberately narrow: report filenames in the wild are not all
// `NNN-slug-DATE.md` (`1001-taken.md` and `NNN-RESERVED.md` are both real), so
// requiring a trailing date would drop legitimate occupancy. Exclude only names
// that are *entirely* a date. See tests/reserve-report-num.test.mjs.
const BARE_DATE_FILE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;

function occupiedFromReports(reportsDir) {
  const occupied = new Set();
  if (!existsSync(reportsDir)) return occupied;
  for (const name of readdirSync(reportsDir)) {
    if (BARE_DATE_FILE_RE.test(name)) continue;
    const match = name.match(/^(\d+)-/);
    if (!match) continue;
    const num = parseInt(match[1], 10);
    if (Number.isInteger(num) && num > 0) occupied.add(num);
  }
  return occupied;
}

function occupiedFromTracker(trackerPath) {
  const occupied = new Set();
  if (!existsSync(trackerPath)) return occupied;

  const lines = readFileSync(trackerPath, 'utf-8').split(/\r?\n/);
  const colmap = resolveColumns(lines);
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (!row) continue;
    if (row.num > 0) occupied.add(row.num);
    for (const reportNum of extractTrackerReportNumbers(row.report)) {
      if (reportNum > 0) occupied.add(reportNum);
    }
  }
  return occupied;
}

function collectOccupied(reportsDir, trackerPath) {
  const occupied = occupiedFromReports(reportsDir);
  for (const num of occupiedFromTracker(trackerPath)) occupied.add(num);
  return occupied;
}

function highestNumber(numbers) {
  let max = 0;
  for (const num of numbers) max = Math.max(max, num);
  return max;
}

function sentinelPath(reportsDir, num) {
  return join(reportsDir, `${formatReportNumber(num)}-RESERVED.md`);
}

function claimSlot(reportsDir, num, occupied, token) {
  if (occupied.has(num)) return false;
  try {
    writeFileSync(sentinelPath(reportsDir, num), JSON.stringify({
      pid: process.pid,
      token,
      created_at: new Date().toISOString(),
    }), { flag: 'wx' }); // O_CREAT | O_EXCL — fails if the sentinel already exists.
    return true;
  } catch (err) {
    if (err?.code === 'EEXIST') return false; // another process beat us
    throw err; // unexpected FS error
  }
}

function readSentinelOwner(sentinel) {
  try {
    return JSON.parse(readFileSync(sentinel, 'utf-8'));
  } catch {
    return null;
  }
}

function releaseSlot(reportsDir, num, { token, force = false } = {}) {
  const sentinel = sentinelPath(reportsDir, num);
  try {
    if (!force && readSentinelOwner(sentinel)?.token !== token) return false;
    unlinkSync(sentinel);
    return true;
  } catch (err) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/**
 * Reserve one or more contiguous report IDs. All-or-nothing per attempt: if
 * any slot in the candidate range is already taken, release what was claimed
 * so far and restart past the highest known occupant. Each slot claim is
 * individually atomic (O_CREAT|O_EXCL) under the shared tracker lock, so two
 * racing reservations (or a reservation racing a tracker write) can't settle
 * on the same number. Skipped numbers become permanent gaps — report numbers
 * are opaque IDs, so gaps are harmless.
 *
 * @param {number} [count=1] Number of IDs to reserve (1-50).
 * @param {object} [options] Path and lock overrides.
 * @returns {Promise<number[]>} Reserved numeric IDs (array carries a hidden
 *   ownership token consumed by releaseReportNumbers()).
 */
export async function reserveReportNumbers(count = 1, options = {}) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    throw new RangeError(`Reservation count must be an integer from 1 to ${MAX_COUNT}`);
  }

  const reportsDir = reportsDirFor(options);
  const trackerPath = trackerPathFor(options);
  mkdirSync(reportsDir, { recursive: true });

  const lock = await acquireTrackerLock(
    lockDirFor(trackerPath, process.env.CAREER_OPS_TRACKER_LOCK),
    trackerLockOptions(trackerPath, options),
  );

  try {
    let occupied = collectOccupied(reportsDir, trackerPath);
    let base = highestNumber(occupied) + 1;
    const token = randomUUID();

    for (let tries = 0; tries < MAX_RETRIES; tries++) {
      const end = base + (count - 1);
      if (!Number.isSafeInteger(base) || !Number.isSafeInteger(end)) {
        throw new RangeError('No safe report-number range remains');
      }
      const claimed = [];
      let failedAt = null;
      for (let num = base; num <= end; num++) {
        if (claimSlot(reportsDir, num, occupied, token)) {
          claimed.push(num);
        } else {
          failedAt = num;
          break;
        }
      }
      if (failedAt == null) {
        Object.defineProperty(claimed, RESERVATION_TOKEN, { value: token });
        return claimed;
      }

      for (const num of claimed) releaseSlot(reportsDir, num, { token });
      occupied = collectOccupied(reportsDir, trackerPath);
      base = Math.max(failedAt + 1, highestNumber(occupied) + 1);
    }
  } finally {
    lock.release();
  }

  throw new Error(`Could not claim ${count} report slot(s) after ${MAX_RETRIES} retries`);
}

/**
 * Release reservation sentinels after report creation or on failure. Only the
 * array returned by reserveReportNumbers() owns its sentinels (its hidden
 * token authorizes release); `options.force: true` is the explicit
 * administrative override the `--release` CLI flag uses.
 */
export async function releaseReportNumbers(numbers, options = {}) {
  const reportsDir = reportsDirFor(options);
  const values = Array.isArray(numbers) ? numbers : [numbers];
  for (const num of values) {
    if (!Number.isSafeInteger(num) || num < 1) {
      throw new TypeError(`Report number must be a positive integer, got ${num}`);
    }
  }
  const force = options.force === true;
  const token = options.reservationToken || numbers?.[RESERVATION_TOKEN];
  if (!force && !token) throw new Error('Reservation ownership token is required for release');
  if (!existsSync(reportsDir)) return 0;

  const trackerPath = trackerPathFor(options);
  const lock = await acquireTrackerLock(
    lockDirFor(trackerPath, process.env.CAREER_OPS_TRACKER_LOCK),
    trackerLockOptions(trackerPath, options),
  );
  try {
    return values.reduce(
      (removed, num) => removed + Number(releaseSlot(reportsDir, num, { token, force })),
      0,
    );
  } finally {
    lock.release();
  }
}

/** Remove reservation sentinels older than the configured TTL. */
export async function gcStaleReportReservations(options = {}) {
  const reportsDir = reportsDirFor(options);
  if (!existsSync(reportsDir)) return 0;

  const trackerPath = trackerPathFor(options);
  const lock = await acquireTrackerLock(
    lockDirFor(trackerPath, process.env.CAREER_OPS_TRACKER_LOCK),
    trackerLockOptions(trackerPath, options),
  );
  const maxAgeMs = options.maxAgeMs ?? MAX_SENTINEL_AGE_MS;
  const now = Date.now();
  let removed = 0;
  try {
    for (const name of readdirSync(reportsDir)) {
      if (!/^\d+-RESERVED\.md$/.test(name)) continue;
      const fullPath = join(reportsDir, name);
      try {
        if (now - statSync(fullPath).mtimeMs > maxAgeMs) {
          const owner = readSentinelOwner(fullPath);
          if (owner?.pid && processIsAlive(owner.pid)) continue;
          unlinkSync(fullPath);
          removed++;
          process.stderr.write(`reserve-report-num: GC stale sentinel ${name}\n`);
        }
      } catch (err) {
        if (err?.code !== 'ENOENT') throw err;
      }
    }
  } finally {
    lock.release();
  }
  if (removed > 0) {
    process.stderr.write(`reserve-report-num: removed ${removed} stale sentinel(s)\n`);
  }
  return removed;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function runCli() {
  const [,, cmd, arg] = process.argv;
  const options = {};

  if (cmd === '--release') {
    const match = (arg || '').match(/^(\d{1,3})(?:-(\d{1,3}))?$/);
    if (!match) {
      process.stderr.write('Usage: node reserve-report-num.mjs --release <NNN>[-<MMM>]\n');
      return 1;
    }
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : start;
    const rangeCount = end - start + 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || start < 1 || end < start || rangeCount > MAX_COUNT) {
      process.stderr.write(`reserve-report-num: --release requires a safe ascending range of at most ${MAX_COUNT} slots\n`);
      return 1;
    }
    await releaseReportNumbers(
      Array.from({ length: rangeCount }, (_, index) => start + index),
      { ...options, force: true },
    );
    return 0;
  }

  if (cmd === '--gc') {
    await gcStaleReportReservations(options);
    return 0;
  }

  let count = 1;
  if (cmd === '--count') {
    if (!/^\d+$/.test(arg || '')) {
      process.stderr.write(`Usage: node reserve-report-num.mjs --count <1-${MAX_COUNT}>\n`);
      return 1;
    }
    count = parseInt(arg, 10);
    if (count < 1 || count > MAX_COUNT) {
      process.stderr.write(`Usage: node reserve-report-num.mjs --count <1-${MAX_COUNT}>\n`);
      return 1;
    }
  }
  // Any other/unknown cmd falls through to a single reserve — unchanged
  // legacy behavior.

  try {
    const numbers = await reserveReportNumbers(count, options);
    process.stdout.write(count === 1
      ? `${formatReportNumber(numbers[0])}\n`
      : `${formatReportNumber(numbers[0])}-${formatReportNumber(numbers[numbers.length - 1])}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`reserve-report-num: ${err.message}\n`);
    return 1;
  }
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  }
}

if (isDirectInvocation()) {
  process.exitCode = await runCli();
}
