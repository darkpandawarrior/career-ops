import path from "node:path";
import { requestRoot } from "@/lib/profile-registry";

// Server-only helpers shared by the follow-ups API routes (log + override).

/**
 * data/follow-ups.md — the follow-up log + next-date pins (user layer).
 *
 * Resolved through requestRoot() rather than careerOpsRoot(): this fork is
 * multi-profile, so the log lives under the *active profile's* data root, not
 * the engine checkout.
 */
export async function followupsLogPath(): Promise<string> {
  return path.join(await requestRoot(), "data", "follow-ups.md");
}

// Serialize every mutation of the log file across routes: POST log derives the
// next num from a read of the file, DELETE and the override routes do
// read-modify-write — unserialized, concurrent requests could mint duplicate
// nums or drop lines. The web app is a single local server process, so an
// in-process queue is sufficient — no cross-process lock needed.
let queue: Promise<unknown> = Promise.resolve();
export function withLogLock<T>(fn: () => T): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
