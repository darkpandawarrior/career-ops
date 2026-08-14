#!/usr/bin/env node
/**
 * tracker-lock.mjs — shared exclusive filesystem lock for data/applications.md.
 *
 * Extracted from merge-tracker.mjs so every writer of the tracker — the batch
 * merge (merge-tracker.mjs), the single-row CLI (set-status.mjs), and the
 * Next.js dashboard's status API (web/src/app/api/status/route.ts via
 * web/src/lib/core/tracker-lock.ts) — can hold the SAME lock instead of racing
 * each other silently (last writer wins, no error). See #(tracker-lock).
 *
 * Mechanism: atomic `mkdirSync` (throws EEXIST if the dir already exists — the
 * same cross-process exclusivity a `wx`-flag sentinel file gives, but a
 * directory also lets us drop an `owner.json` alongside it for stale-lock
 * detection). Retry/backoff while another process holds it; recover the lock
 * if its owner PID is dead (crash) or, when no PID is readable, if the lock
 * directory itself is older than a stale threshold.
 *
 * The Next.js side (web/src/lib/core/tracker-lock.ts) is a PARALLEL TypeScript
 * implementation of this exact protocol, not a literal import of this file —
 * root-level .mjs scripts are only ever invoked from web/ as subprocesses (see
 * web/src/lib/career-ops.ts's rootScript()/engineScript()), never imported
 * directly into a route module. Both sides MUST agree on:
 *   - the lock directory path for a given tracker file (sha256(APPS_FILE) under
 *     the OS temp dir, see lockDirFor() below)
 *   - the acquire protocol (mkdirSync + owner.json + retry/backoff/stale-recovery)
 *   - the release protocol (only the token-matching owner may remove the lock)
 * If you change one side's protocol, change the other the same way.
 */

import {
  readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync, realpathSync, renameSync,
} from 'fs';
import { join, dirname, basename, resolve, relative, isAbsolute, sep } from 'path';
import { createHash, randomUUID } from 'crypto';
import { tmpdir } from 'os';

/**
 * Derive the deterministic lock directory for a tracker file path.
 *
 * @param {string} appsFile - Absolute (canonical) path to applications.md.
 * @param {string|undefined} envOverride - Optional CAREER_OPS_TRACKER_LOCK override.
 * @returns {string} Safe lock directory path.
 */
export function lockDirFor(appsFile, envOverride) {
  const lockKey = createHash('sha256').update(appsFile).digest('hex').slice(0, 16);
  return resolveTrackerLockDir(envOverride, lockKey);
}

/**
 * Validate and resolve the tracker lock directory.
 *
 * `CAREER_OPS_TRACKER_LOCK` exists for tests and unusual local layouts, but lock
 * release removes the lock directory recursively. To keep that safe, env-provided
 * lock paths must be absolute, live under the OS temp directory, and use the
 * career-ops lock-name prefix. Invalid values are ignored and the deterministic
 * temp-dir default is used instead.
 *
 * @param {string|undefined} envValue - Optional lock path override.
 * @param {string} lockKey - Stable tracker hash suffix.
 * @returns {string} Safe lock directory path.
 */
function resolveTrackerLockDir(envValue, lockKey) {
  const tmpRoot = realpathSync(tmpdir());
  const fallback = join(tmpRoot, `career-ops-merge-tracker-${lockKey}.lock`);
  if (!envValue || !isAbsolute(envValue)) return fallback;

  const candidate = resolve(envValue);
  const parentDir = dirname(candidate);
  const canonicalParent = existsSync(parentDir) ? realpathSync(parentDir) : resolve(parentDir);
  if (!pathIsInside(canonicalParent, tmpRoot)) return fallback;
  if (!basename(candidate).startsWith('career-ops-merge-tracker-')) return fallback;
  return candidate;
}

/**
 * Check whether one absolute path stays inside another directory.
 *
 * @param {string} childPath - Candidate path to validate.
 * @param {string} parentDir - Required parent directory boundary.
 * @returns {boolean} True when childPath is inside parentDir or equal to it.
 */
function pathIsInside(childPath, parentDir) {
  const relativePath = relative(parentDir, childPath);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

/**
 * Pause for a fixed number of milliseconds (lock retry backoff).
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

/**
 * Determine whether a process id still belongs to a live process.
 * @param {number} pid
 * @returns {boolean}
 */
function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/**
 * Read lock ownership metadata from a tracker lock directory.
 * @param {string} lockDir
 * @returns {object|null}
 */
function readLockOwner(lockDir) {
  try {
    return JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Minimum age before directory age alone may condemn an ownerless lock or
 * recover guard. See `lockCanRecover` for why the age check needs a floor.
 */
export const OWNERLESS_GRACE_MS = 1_000;

/**
 * Decide whether an existing lock can be safely recovered (owner process is
 * dead, or the lock is older than staleMs and has no readable owner metadata).
 *
 * That age fallback needs a floor. A directory can be ownerless by
 * construction, not by accident: a lock between its `mkdirSync` and its
 * `owner.json` write. Judging it on `age > staleMs` alone lets a caller with
 * an aggressive staleMs delete a directory created microseconds ago, stealing
 * a winner's lock inside its acquisition window. OWNERLESS_GRACE_MS is a
 * lower bound on that patience, never a cap: a larger caller staleMs still
 * wins, and a genuinely abandoned directory still ages out.
 * @param {string} lockDir
 * @param {number} staleMs - Age threshold for metadata-free lock recovery, floored at OWNERLESS_GRACE_MS.
 * @returns {boolean}
 */
function lockCanRecover(lockDir, staleMs) {
  const owner = readLockOwner(lockDir);
  if (owner?.pid) return !processIsAlive(owner.pid);

  try {
    return Date.now() - statSync(lockDir).mtimeMs > Math.max(staleMs, OWNERLESS_GRACE_MS);
  } catch {
    return true;
  }
}

/**
 * Compare two stat() results for the SAME lock directory identity, not just
 * the same path spelling — dev+ino, falling back to birthtime when a
 * filesystem/platform reports ino as 0. Guards release() against removing a
 * lock directory that a different owner deleted and recreated between our
 * last read and the actual rmSync call (see acquireTrackerLock's release()).
 *
 * @param {import('fs').Stats} left
 * @param {import('fs').Stats} right
 * @returns {boolean}
 */
function sameLockDirectory(left, right) {
  return left.dev === right.dev && left.ino === right.ino
    && (left.ino !== 0 || left.birthtimeMs === right.birthtimeMs);
}



// Atomic replace via a same-directory temp file + rename — mirrors the
// per-script writeFileAtomic() duplicated across tracker.mjs, merge-tracker.mjs,
// set-status.mjs, etc., so a reader can never observe a partially written file.
function writeTrackerFileAtomic(filePath, content) {
  const tmp = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, filePath);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

