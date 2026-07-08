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

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync, realpathSync } from 'fs';
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
 * Decide whether an existing lock can be safely recovered (owner process is
 * dead, or the lock is older than staleMs and has no readable owner metadata).
 * @param {string} lockDir
 * @param {number} staleMs
 * @returns {boolean}
 */
function lockCanRecover(lockDir, staleMs) {
  const owner = readLockOwner(lockDir);
  if (owner?.pid) return !processIsAlive(owner.pid);

  try {
    return Date.now() - statSync(lockDir).mtimeMs > staleMs;
  } catch {
    return true;
  }
}

/**
 * Acquire an exclusive filesystem lock for one tracker read-modify-write.
 *
 * @param {string} lockDir - Directory path used as the lock sentinel.
 * @param {object} [options] - Lock timing options.
 * @param {number} [options.timeoutMs=60000] - Maximum time to wait for the lock.
 * @param {number} [options.retryMs=75] - Delay between acquisition attempts.
 * @param {number} [options.staleMs=600000] - Metadata-free stale-lock threshold.
 * @param {string} [options.tracker] - Tracker path recorded in owner.json (diagnostics only).
 * @returns {Promise<{attempts:number,waitMs:number,staleRecovered:boolean,release:Function}>}
 */
export async function acquireTrackerLock(lockDir, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const retryMs = options.retryMs ?? 75;
  const staleMs = options.staleMs ?? 10 * 60_000;
  const recoverGuardDir = `${lockDir}.recover`;
  const token = randomUUID();
  const startedAt = Date.now();
  let attempts = 0;
  let staleRecovered = false;

  while (Date.now() - startedAt < timeoutMs) {
    attempts++;
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({
        pid: process.pid,
        token,
        started_at: new Date().toISOString(),
        tracker: options.tracker ?? null,
      }, null, 2));

      let released = false;
      return {
        attempts,
        waitMs: Date.now() - startedAt,
        staleRecovered,
        release() {
          if (released) return;
          released = true;
          const owner = readLockOwner(lockDir);
          if (owner?.token === token) {
            rmSync(lockDir, { recursive: true, force: true });
          }
        },
      };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;

      let hasRecoverGuard = false;
      try {
        mkdirSync(recoverGuardDir);
        hasRecoverGuard = true;
      } catch (guardErr) {
        if (guardErr?.code !== 'EEXIST') throw guardErr;
      }

      if (hasRecoverGuard) {
        try {
          if (lockCanRecover(lockDir, staleMs)) {
            rmSync(lockDir, { recursive: true, force: true });
            staleRecovered = true;
            continue;
          }
        } finally {
          rmSync(recoverGuardDir, { recursive: true, force: true });
        }
      }

      await sleep(retryMs);
    }
  }

  const timeoutErr = new Error(`Timed out waiting for tracker merge lock at ${lockDir}`);
  timeoutErr.code = 'LOCK_TIMEOUT';
  throw timeoutErr;
}

/**
 * Convert a tracker path into one stable absolute spelling before hashing it,
 * so all processes targeting the same tracker also target the same lock dir.
 *
 * @param {string} path - Raw tracker path from config, env, or the default.
 * @returns {string} Absolute canonical path when the file exists, else resolved path.
 */
export function canonicalizeTrackerPath(path) {
  const absolutePath = resolve(path);
  try {
    return realpathSync(absolutePath);
  } catch {
    return absolutePath;
  }
}
