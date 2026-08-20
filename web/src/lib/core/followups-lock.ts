import { acquireTrackerLock, lockDirFor } from "@/lib/core/tracker-lock";

/**
 * ACL for locking `data/follow-ups.md` across processes.
 *
 * WHY A WEB ROUTE NEEDS IT. `data/follow-ups.md` is a read-modify-write from
 * two directions: the web's log/override routes AND the core's cadence seeder
 * (`followup-seed.mjs`). `atomicWrite` makes the WRITE atomic, not the
 * read-modify-write around it — two writers each read the whole file, each
 * edit, each rename their full copy back, and one change silently reverts.
 * Same failure family as the tracker (#2900), same cure.
 *
 * NOT `withLogLock` (followups-server.ts): that is an in-process promise queue.
 * It serializes THIS process's own requests and is blind to the user's CLI —
 * "no cross-process lock needed" is true for web-vs-web and false for
 * web-vs-seeder. Two guards, different scopes; they compose (see
 * `withFollowupsWrite`), neither substitutes for the other.
 *
 * WE REUSE THE TRACKER LOCK'S PROTOCOL, NOT A DYNAMIC IMPORT OF THE CORE
 * SCRIPT. Upstream wires this by `await import(pathToFileURL(...))`-ing
 * `followup-seed.mjs` and calling its exported `withFollowupsLock`. This fork's
 * `core/tracker-lock.ts` already made the opposite call for the exact same
 * reason (see its own header): root-level `.mjs` scripts are only ever invoked
 * as subprocesses here, never imported into a route module — a fully dynamic
 * `import()` of an absolute path outside `web/` is invisible to Next's file
 * tracer and would ENOENT under `output: standalone` production builds even
 * though it works under `next dev`.
 *
 * That reimplementation is directly reusable here rather than needing its own
 * copy: `lockDirFor` is keyed by a sha256 of the CANONICALIZED PATH being
 * locked, with a fixed prefix — not specific to applications.md. And the
 * fork's own `followup-seed.mjs` already takes the identical lock, on the
 * identical derivation, imported straight from `tracker-lock.mjs`/
 * `tracker-utils.mjs` (see that script's own header: "Locking reuses
 * tracker-lock.mjs's acquireTrackerLock/lockDirFor ... one lock
 * implementation, two files"). So `acquireTrackerLock(lockDirFor(followupsPath))`
 * is already the correct cross-process exclusion for follow-ups.md — there is
 * no separate protocol left to port.
 *
 * THE LOCK IS NOT REENTRANT (no owner/pid self-check). A caller holding it must
 * never orchestrate a core script that also takes it — that self-deadlocks
 * until the timeout. Our two routes write the file DIRECTLY, so this is safe
 * today; it is a rule for any future followups writer that shells out.
 */

/** Thrown when the lock is held by someone else for longer than we will wait. */
export class FollowupsBusyError extends Error {
  constructor() {
    super("follow-ups file is being written by another process");
    this.name = "FollowupsBusyError";
  }
}

/**
 * Run `fn` holding the cross-process follow-ups lock, releasing it on EVERY
 * path. When the lock is contended past the web timeout, throws
 * `FollowupsBusyError` so the route can answer 409 rather than hang.
 *
 * The web timeout is deliberately far shorter than the CLI's default: a
 * minute of silence inside an HTTP handler is indistinguishable from a hang, so
 * we fail fast and answer the caller "busy, retry" instead.
 *
 * @param followupsPath absolute path to data/follow-ups.md
 * @param fn the read-modify-write to run under the lock
 */
export async function withFollowupsLock<T>(followupsPath: string, fn: () => T | Promise<T>): Promise<T> {
  let lock: { release: () => void };
  try {
    lock = await acquireTrackerLock(lockDirFor(followupsPath), {
      timeoutMs: Number(process.env.CAREER_OPS_WEB_FOLLOWUPS_LOCK_TIMEOUT_MS) || 5_000,
      tracker: followupsPath,
    });
  } catch {
    // acquireTrackerLock only ever throws from the acquire itself (timeout),
    // never from fn — so this is unambiguously "couldn't get the lock".
    throw new FollowupsBusyError();
  }
  try {
    return await fn();
  } finally {
    lock.release();
  }
}
