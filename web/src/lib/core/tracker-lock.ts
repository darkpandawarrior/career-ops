import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

/**
 * ACL for the cross-process tracker lock. This is a PARALLEL TypeScript
 * implementation of the engine's tracker-lock.mjs — not a literal import.
 * Root-level `.mjs` scripts in this repo are only ever invoked from web/ as
 * subprocesses (see `@/lib/career-ops`'s `rootScript()`/`engineScript()`),
 * never imported directly into a route module, and the web app runs as a
 * separate long-lived Next.js process from any CLI script anyway — so a
 * filesystem lock is the only mechanism that can coordinate them, same
 * language or not.
 *
 * Both sides MUST agree on:
 *   - the lock directory path for a given tracker file (sha256(realpath) under
 *     the OS temp dir, prefixed `career-ops-merge-tracker-`)
 *   - the acquire protocol (mkdirSync + owner.json + retry/backoff/stale-recovery)
 *   - the release protocol (only the token-matching owner may remove the lock)
 * If you change one side's protocol, change the other (career-ops/tracker-lock.mjs)
 * the same way.
 */

type LockHandle = {
  attempts: number;
  waitMs: number;
  staleRecovered: boolean;
  release: () => void;
};

type AcquireOptions = {
  timeoutMs?: number;
  retryMs?: number;
  staleMs?: number;
  tracker?: string;
};

/** Canonicalize a tracker path the same way the engine side does (realpath when it exists). */
function canonicalizeTrackerPath(p: string): string {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

/** Deterministic lock directory for a tracker file — same derivation as career-ops/tracker-lock.mjs. */
export function lockDirFor(appsFile: string): string {
  const lockKey = crypto.createHash("sha256").update(canonicalizeTrackerPath(appsFile)).digest("hex").slice(0, 16);
  const tmpRoot = fs.realpathSync(os.tmpdir());
  return path.join(tmpRoot, `career-ops-merge-tracker-${lockKey}.lock`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

function readLockOwner(lockDir: string): { pid?: number; token?: string } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

function lockCanRecover(lockDir: string, staleMs: number): boolean {
  const owner = readLockOwner(lockDir);
  if (owner?.pid) return !processIsAlive(owner.pid);
  try {
    return Date.now() - fs.statSync(lockDir).mtimeMs > staleMs;
  } catch {
    return true;
  }
}

/** One non-blocking acquisition attempt. Returns a handle on success, or a
 *  reason to retry ("held" = someone else's live lock; "recovered-stale" =
 *  we just cleared a dead owner's lock, caller should immediately retry). */
function tryAcquireOnce(lockDir: string, staleMs: number, token: string, tracker: string | null):
  | { ok: true; release: () => void }
  | { ok: false; reason: "held" | "recovered-stale" } {
  const recoverGuardDir = `${lockDir}.recover`;
  try {
    fs.mkdirSync(lockDir);
    fs.writeFileSync(
      path.join(lockDir, "owner.json"),
      JSON.stringify({ pid: process.pid, token, started_at: new Date().toISOString(), tracker }, null, 2),
    );
    let released = false;
    return {
      ok: true,
      release() {
        if (released) return;
        released = true;
        const owner = readLockOwner(lockDir);
        if (owner?.token === token) {
          fs.rmSync(lockDir, { recursive: true, force: true });
        }
      },
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;

    let hasRecoverGuard = false;
    try {
      fs.mkdirSync(recoverGuardDir);
      hasRecoverGuard = true;
    } catch (guardErr) {
      if ((guardErr as NodeJS.ErrnoException)?.code !== "EEXIST") throw guardErr;
    }

    if (hasRecoverGuard) {
      try {
        if (lockCanRecover(lockDir, staleMs)) {
          fs.rmSync(lockDir, { recursive: true, force: true });
          return { ok: false, reason: "recovered-stale" };
        }
      } finally {
        fs.rmSync(recoverGuardDir, { recursive: true, force: true });
      }
    }
    return { ok: false, reason: "held" };
  }
}

/**
 * Acquire the exclusive tracker lock. Bounded by `timeoutMs` (default 8s) —
 * short on purpose: a web request must fail fast with a clear error rather
 * than hang indefinitely behind a batch run's lock.
 */
export async function acquireTrackerLock(lockDir: string, options: AcquireOptions = {}): Promise<LockHandle> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const retryMs = options.retryMs ?? 75;
  const staleMs = options.staleMs ?? 10 * 60_000;
  const token = crypto.randomUUID();
  const startedAt = Date.now();
  let attempts = 0;
  let staleRecovered = false;

  while (Date.now() - startedAt < timeoutMs) {
    attempts++;
    const result = tryAcquireOnce(lockDir, staleMs, token, options.tracker ?? null);
    if (result.ok) {
      return { attempts, waitMs: Date.now() - startedAt, staleRecovered, release: result.release };
    }
    if (result.reason === "recovered-stale") {
      staleRecovered = true;
      continue;
    }
    await sleep(retryMs);
  }

  throw new Error(`Timed out waiting for tracker lock at ${lockDir}`);
}

/**
 * Convenience wrapper: acquire the lock for `appsFile`, run `fn`, always
 * release. Use this from route handlers instead of calling acquire/release
 * directly so a thrown error can never leak a held lock.
 *
 * Deliberately async-only, no sync variant: a synchronous busy-wait (e.g. via
 * Atomics.wait) would block the ENTIRE Next.js request-handling thread while
 * waiting for a batch run's lock, freezing every other concurrent request —
 * worse than the race this module exists to fix. Callers that are currently
 * synchronous (setAppCell) become async instead.
 */
export async function withTrackerLock<T>(appsFile: string, fn: () => Promise<T> | T, options: AcquireOptions = {}): Promise<T> {
  const lock = await acquireTrackerLock(lockDirFor(appsFile), { ...options, tracker: appsFile });
  try {
    return await fn();
  } finally {
    lock.release();
  }
}
