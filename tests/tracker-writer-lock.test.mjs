// tests/tracker-writer-lock.test.mjs — regression coverage for the shared
// applications.md writer lock, ported from upstream career-ops a953da2 (#1912,
// "serialize all tracker writers through the shared lock") into this fork's
// tests/*.test.mjs convention. Upstream shipped its version as a top-level
// tracker-writer-lock-tests.mjs with its own hard-exit call; that file is not
// reintroduced here — the scenarios below run inside test-all.mjs's shared
// pass/fail counters instead. Upstream's Go dashboard-side coverage is skipped
// entirely: this fork has no dashboard/ (retired, gitignored prebuilt binary
// only).
//
// dedup-tracker.mjs, normalize-statuses.mjs, reply-watch.mjs, and tracker.mjs's
// export/delete now all serialize their read-modify-write through
// openTrackerTransaction() (tracker-lock.mjs) instead of racing each other with
// unlocked fs.readFileSync/writeFileSync calls. Two things matter per writer:
// it actually blocks while another process holds the lock (never silently
// interleaves), and once the lock is free it reads the FRESH content — not a
// stale pre-lock snapshot — before writing back.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { spawn } from 'child_process';
import {
  existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync,
  writeFileSync,
} from 'fs';
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

console.log('\ntracker writer lock (a953da2 #1912 — shared lock serialization)');

const { acquireTrackerLock, openTrackerTransaction } =
  await import(pathToFileURL(join(ROOT, 'tracker-lock.mjs')).href);

const CONCURRENT_ROW = '| 99 | 2026-01-03 | ConcurrentCo | Keeper | 4.3/5 | Applied | ❌ | [99](reports/099-concurrent.md) | preserve me |';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// Run-level evidence that acquireTrackerLock still emits its recover guard.
// See the consumer inside runWhileLocked for why this is counted per run
// rather than asserted per case (#2436).
let contentionWatchedCases = 0;
let contentionObservedCases = 0;

// How long the HARNESS waits for a spawned Node process to start, print, or
// exit. This is not a value under test: it encodes only how fast the machine
// is, and every other suite that spawns a child budgets 30s for the same work
// (tests/helpers.mjs's run(), followup-seed). A CI runner under load routinely
// needs more than the 2s this file used to allow, which made a correctness
// test fail for want of a faster host.
//
// Every SEMANTIC timeout stays exactly as it was: the argument to
// launchWriter() is the child's CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS, and
// timeoutMs / staleMs / retryMs are the lock's own parameters. Those are what
// the tests assert on, so widening them would change what is being tested.
const HARNESS_WAIT_MS = 30_000;

// How long to wait for evidence that the spawned writer has reached the lock
// before committing the concurrent row. Bounded, and not a value under test:
// see watchForContention() for why the wait exists and what happens when the
// evidence never arrives.
const CONTENTION_WAIT_MS = 2_000;

/**
 * Watch for evidence that a spawned writer has attempted the tracker lock and
 * lost — i.e. that it is now sitting in the retry loop.
 *
 * WHY THIS EXISTS: the fixture mutation below is what a writer with a stale
 * pre-lock snapshot erases, so it only discriminates if it lands AFTER that
 * writer's read. Committing it immediately after spawn() does not: a fresh
 * Node process needs tens of milliseconds just to boot, so the row is already
 * on disk before a buggy writer reads, and the buggy writer then reads the
 * post-mutation file and passes. That was verified, not assumed — hoisting
 * set-status.mjs's readFileSync above its acquireTrackerLockForCli call left
 * this suite fully green until this wait was added.
 *
 * The signal is the lock's recover-guard directory: acquireTrackerLock creates
 * and removes `${lockDir}.recover` on every contended pass, so its first
 * appearance means "this child has tried the lock and someone else holds it".
 * That instant sits after a pre-lock read and before a post-lock one, which is
 * exactly the discrimination the mutation needs.
 *
 * This POLLS rather than using fs.watch. On Windows, fs.watch aborts the whole
 * process with a libuv assertion (`!_wcsnicmp(filename, dir, dirlen)`,
 * src\win\fs-event.c) when the watched directory is reached through an 8.3
 * short path — which is exactly what CI runners use (C:\Users\RUNNER~1\...),
 * so the watcher version killed this suite with exit 3221226505 on
 * windows-latest while passing locally. The guard is created and removed on
 * every contended retry, not once, so a poll gets many chances to observe it.
 *
 * It is a bounded wait, never a barrier. If no guard ever appears — a lock
 * implementation that stops using the guard, or a writer that legitimately
 * does other work first — the mutation proceeds anyway once
 * CONTENTION_WAIT_MS elapses and the test degrades to its previous
 * timing-dependent behaviour instead of hanging.
 *
 * @param {string} dir - Directory containing the lock.
 * @param {string} lockDir - The lock directory whose recover guard signals contention.
 * @returns {{wait: (timeoutMs: number) => Promise<boolean>, close: () => void}}
 */
function watchForContention(dir, lockDir) {
  const guardPrefix = `${basename(lockDir)}.recover`;
  const guardPresent = () => {
    try {
      return readdirSync(dir).some((name) => name.startsWith(guardPrefix));
    } catch {
      return false; // directory vanished mid-run; the timed fallback stands in
    }
  };
  return {
    async wait(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      let seen = false;
      while (!(seen = guardPresent()) && Date.now() < deadline) await sleep(2);
      return seen;
    },
    close() {},
  };
}

function trackerTable(rows) {
  return `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
${rows.join('\n')}
`;
}

// Run one writer script while this process holds the tracker lock externally,
// then release it mid-run and confirm the writer (a) actually contended on
// the lock instead of reading/writing around it, and (b) picks up the row a
// concurrent writer committed while it was waiting.
async function runWhileLocked({
  name, script, args = [], content, stdin = '', candidates = null, verify,
  mutateWhileLocked, verifyConcurrent = after => after.includes(CONCURRENT_ROW),
  verifyOutput = () => true, completion = 'completes the intended update after lock release',
  beforeMutationOutput = null,
}) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-writer-lock-'));
  const tracker = join(dir, 'applications.md');
  const lockDir = join(dir, `career-ops-merge-tracker-${name}.lock`);
  const db = join(dir, 'applications.db');
  writeFileSync(tracker, content);

  if (name.startsWith('reply-watch')) {
    const candidatesFile = join(dir, 'candidates.json');
    writeFileSync(candidatesFile, JSON.stringify(candidates || [{
      message_id: 'reply-1',
      from: 'hr@acme.com',
      subject: 'Unfortunately, an update on your Acme Engineer application',
      body_snippet: 'We decided not to proceed with your application.',
      signal: 'rejection',
    }]));
    args = [candidatesFile];
  }

  const childEnv = {
    ...process.env,
    CAREER_OPS_TRACKER: tracker,
    CAREER_OPS_TRACKER_DB: db,
    CAREER_OPS_TRACKER_LOCK: lockDir,
    CAREER_OPS_TRACKER_LOCK_RETRY_MS: '20',
  };
  const launchWriter = (timeoutMs) => {
    let stdout = '';
    let stderr = '';
    const resolvedArgs = args.map(arg => arg === '{tracker}' ? tracker : arg);
    const child = spawn(NODE, [join(ROOT, script), ...resolvedArgs], {
      cwd: ROOT,
      env: { ...childEnv, CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: String(timeoutMs) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const closePromise = new Promise(resolve => child.once('close', code => resolve({ code })));
    child.stdin.end(stdin);
    return { child, closePromise, output: () => ({ stdout, stderr }) };
  };
  const waitForWriter = async (run, timeoutMs) => {
    let result = await Promise.race([run.closePromise, sleep(timeoutMs).then(() => null)]);
    if (result === null) {
      run.child.kill('SIGKILL');
      result = await run.closePromise;
      return { ...result, timedOut: true };
    }
    return { ...result, timedOut: false };
  };

  const lock = await acquireTrackerLock(lockDir, {
    timeoutMs: 2_000, retryMs: 20, staleMs: 5_000, tracker,
  });

  const probe = launchWriter(200);
  const probeResult = await waitForWriter(probe, HARNESS_WAIT_MS);
  const probeOutput = probe.output();
  if (!probeResult.timedOut && probeResult.code !== 0
      && `${probeOutput.stdout}${probeOutput.stderr}`.includes('Timed out waiting for tracker')
      && readFileSync(tracker, 'utf-8') === content) {
    pass(`${name}: contends on the shared lock before reading or writing`);
  } else {
    fail(`${name}: lock contention probe failed (exit=${probeResult.code}, timedOut=${probeResult.timedOut})\n${probeOutput.stdout}${probeOutput.stderr}`);
  }

  // Watching starts before the real writer launches and after the probe has
  // exited, so the only guard events it can see are the writer's own.
  const contention = beforeMutationOutput ? null : watchForContention(dir, lockDir);
  const run = launchWriter(3_000);

  try {
    if (beforeMutationOutput) {
      const deadline = Date.now() + HARNESS_WAIT_MS;
      while (!run.output().stdout.includes(beforeMutationOutput) && Date.now() < deadline) {
        await sleep(10);
      }
      if (!run.output().stdout.includes(beforeMutationOutput)) {
        fail(`${name}: did not reach the pre-lock review prompt before the fixture mutation`);
      }
    }
    // Order the mutation after the writer's own read. beforeMutationOutput
    // entries already have a stronger, script-specific ordering signal (their
    // pre-lock review prompt), and a writer parked at that prompt has not
    // reached the lock yet, so the guard wait is skipped for them.
    //
    // The boolean IS the discrimination signal, so it is consumed rather than
    // discarded (#2436) — but at RUN level, not per case, and the difference
    // is not a softening. `acquireTrackerLock` creates the guard and removes
    // it in a `finally` around one `lockCanRecover()` call, so it exists for
    // well under a millisecond, re-created on each ~retryMs attempt. The
    // watcher samples with readdirSync, so a single miss means "the sampler
    // was unlucky", not "the guard is gone" — and on Windows CI it misses
    // often enough that a per-case failure would be red on a healthy tree
    // (measured: 3 of 8 observed).
    //
    // Across a whole run the two causes separate cleanly: a sampling miss
    // still leaves other cases observing the guard, while the regression this
    // must catch — the guard renamed, removed, or made conditional — takes
    // every case to zero. That is asserted after the matrix.
    if (contention) {
      contentionWatchedCases++;
      if (await contention.wait(CONTENTION_WAIT_MS)) contentionObservedCases++;
      else console.log(`NOTE ${name}: recover guard not sampled within ${CONTENTION_WAIT_MS}ms — fell back to timing-dependent ordering for this case`);
    }
    // Simulate the current lock owner committing another row. The waiting
    // writer must read this fresh version after acquiring the lock; a writer
    // that reads before locking would erase row #99 with its stale snapshot.
    const nextContent = mutateWhileLocked
      ? mutateWhileLocked(content, CONCURRENT_ROW)
      : `${content.trimEnd()}\n${CONCURRENT_ROW}\n`;
    writeFileSync(tracker, nextContent);
  } finally {
    contention?.close();
    lock.release();
  }

  const result = await waitForWriter(run, HARNESS_WAIT_MS);
  const { stdout, stderr } = run.output();
  const after = existsSync(tracker) ? readFileSync(tracker, 'utf-8') : '';
  if (!result.timedOut && result.code === 0 && verify(after)
      && verifyConcurrent(after) && verifyOutput(stdout, stderr, tracker)) {
    pass(`${name}: ${completion}`);
  } else {
    fail(`${name}: update failed after lock release (exit=${result.code})\n${stdout}${stderr}\n${after}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

await runWhileLocked({
  name: 'normalize-statuses',
  script: 'normalize-statuses.mjs',
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Aplicado | ❌ | [1](reports/001-acme.md) | seed |',
  ]),
  verify: content => content.includes('| Applied |'),
  verifyOutput: (stdout, _stderr, tracker) => stdout.includes(`Written to ${realpathSync(tracker)}`)
    && stdout.includes(`${realpathSync(tracker)}.bak`),
});

await runWhileLocked({
  name: 'dedup-tracker',
  script: 'dedup-tracker.mjs',
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [1](reports/001-acme.md) | first |',
    '| 2 | 2026-01-02 | Acme | Engineer | 3.0/5 | Evaluated | ❌ | [2](reports/002-acme.md) | duplicate |',
  ]),
  verify: content => (content.match(/\| Acme \| Engineer \|/g) || []).length === 1,
  verifyOutput: (stdout, _stderr, tracker) => stdout.includes(`Written to ${realpathSync(tracker)}`)
    && stdout.includes(`${realpathSync(tracker)}.bak`),
});

await runWhileLocked({
  name: 'tracker-delete',
  script: 'tracker.mjs',
  args: ['delete', '--num', '1'],
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [1](reports/001-acme.md) | seed |',
    '| 2 | 2026-01-02 | Beta | Analyst | 3.5/5 | Evaluated | ❌ | [2](reports/002-beta.md) | keep |',
  ]),
  verify: content => !content.includes('| 1 | 2026-01-01 | Acme |') && content.includes('| 2 | 2026-01-02 | Beta |'),
});

await runWhileLocked({
  name: 'tracker-export',
  script: 'tracker.mjs',
  args: ['export', '--out', '{tracker}'],
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [1](reports/001-acme.md) | seed |',
  ]),
  verify: content => content.includes('| 1 | 2026-01-01 | Acme |') && content.includes(CONCURRENT_ROW),
  verifyOutput: (_stdout, stderr, tracker) => stderr.includes('Exported 2 applications')
    && existsSync(`${realpathSync(tracker)}.bak`),
  completion: 'exports the fresh locked snapshot without losing concurrent rows',
});

// set-status.mjs is the writer AGENTS.md names as canonical — the one every
// mode calls to move a row — so it is the single most important entry in this
// matrix, and it was the one missing. tests/set-status-*.test.mjs already
// cover the lock TIMEOUT (exit 4) and a non-retryable lock error, but both
// prove only that it contends; neither can tell a writer that re-reads under
// the lock apart from one that reads first and writes a stale snapshot back.
// Hoisting the readFileSync above acquireTrackerLock looks like a harmless
// optimisation ("resolve the row before paying for the lock"), and the file
// already does real pre-lock work validating the state against states.yml, so
// the shape is inviting. This test is what makes that refactor fail.
await runWhileLocked({
  name: 'set-status',
  script: 'set-status.mjs',
  args: ['--row', '1', 'Applied', '--note', 'sent CV'],
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [1](reports/001-acme.md) | seed |',
  ]),
  verify: content => content.includes('| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Applied |')
    && content.includes('| seed; sent CV |'),
  verifyOutput: stdout => stdout.includes('set Evaluated → Applied'),
});

// mark-pdf-ready.mjs is the canonical writer for the PDF column and shares
// set-status.mjs's locked read-modify-write path (acquireTrackerLockForCli in
// tracker-utils.mjs). It rewrites one cell of one line and keeps the rest of
// the file, so a pre-lock read costs the same concurrent rows here as anywhere
// else in this matrix.
await runWhileLocked({
  name: 'mark-pdf-ready',
  script: 'mark-pdf-ready.mjs',
  args: ['1'],
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [1](reports/001-acme.md) | seed |',
  ]),
  verify: content => content.includes('| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ✅ |'),
  verifyOutput: stdout => stdout.includes('marked PDF ready'),
});

await runWhileLocked({
  name: 'reply-watch',
  script: 'reply-watch.mjs',
  stdin: 'y\n',
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Applied | ❌ | [1](reports/001-acme.md) | contact hr@acme.com |',
  ]),
  verify: content => content.includes('| Rejected |'),
  verifyOutput: (stdout, _stderr, tracker) => stdout.includes(`to ${realpathSync(tracker)}?`),
});

await runWhileLocked({
  name: 'reply-watch-identical',
  script: 'reply-watch.mjs',
  stdin: 'y\n',
  candidates: [
    {
      message_id: 'reply-1', from: 'hr@acme.com',
      subject: 'Unfortunately, an update on your Acme Engineer application',
      body_snippet: 'We decided not to proceed with your application.', signal: 'rejection',
    },
    {
      message_id: 'reply-2', from: 'hr@acme.com',
      subject: 'Update on your Acme Engineer application',
      body_snippet: 'Unfortunately, we will not be moving forward with your application.', signal: 'rejection',
    },
  ],
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Applied | ❌ | [1](reports/001-acme.md) | contact hr@acme.com |',
  ]),
  verify: content => content.includes('| Rejected |'),
  verifyOutput: stdout => stdout.includes('2 replies'),
  completion: 'groups identical reply transitions without losing their count',
});

await runWhileLocked({
  name: 'reply-watch-stale-status',
  script: 'reply-watch.mjs',
  stdin: 'y\n',
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Applied | ❌ | [1](reports/001-acme.md) | contact hr@acme.com |',
  ]),
  mutateWhileLocked: (content, concurrentRow) => `${content.replace('| Applied |', '| Interview |').trimEnd()}\n${concurrentRow}\n`,
  verify: content => content.includes('| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Interview |')
    && content.includes('| 99 | 2026-01-03 | ConcurrentCo |') && !content.includes('| Rejected |'),
  verifyOutput: (stdout, stderr) => `${stdout}${stderr}`.includes('status changed from Applied to Interview during review'),
  completion: 'preserves a status changed while the recommendation was under review',
  beforeMutationOutput: 'Apply recommended status updates',
});

// --- followup-seed.mjs: a separate lock namespace, deliberately -------------
//
// followup-seed.mjs is absent from the matrix above because it is not a
// tracker writer. It READS applications.md to find the row and its apply date,
// then writes only data/follow-ups.md, under its own lock keyed by the
// FOLLOW-UPS path and prefixed `career-ops-followups-` (followup-seed.mjs's
// FOLLOWUPS_LOCK_PREFIX and resolveLockDir) rather than the shared
// `career-ops-merge-tracker-` lock every writer above contends on.
//
// That split is the safe arrangement, not an oversight:
//   - The two locks guard two different files' critical sections. The tracker
//     lock says nothing about follow-ups.md, so a seeder holding it would
//     still race a second seeder; the follow-ups lock is what actually
//     serializes the read-check-append on follow-ups.md, and
//     followup-seed.mjs is the only writer of that file in the repo (every
//     other consumer — followup-cadence, reply-watch, stats, company-history —
//     only reads it).
//   - The stale-snapshot invariant this suite exists for cannot apply. It bites
//     when a writer writes a whole-file snapshot back; followup-seed writes no
//     tracker bytes at all, so a row committed while it runs cannot be erased.
//     Its pre-lock tracker read is therefore an observation that may go stale
//     (a row could leave Applied before the pin lands), never a lost write.
//   - Sharing the tracker lock would serialize every seed behind unrelated
//     tracker writes and, worse, nest two locks, without buying any safety.
//
// The test states all of that as behaviour: it holds the TRACKER lock for the
// whole run and asserts followup-seed (a) completes anyway rather than blocking
// on a lock it has no reason to want, (b) seeds follow-ups.md, and (c) leaves
// the tracker byte-for-byte as the tracker-lock holder left it, concurrent row
// included. Give followup-seed the tracker lock and (a) fails; give it a
// tracker write and (c) fails.
async function testFollowupSeedUsesASeparateLockNamespace() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-followup-seed-lock-'));
  const tracker = join(dir, 'applications.md');
  const followups = join(dir, 'follow-ups.md');
  const trackerLockDir = join(dir, 'career-ops-merge-tracker-followup-seed.lock');
  const followupsLockDir = join(dir, 'career-ops-followups-seed.lock');
  const content = trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Applied | ❌ | [1](reports/001-acme.md) | Applied 2026-01-01 |',
  ]);
  writeFileSync(tracker, content);

  const lock = await acquireTrackerLock(trackerLockDir, {
    timeoutMs: 2_000,
    retryMs: 20,
    staleMs: 5_000,
    tracker,
  });

  // Stand in for the tracker-lock holder committing a row: if followup-seed
  // ever wrote the tracker from a snapshot, this row is what it would erase.
  const lockedContent = `${content.trimEnd()}\n${CONCURRENT_ROW}\n`;
  writeFileSync(tracker, lockedContent);
  // Content alone would miss a writer that replaces the tracker with bytes it
  // happens to have read a moment earlier. writeFileAtomic renames a temp file
  // over the target, so the mtime moves even when the bytes do not.
  const lockedMtimeMs = statSync(tracker).mtimeMs;

  let stdout = '';
  let stderr = '';
  const child = spawn(NODE, [join(ROOT, 'followup-seed.mjs'), '1', '--json'], {
    cwd: ROOT,
    env: {
      ...process.env,
      CAREER_OPS_TRACKER: tracker,
      CAREER_OPS_FOLLOWUPS: followups,
      CAREER_OPS_FOLLOWUPS_LOCK: followupsLockDir,
      CAREER_OPS_FOLLOWUPS_LOCK_RETRY_MS: '20',
      CAREER_OPS_FOLLOWUPS_LOCK_TIMEOUT_MS: '3000',
      // Short enough that a followup-seed which DID reach for the shared
      // tracker lock would time out and fail loudly inside the harness wait,
      // instead of hanging until the suite's own timeout.
      CAREER_OPS_TRACKER_LOCK: trackerLockDir,
      CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: '500',
      CAREER_OPS_TRACKER_LOCK_RETRY_MS: '20',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end();
  const closePromise = new Promise(resolve => child.once('close', code => resolve({ code })));
  let result = await Promise.race([closePromise, sleep(HARNESS_WAIT_MS).then(() => null)]);
  if (result === null) {
    child.kill('SIGKILL');
    result = await closePromise;
  }

  // Released only after the child is done, so "completed" means "completed
  // while the tracker lock was held by someone else".
  lock.release();

  const after = readFileSync(tracker, 'utf-8');
  const trackerUntouched = after === lockedContent && statSync(tracker).mtimeMs === lockedMtimeMs;
  const seeded = existsSync(followups) ? readFileSync(followups, 'utf-8') : '';
  if (result.code === 0 && trackerUntouched
      && seeded.includes('- next #1 ')) {
    pass('followup-seed: seeds follow-ups under its own lock while the tracker lock is held, and writes no tracker bytes');
  } else {
    fail(`followup-seed: separate-namespace contract broken (exit=${result.code})\n${stdout}${stderr}\n${after}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

await testFollowupSeedUsesASeparateLockNamespace();

// ── Lock release hardening (acquireTrackerLock) ─────────────────────────
// Direct unit coverage for the ownership-verification path added alongside
// the shared-transaction rollout: release() must retry after a transient
// cleanup failure, and must never touch a lock directory a different owner
// recreated in its place.

{
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-lock-release-'));
  const lockDir = join(dir, 'career-ops-merge-tracker-release.lock');
  let removeAttempts = 0;
  try {
    const lock = await acquireTrackerLock(lockDir, {
      timeoutMs: 1_000, retryMs: 20, staleMs: 5_000, tracker: join(dir, 'applications.md'),
      removeLock: path => {
        removeAttempts++;
        if (removeAttempts === 1) {
          rmSync(join(path, 'owner.json'));
          throw new Error('transient cleanup failure');
        }
        rmSync(path, { recursive: true, force: true });
      },
    });

    let firstError = null;
    try { lock.release(); } catch (err) { firstError = err; }
    const partialCleanupPreservedDir = existsSync(lockDir) && !existsSync(join(lockDir, 'owner.json'));
    lock.release();
    if (firstError?.message.includes('transient cleanup failure')
        && partialCleanupPreservedDir && removeAttempts === 2 && !existsSync(lockDir)) {
      pass('tracker lock release retries after owner.json was removed by partial cleanup');
    } else {
      fail(`tracker lock partial-cleanup retry failed (error=${firstError?.message}, attempts=${removeAttempts})`);
    }
  } catch (err) {
    fail(`tracker lock partial-cleanup test crashed: ${err.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-lock-replacement-'));
  const lockDir = join(dir, 'career-ops-merge-tracker-replacement.lock');
  let removeAttempts = 0;
  try {
    const lock = await acquireTrackerLock(lockDir, {
      timeoutMs: 1_000, retryMs: 20, staleMs: 5_000, tracker: join(dir, 'applications.md'),
      removeLock: path => {
        removeAttempts++;
        rmSync(join(path, 'owner.json'));
        throw new Error('transient cleanup failure');
      },
    });
    try { lock.release(); } catch {}

    rmSync(lockDir, { recursive: true, force: true });
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, token: 'replacement-owner' }));
    lock.release();

    const owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf-8'));
    if (owner.token === 'replacement-owner' && removeAttempts === 1) {
      pass('stale tracker lock handle preserves a replacement after partial cleanup');
    } else {
      fail(`stale tracker lock handle touched replacement (attempts=${removeAttempts})`);
    }
  } catch (err) {
    fail(`tracker lock replacement test crashed: ${err.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-transaction-close-'));
  const tracker = join(dir, 'applications.md');
  const lockDir = join(dir, 'career-ops-merge-tracker-close.lock');
  const originalConsoleError = console.error;
  let warning = '';
  try {
    writeFileSync(tracker, 'before');
    const transaction = await openTrackerTransaction(tracker, {
      lockDir, removeLock: () => { throw new Error('injected cleanup failure'); },
    });
    transaction.replace('after');
    console.error = (...args) => { warning += args.join(' '); };
    const closeError = transaction.close();
    const repeatedCloseError = transaction.close();
    let rejectedClosedRead = false;
    try { transaction.read(); } catch { rejectedClosedRead = true; }

    if (readFileSync(tracker, 'utf-8') === 'after'
        && closeError?.message === 'injected cleanup failure'
        && repeatedCloseError === closeError && rejectedClosedRead
        && warning.includes('lock cleanup failed')) {
      pass('tracker transaction close preserves completed writes and reports cleanup failure');
    } else {
      fail(`tracker transaction close lost cleanup state (warning=${JSON.stringify(warning)})`);
    }
  } catch (err) {
    fail(`tracker transaction close test crashed: ${err.message}`);
  } finally {
    console.error = originalConsoleError;
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── reply-watch conflicting recommendations ─────────────────────────────
// Two replies disagreeing on the target status for the same row must not
// silently apply whichever recommendation happened to iterate last.
{
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-reply-conflict-'));
  const tracker = join(dir, 'applications.md');
  const candidatesPath = join(dir, 'candidates.json');
  const db = join(dir, 'applications.db');
  try {
    const initial = trackerTable([
      '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Applied | ❌ | [1](reports/001-acme.md) | contact hr@acme.com |',
    ]);
    writeFileSync(tracker, initial);
    writeFileSync(candidatesPath, JSON.stringify([
      {
        message_id: 'reply-rejected', from: 'hr@acme.com',
        subject: 'Unfortunately, an update on your Acme Engineer application',
        body_snippet: 'We decided not to proceed with your application.', signal: 'rejection',
      },
      {
        message_id: 'reply-interview', from: 'hr@acme.com',
        subject: 'Interview invitation for your Acme Engineer application',
        body_snippet: 'We would like to invite you to an interview.', signal: 'interview_invite',
      },
    ]));

    let stdout = '';
    let stderr = '';
    const child = spawn(NODE, [join(ROOT, 'reply-watch.mjs'), candidatesPath], {
      cwd: ROOT,
      env: {
        ...process.env,
        CAREER_OPS_TRACKER: tracker,
        CAREER_OPS_TRACKER_DB: db,
        CAREER_OPS_TRACKER_LOCK: join(dir, 'career-ops-merge-tracker-conflict.lock'),
        CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: '1000',
        CAREER_OPS_TRACKER_LOCK_RETRY_MS: '20',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.end();
    const closePromise = new Promise(resolve => child.once('close', code => resolve({ code })));
    let result = await Promise.race([closePromise, sleep(3_000).then(() => null)]);
    if (result === null) {
      child.kill('SIGKILL');
      result = await closePromise;
    }
    const output = `${stdout}${stderr}`;
    if (result.code === 0 && readFileSync(tracker, 'utf-8') === initial
        && output.includes('Conflicting status recommendations')
        && output.includes('Interview') && output.includes('Rejected')) {
      pass('reply-watch surfaces conflicting replies without applying an arbitrary last status');
    } else {
      fail(`reply-watch conflict handling failed (exit=${result.code})\n${output}\n${readFileSync(tracker, 'utf-8')}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// #2436: the guard-watched cases depend on the recover guard to order the
// fixture mutation after the writer's own read. If it stops being emitted they
// all silently fall back to timing, each burning CONTENTION_WAIT_MS first — the
// suite stays green (or returns to flaking) with nothing pointing at the cause.
// One observation is enough to prove the signal exists; zero across the whole
// matrix is the regression.
if (contentionWatchedCases === 0) {
  // Skipping the assertion when nothing was watched would reproduce the very
  // defect this file is fixing: a matrix change that drops every guard-watched
  // case leaves the suite green while nothing validates the recover guard at
  // all. Zero watched cases is itself the regression (CodeRabbit review).
  fail('no guard-watched case ran — the matrix no longer exercises the recover guard, so nothing validates the mutation ordering signal');
} else if (contentionObservedCases > 0) {
  pass(`recover guard observed in ${contentionObservedCases}/${contentionWatchedCases} guard-watched cases — the mutation ordering signal is live`);
} else if (process.platform === 'win32') {
  // The signal is SAMPLED: acquireTrackerLock removes the guard in a `finally`
  // around one lockCanRecover() call, so it exists for well under a
  // millisecond, and the watcher looks for it with readdirSync. On Windows
  // that sampling is unreliable enough to miss every window in a run — one CI
  // leg observed 3 of 8, another 0 of 8 on the same commit — so failing here
  // reports the sampler's luck, not the guard's existence, and turns a healthy
  // tree red at random. Reported, not enforced, on this platform.
  console.log(`NOTE recover guard not sampled in any of the ${contentionWatchedCases} guard-watched cases on win32 — the ordering signal could not be observed here; the assertion is enforced on platforms where sampling is reliable`);
  pass(`recover guard sampling skipped on win32 (${contentionWatchedCases} guard-watched cases)`);
} else {
  fail(`recover guard never observed in any of the ${contentionWatchedCases} guard-watched cases — acquireTrackerLock has stopped emitting it, so every one of them fell back to timing-dependent ordering`);
}
