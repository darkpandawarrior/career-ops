/**
 * dead-boards.mjs — persistent memory of which ATS boards are dead.
 *
 * scan-ats-full.mjs walks ~28k public directory slugs per sweep, of which ~46%
 * are permanently 404: companies that left the ATS, renamed, or never existed.
 * The scanner's DNS cache is in-process only, so without this file every sweep
 * re-probes all of them from scratch — that is both half the runtime and the
 * traffic that gets the sweep HTTP-throttled by the single-host ATSs
 * (boards-api.greenhouse.io, api.lever.co, api.ashbyhq.com each serve their
 * whole directory from ONE hostname). A throttled sweep silently loses live
 * boards, so pruning the dead ones is a correctness fix, not just a speed one.
 *
 * ONLY a 404 marks a board dead. A timeout, abort, 429 or 5xx means "we could
 * not tell" and is deliberately not recorded: letting one throttled run write
 * misses would permanently hide live boards, which is a far worse failure than
 * re-probing a dead one. That asymmetry is the load-bearing property here.
 *
 * A dead board is retried every RECHECK_AFTER_DAYS regardless, so a board that
 * comes back (company returns to the ATS, slug reused) is picked up rather than
 * blacklisted forever.
 *
 * Run tests: node dead-boards.test.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'fs';
import path from 'path';

/** Consecutive 404s before a board is skipped. >1 so a one-off ATS blip can't retire a board. */
export const DEAD_AFTER_MISSES = 3;

/** A skipped board is re-probed this often, so a revived board is never lost for good. */
export const RECHECK_AFTER_DAYS = 30;

const DAY_MS = 86_400_000;
const HEADER = ['ats', 'slug', 'misses', 'last_checked'].join('\t');

/**
 * Whether a fetch failure proves the board does not exist.
 *
 * Checks err.status first and falls back to the message, because providers
 * wrap errors on the way up and a wrapper can drop the numeric status while
 * keeping _http.mjs's `HTTP 404 ...` text.
 */
export function isDeadBoardError(err) {
  if (!err) return false;
  // A paged provider (providers/icims.mjs) marks `firstPage: false` when the board
  // had already answered page 1: a later-page 404 is not "no board here".
  if (err.firstPage === false) return false;
  if (err.status === 404) return true;
  if (err.cause?.status === 404) return true;
  return /(^|\s)HTTP 404(\s|$)/.test(String(err.message ?? ''));
}

/** Stable key for one board within one ATS. */
export function boardKey(ats, slug) {
  return `${ats}|${slug}`;
}

/**
 * Parse the TSV store. Unreadable or malformed rows are dropped rather than
 * throwing: a corrupt liveness file must degrade to "re-probe everything",
 * never abort a sweep.
 */
export function parseDeadBoards(text) {
  const map = new Map();
  for (const line of String(text ?? '').split('\n')) {
    if (!line || line.startsWith('#') || line === HEADER) continue;
    const [ats, slug, misses, lastChecked] = line.split('\t');
    if (!ats || !slug) continue;
    const n = Number(misses);
    const t = Date.parse(lastChecked);
    if (!Number.isInteger(n) || n <= 0 || !Number.isFinite(t)) continue;
    map.set(boardKey(ats, slug), { ats, slug, misses: n, lastChecked: t });
  }
  return map;
}

/** Serialize back to TSV, sorted so the file diffs cleanly between runs. */
export function serializeDeadBoards(map) {
  const rows = [...map.values()]
    .sort((a, b) => (a.ats === b.ats ? a.slug.localeCompare(b.slug) : a.ats.localeCompare(b.ats)))
    .map(r => [r.ats, r.slug, r.misses, new Date(r.lastChecked).toISOString()].join('\t'));
  return [HEADER, ...rows].join('\n') + '\n';
}

/**
 * Whether this board can be skipped on this sweep: confirmed dead enough times
 * AND not yet due for its periodic re-probe.
 */
export function shouldSkip(rec, now, deadAfter = DEAD_AFTER_MISSES, recheckDays = RECHECK_AFTER_DAYS) {
  if (!rec) return false;
  if (rec.misses < deadAfter) return false;
  return (now - rec.lastChecked) < recheckDays * DAY_MS;
}

/** Record a confirmed 404. Only ever called for isDeadBoardError() failures. */
export function recordMiss(map, ats, slug, now) {
  const key = boardKey(ats, slug);
  const prev = map.get(key);
  map.set(key, { ats, slug, misses: (prev?.misses ?? 0) + 1, lastChecked: now });
  return map;
}

/**
 * Record a board that answered. Dropping the row rather than zeroing it keeps
 * the file proportional to the dead set instead of the whole 28k directory.
 */
export function recordHit(map, ats, slug) {
  map.delete(boardKey(ats, slug));
  return map;
}

export function loadDeadBoards(file) {
  if (!existsSync(file)) return new Map();
  try {
    return parseDeadBoards(readFileSync(file, 'utf-8'));
  } catch {
    return new Map(); // corrupt store → re-probe everything, never abort
  }
}

/** Atomic write: a crash mid-write must not leave a truncated store behind. */
export function saveDeadBoards(file, map) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, serializeDeadBoards(map), 'utf-8');
  renameSync(tmp, file);
}
