#!/usr/bin/env node

/**
 * test-all.mjs — Comprehensive test suite for career-ops
 *
 * Run before merging any PR or pushing changes.
 * Tests: syntax, scripts, dashboard, data contract, personal data, paths.
 *
 * Usage:
 *   node test-all.mjs                        # Run all tests
 *   node test-all.mjs --quick                # Skip dashboard build (faster)
 *   node test-all.mjs --only <substring>      # Run ONLY discovered tests/**\/*.test.mjs
 *                                             # files whose path contains <substring>
 *                                             # (e.g. --only providers/themuse).
 *
 *   LOUD WARNING: `--only` runs ONLY discovered tests/ files — every inline
 *   core section above (syntax, scripts, dashboard, data contract, personal
 *   data, paths, etc.) is SKIPPED. A green `--only` run is NOT a green
 *   suite. Always run the full suite (no flags) before pushing.
 *
 * NEW TESTS GO IN A FILE OF THEIR OWN, NOT IN A SECTION HERE.
 * Node tests matching tests/**\/*.test.mjs are auto-discovered — no
 * registration, no section number. The CV visual Playwright suite is the
 * exception: its dedicated workflow discovers tests/cv-visual/cv-visual.test.mjs.
 * Provider tests are one case of Node test auto-discovery
 * (tests/providers/{name}.test.mjs), not the only one.
 *
 * Why it matters beyond tidiness: a numbered section means editing the end of
 * this file, and the section number is a global label picked by hand. Six
 * contributors doing that at once in Aug-2026 all picked `60a` and each merge
 * forced a rebase on the other five - about fifteen rebases and six serialized
 * CI runs for six lines of test code. A new file collides with nobody, so
 * those PRs can all land in parallel.
 *
 * The inline sections below are history, not a pattern to copy.
 */


import { execSync, execFile, execFileSync, spawn, spawnSync } from 'child_process';
import { checkSyntax, NODE_CHECK_TIMEOUT_MS } from './lib/syntax-check.mjs';
import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync as _rmSync, statSync, unlinkSync, realpathSync, symlinkSync, copyFileSync, cpSync } from 'fs';

// Windows keeps a handle open on a just-exited child process's working files
// for a short window (antivirus and Search Indexer widen it), so removing a
// fixture directory the suite created inside the repo can fail with EPERM even
// though every assertion passed. `force: true` does not cover that — it
// suppresses ENOENT, not EPERM — and most of these removals sit in `finally`
// blocks, so one unlucky cleanup aborted the whole run with a stack trace and
// a non-zero exit. That reads as a broken test suite on Windows when nothing
// is broken, and it leaves the fixture dir behind for the next run to trip on.
//
// Node retries exactly this class of error (EBUSY/EMFILE/ENFILE/ENOTEMPTY/
// EPERM) with linear backoff when given maxRetries, so default it everywhere
// rather than at ~95 individual call sites. An explicit option still wins.
const rmSync = (target, opts = {}) => _rmSync(target, { maxRetries: 10, retryDelay: 100, ...opts });
import { join, dirname, basename, relative, delimiter } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { fileURLToPath, pathToFileURL } from 'url';
import * as yaml from 'js-yaml';
import { pass, fail, warn, run, runAcrossUtcDay, runAcrossLocalDay, lastRunFailure, formatRunFailure, fileExists, finish, results, linkNodeModules, ROOT, QUICK, NODE, DEFAULT_SCRIPT_TIMEOUT_MS, getBash, toBashPath, hermeticGitEnv } from './tests/helpers.mjs';
import { flagValue, hasFlag } from './lib/cli-flags.mjs';
import { collectMjsFiles } from './lib/mjs-files.mjs';
import { walkTree, listTree } from './lib/walk-tree.mjs';
import { FROZEN_EVALUATION_MODES, KNOWN_EVALUATION_MODES, discoverEvaluationModes, readModeText, structuralGaps } from './tests/evaluation-mode-parity-helpers.mjs';
import { childFailureExcerpt } from './lib/failure-excerpt.mjs';
import { SCRATCH_PREFIX, markScratchOwner, sweepScratchDirs } from './lib/scratch-dirs.mjs';

/**
 * Read a repo-relative text file as UTF-8.
 *
 * @param {string} path - Path relative to the career-ops repository root.
 * @returns {string} File contents.
 */
function readFile(path) {
  // Several earlier checks walk modes before the parity gate. They must use
  // the same contained reader or a pointer could escape before parity runs.
  if (/^modes[\\/]/.test(path)) return readModeText(ROOT, path);
  const fullPath = join(ROOT, path);
  let content = readFileSync(fullPath, 'utf-8');
  if (content.trim().startsWith('..') && content.trim().split('\n').length === 1) {
    const target = join(dirname(fullPath), content.trim());
    if (existsSync(target)) {
      content = readFileSync(target, 'utf-8');
    }
  }
  return content;
}

/**
 * Normalize CRLF line endings to LF (#1771).
 *
 * On Windows checkouts with core.autocrlf=true, repo text files arrive with
 * CRLF endings. Doc assertions that anchor on `\n` (JS `.` never matches `\r`)
 * then fail on pristine main. Normalizing at read time keeps the assertions
 * byte-ending agnostic without touching any regex.
 *
 * @param {string} text - Raw file contents.
 * @returns {string} Contents with LF-only line endings.
 */
const normalizeEol = (text) => text.replace(/\r\n/g, '\n');

/**
 * Read a repo text file with line endings normalized to LF (#1771).
 * Use for doc-content reads that feed `\n`-anchored regex assertions.
 * Do NOT use where byte-exact content matters.
 *
 * @param {string} path - Path relative to the career-ops repository root.
 * @returns {string} File contents with LF-only line endings.
 */
const readTextLF = (path) => normalizeEol(readFile(path));

// ── Auto-discovered test files (issue #1440) ─────────────────────────────
// Deterministic: recursive readdirSync with default lexicographic sort of
// entry names — same order on every run and OS. No glob library, no
// registration list. Discovery is limited to tests/ so root-level
// standalone *.test.mjs files are never picked up.
const TESTS_DIR = join(ROOT, 'tests');

function discoverTests(dir) {
  // walkTree sorts every level by name, so the run order is identical on every
  // run and OS — the property #1440 asked for. It also refuses to descend into
  // a nested checkout, which matters more here than anywhere else in this file:
  // this walk does not READ what it finds, it hands it to the runner. A
  // worktree parked under tests/ executed a stale checkout's suites against the
  // current tree, and test-all.mjs printed "🟢 All tests passed — safe to
  // push/merge" for them (#3762).
  return listTree(dir, { match: /\.test\.mjs$/ })
    // This is a Playwright suite, run by the dedicated CV visual job. It is
    // named .test.mjs for the repository convention, but node --test cannot
    // execute Playwright's test registration API.
    .filter((f) => f !== join(TESTS_DIR, 'cv-visual', 'cv-visual.test.mjs'));
}

// Strip comment lines before grepping a discovered suite's source for a
// forbidden call: a suite that only MENTIONS a call in a comment (e.g.
// documenting why it doesn't make it) must not be flagged.
//
// Removed: whole-line `//` comments, and every line of a `/* ... */` block,
// including unstarred interior lines. Kept: any code that shares a line with a
// comment, on either side of it, so a real call can never hide behind one:
// `/* why */ process.exit(1)` and `*gen() { finish() }` are still scanned.
// Trailing `//` comments on a code line are deliberately still scanned,
// erring toward a loud false positive, never a silent miss.
//
// Comment markers inside a multi-line template literal are text, not
// comments, and an interpolation there IS executable — so nothing is stripped
// while the kept code has an odd number of unescaped backticks (quoted
// strings and trailing `//` comments excluded from the count). An opener that
// never closes is not a comment we understand either; the raw source is
// scanned instead. Both limits fail loud, never silent.
function stripCommentLines(src) {
  let inBlock = false;
  let inTemplate = false;
  const kept = [];
  for (const line of src.split('\n')) {
    let rest = line;
    if (!inTemplate) {
      if (inBlock) {
        const end = rest.indexOf('*/');
        if (end === -1) continue;
        inBlock = false;
        rest = rest.slice(end + 2);
      }
      // A block comment opening at the start of the (remaining) line: drop it,
      // then look again — `/* a */ /* b */ code` keeps `code`.
      let open;
      while ((open = /^\s*\/\*/.exec(rest))) {
        const end = rest.indexOf('*/', open[0].length);
        if (end === -1) { inBlock = true; rest = ''; break; }
        rest = rest.slice(end + 2);
      }
      if (/^\s*(\/\/|$)/.test(rest)) continue;
    }
    kept.push(rest);
    const code = rest
      .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '')
      .replace(/\/\/.*$/, '');
    if (((code.match(/(?<!\\)`/g) ?? []).length) % 2 === 1) inTemplate = !inTemplate;
  }
  if (inBlock) return src;
  return kept.join('\n');
}

async function runDiscovered(filter = null) {
  let files = discoverTests(TESTS_DIR);
  if (filter) {
    const norm = (p) => p.slice(TESTS_DIR.length + 1).replace(/\\/g, '/');
    files = files.filter((f) => norm(f).includes(filter));
  }
  if (files.length === 0) {
    // Fail hard: a path typo must never silently turn CI green.
    console.log(`  ❌ no test files matched${filter ? ` --only "${filter}"` : ''} under tests/`);
    process.exit(1);
  }
  for (const f of files) {
    const rel = f.slice(ROOT.length + 1);
    const src = readFileSync(f, 'utf-8');
    // Discovered suites run IN-PROCESS and share this suite's counters. A
    // process.exit() inside one would terminate test-all mid-run with a forged
    // exit code — every later section (and finish()) would silently never run.
    // Refuse to import such a suite and fail loudly instead (#1916 regression).
    // stripCommentLines() first: a suite that only MENTIONS process.exit() in
    // a comment (e.g. documenting why it doesn't call it) must not be flagged.
    if (/\bprocess\.exit\s*\(/.test(stripCommentLines(src))) {
      fail(`${rel} calls process.exit() — discovered suites must use pass/fail from tests/helpers.mjs and never exit`);
      continue;
    }
    // A node:test suite reports through node's OWN runner, which touches none
    // of the counters above, and it runs its tests asynchronously AFTER the
    // import resolves — so finish()'s process.exit() killed them mid-flight and
    // discarded the result. A deliberately failing suite dropped into tests/
    // printed "2049 passed, 0 failed / All tests passed" and exited 0
    // (verified 2026-08-03). That silently covered all 16 node:test suites
    // here, including every provider test: they only ever reported under a
    // direct `node --test`.
    //
    // Run those in a child process and fold the real exit code into the
    // counters. Importing them is what loses the result, so this cannot be
    // fixed in finish(); it has to happen where the suite is invoked.
    if (/from ['"]node:test['"]/.test(src)) {
      const out = run(NODE, ['--test', f]);
      if (out === null) {
        const detail = lastRunFailure();
        fail(`${rel} — node:test suite failed (exit ${detail?.status ?? '?'})`);
        // Surface the runner's own summary; a bare "failed" is not actionable.
        // The trailing window alone is not actionable either: node prints the
        // error message above the frames, so a twelve-line tail kept
        // `actual: false, expected: true` and dropped the interpolated value
        // that says WHICH assertion and by how much (#4017).
        for (const line of childFailureExcerpt(detail)) {
          console.log(`      ${line}`);
        }
      } else {
        // Both reporters: TAP prints "# pass N", the default spec reporter
        // prints "ℹ pass N". Cosmetic — the pass/fail verdict is the exit code.
        const count = (out.match(/^(?:#|ℹ) pass (\d+)/m) ?? [])[1];
        pass(`${rel} — node:test suite passed${count ? ` (${count} tests)` : ''}`);
      }
      continue;
    }
    // finish() prints the global summary and exits — inside a discovered suite
    // it forges the verdict line and decapitates every suite sorting after it,
    // sailing past the process.exit() check above (the exit lives in helpers).
    // Same stripCommentLines() treatment as the process.exit() guard above: a
    // suite that only MENTIONS finish() in a comment (e.g. documenting why it
    // doesn't call it) must not be flagged.
    if (/\bfinish\s*\(\s*\)/.test(stripCommentLines(src))) {
      fail(`${f.slice(ROOT.length + 1)} calls finish() — only test-all.mjs may print the global summary; discovered suites use pass/fail and return`);
      continue;
    }
    // Neither guard above survives contact with an uncaught THROW, which ends
    // the run just as completely and rather more quietly: node unwinds straight
    // out of test-all, finish() never prints its summary, and every suite
    // sorting after this one silently never runs. That does not read as a
    // broken suite — it reads as a finished one, so the screen of green above
    // the cut looks like a pass. (Measured on a Windows box with no symlink
    // privilege: tests/intake.test.mjs threw at import and took 2067 of 3693
    // checks with it, with no verdict line at all — #2828.) A discovered suite
    // is a guest, not a co-host: its crash is one failure, not the end of the
    // run.
    const before = results();
    try {
      await import(pathToFileURL(f).href);
    } catch (err) {
      const ran = (results().passed - before.passed) + (results().failed - before.failed);
      fail(`${rel} — suite threw and was contained (${err?.code ?? err?.name ?? 'Error'}): ${err?.message ?? err}`);
      // How much this counts as "one failure" actually cost: the reported
      // totals only ever include the `ran` assertions above, and nothing else
      // says the rest never happened — on one platform a suite's crash reads
      // as one broken assertion, on another the same file's assertions run
      // and pass, and the two summaries look the same shape (#3976).
      //
      // An earlier version of this line also estimated how many assertions
      // never ran, from a static count of pass()/fail() call sites in the
      // file. artemtrofymenko (the issue's author) measured that estimate
      // against real suites and found it wrong in both directions badly
      // enough to make the diagnostic worse than none: a suite asserting
      // through a local wrapper (`function ok(cond) { if (cond) pass(...)
      // else fail(...) }`) has far more real assertions than call sites
      // (tests/discover-ats.test.mjs: 155 executed, 4 call sites — the
      // estimate goes negative, `lost > 0` is false, and the line silently
      // does not print, reverting to exactly the pre-fix silence for the
      // suites this was built for — 38 of 278 in-process suites use this
      // shape); a suite writing `if (cond) pass(...); else fail(...)` pairs
      // has roughly twice as many call sites as real assertions
      // (tests/providers/_http.test.mjs: ~2x), so the estimate invents lost
      // assertions that never existed. A signal present for some suites and
      // silently absent for others turns its own absence into a false
      // reassurance — worse than never estimating at all. `ran` alone does
      // not have that failure mode: it is an exact count in every case, so
      // it is printed unconditionally instead.
      console.log(`      ${ran} assertion${ran === 1 ? '' : 's'} ran before the throw; everything after it in this file did not run`);
      // The throw site, not just the message: a suite that dies mid-import
      // leaves no other clue how far it got.
      for (const line of String(err?.stack ?? '').split('\n').slice(1, 4)) {
        if (line.trim()) console.log(`      ${line.trim()}`);
      }
    }
  }
}

// A scratch copy left by a killed run used to poison every walker that follows:
// `.gitignore` hides it and the copy carries no `.git`, so neither `git status`
// nor `isNestedCheckout()` could see it, and the layout guards read a second
// copy of `tests/` as several hundred misplaced suites (#3940).
//
// What makes the run correct is `isScratchDir` in the walkers, not this sweep —
// they skip a leftover whether it gets removed or not. This only reclaims the
// disk, which is why it can afford the age gate that keeps it off a scratch a
// concurrent run is still writing into.
//
// Placed before the `--only` exit below: the 264-failure run is exactly the one
// a developer then re-runs with `--only core-test-layout` to look closer, and a
// sweep they skip past would leave that second run behaving differently again.
{
  const { removed, failed } = sweepScratchDirs(ROOT);
  // Only speak when there was something to say. A sweep is silent on the
  // overwhelming majority of runs, and a line reporting that nothing happened
  // would be noise at the top of every one of them. `kept` is deliberately not
  // reported: a young scratch is somebody else's live run, and it is none of
  // this run's business.
  for (const name of removed) {
    console.log(`  🧹 removed a stale scratch copy from an interrupted run: ${name}/`);
  }
  for (const { name, error } of failed) {
    // Not fatal — the walkers skip it, so every guard below still grades the
    // real tree — but not silent either: something is holding a directory this
    // run tried to delete, and that is worth knowing before it becomes a
    // disk-space question.
    warn(`could not remove the stale scratch copy ${name}/ (${error}) — the guards skip it, so this run is unaffected`);
  }
}

// `--only=providers/x` must not read as "no filter": the discovered-test
// runner exits 1 when a filter matches nothing, precisely so a path typo can
// never turn CI green — and a silently dropped filter runs the whole suite
// instead, which looks like a pass of the subset that was asked for.
// `--only` supplied without a value must stay a usage error, not fall through
// to "no filter": that would run everything and read as a pass of the subset
// that was asked for — the same silent substitution this file's flag reading
// was fixed for.
const ONLY = hasFlag(process.argv, '--only') ? (flagValue(process.argv, '--only') ?? '') : null;
if (ONLY !== null) {
  if (ONLY === '' || ONLY.startsWith('--')) {
    console.log('  ❌ --only requires a path substring, e.g. --only providers/themuse');
    process.exit(1);
  }
  console.log('\n🧪 career-ops test suite (--only ' + ONLY + ')\n');
  await runDiscovered(ONLY);
  finish();
}

console.log('\n🧪 career-ops test suite\n');

// ── 1. SYNTAX CHECKS ────────────────────────────────────────────

console.log('1. Syntax checks');

// RECURSIVE, and sharing its walk with `npm run lint` (#3419). This read the
// repository root non-recursively, which covered 138 of the ~617 .mjs files
// here and printed a `syntax OK` line for each one — so the 259 files under
// tests/ were absent from a log that looked complete. It also narrowed by one
// every time a file moved out of the root, silently. Both scopes now come from
// the same collector, so neither can drift from the other again.
const mjsFiles = collectMjsFiles(ROOT).map(f => f.slice(ROOT.length + 1).replace(/\\/g, '/'));

// State the scope in one line. The per-file `syntax OK` output is what hid the
// old shortfall: a number the reader can compare against `npm run lint`'s own
// total makes a narrowing visible at a glance instead of requiring someone to
// diff two runs' pass labels.
console.log(`  (${mjsFiles.length} .mjs files, recursive from the repository root)`);

// One process parses all of them, and `node --check` then runs only on a file
// that pass did not vouch for, so a failure below carries the diagnostic it
// always carried (lib/syntax-check.mjs, #5078). One `node --check` per file,
// even eight at a time (#2387), was 22 s of starting node for 0.3 s of parsing.
// Results come back by index and are reported in collector order, so the log
// does not depend on what finished first.
const { errors: syntaxErrors, fastPassUnavailable } = await checkSyntax(mjsFiles, { cwd: ROOT, node: NODE });
if (fastPassUnavailable) {
  // Not a failure and not a narrower check: every file went through
  // `node --check` instead. Said out loud because it costs about 20 s a run,
  // and nothing else here would show where they went.
  console.log(`  (the single-process parse did not run: ${fastPassUnavailable}; each file was checked with node --check instead)`);
}

// A bare catch reports a child killed on timeout, or one that never spawned, as
// "has syntax errors" — sending the reader hunting for a parse error that does
// not exist. Keep enough of the child's own diagnosis to tell those apart.
const describeCheckFailure = (err) => {
  if (err?.killed || err?.signal === 'SIGTERM' || err?.code === 'ETIMEDOUT') {
    return `node --check timed out after ${NODE_CHECK_TIMEOUT_MS}ms${err.signal ? ` (signal ${err.signal})` : ''}`;
  }
  const stderr = String(err?.stderr ?? '').trim();
  if (!stderr) return `no stderr (exit ${err?.code ?? 'unknown'})`;
  const clipped = stderr.length > 2000
    ? `${stderr.slice(0, 2000)}\n    ... (${stderr.length - 2000} more chars)`
    : stderr;
  return clipped.replace(/\n/g, '\n    ');
};

mjsFiles.forEach((f, i) => {
  if (!syntaxErrors[i]) {
    pass(`${f} syntax OK`);
  } else {
    fail(`${f} has syntax errors\n    ${describeCheckFailure(syntaxErrors[i])}`);
  }
});

// ── 2. SCRIPT EXECUTION ─────────────────────────────────────────

console.log('\n2. Script execution (graceful on empty data)');

/**
 * Whether a failed run died with an UNCAUGHT exception rather than exiting.
 *
 * The two are not the same outcome and only one of them is ever "expected".
 * Node prints an uncaught error as `SomeError: message` at the start of a line
 * followed by a stack; a script reporting its own problem and exiting non-zero
 * prints neither. Both parts are required, so a script whose own diagnostic
 * happens to start with "Error: " is not mistaken for a crash.
 *
 * @param {{stderr?: string}|null} failure
 * @returns {boolean}
 */
function crashedBeforeRunning(failure) {
  const stderr = String(failure?.stderr ?? '');
  return /^[A-Za-z]*Error(?: \[[^\]]+\])?: /m.test(stderr) && /\n\s+at /.test(stderr);
}

const scripts = [
  { name: 'cv-sync-check.mjs', expectExit: 1, allowFail: true }, // fails without cv.md (normal in repo)
  { name: 'verify-pipeline.mjs', expectExit: 0 },
  // --dry-run: these scripts resolve ROOT from import.meta.url and write
  // data/applications.md (or data/pipeline.md) in place. On a provisioned working
  // copy with a real tracker present, running them without --dry-run mutates user
  // data. Harmless in this repo (no tracker shipped), risky for end users who run
  // tests inside their active career-ops workspace.
  { name: 'normalize-statuses.mjs --dry-run', expectExit: 0 },
  { name: 'dedup-tracker.mjs --dry-run', expectExit: 0 },
  { name: 'merge-tracker.mjs --dry-run', expectExit: 0 },
  { name: 'reconcile-pipeline.mjs --dry-run', expectExit: 0 },
  { name: 'analyze-patterns.mjs --self-test', expectExit: 0 },
  // career-ops 1.30.0 sync: /calibrate (#3315) ships an inline self-test.
  { name: 'calibrate.mjs --self-test', expectExit: 0 },
  // career-ops 1.38.0 sync: inline self-tests registered (tests/self-test-registration).
  { name: 'ats-payload.mjs --self-test', expectExit: 0 },
  { name: 'contact-lookup.mjs --self-test', expectExit: 0 },
  { name: 'cv-title-check.mjs --self-test', expectExit: 0 },
  { name: 'detect-reposts.mjs --self-test', expectExit: 0 },
  { name: 'keyword-match.mjs --self-test', expectExit: 0 },
  { name: 'linkedin-join.mjs --self-test', expectExit: 0 },
  { name: 'process-quality.mjs --self-test', expectExit: 0 },
  { name: 'rank-pipeline.mjs --self-test', expectExit: 0 },
  { name: 'salary-gap.mjs --self-test', expectExit: 0 },
  { name: 'story-provenance-check.mjs --self-test', expectExit: 0 },
  { name: 'validate-profile.mjs --self-test', expectExit: 0 },
  { name: 'verify-cv-facts.mjs --self-test', expectExit: 0 },
  { name: 'verify-cv-structure.mjs --self-test', expectExit: 0 },
  { name: 'check-jd-archive.mjs --self-test', expectExit: 0 },
  // career-ops 1.19.0 scripts with inline self-tests (ported).
  { name: 'upskill.mjs --self-test', expectExit: 0 },
  { name: 'funnel-velocity.mjs --self-test', expectExit: 0 },
  { name: 'assessment-log.mjs --self-test', expectExit: 0 },
  { name: 'img-to-pdf.mjs --self-test', expectExit: 0 },
  { name: 'build-cv-latex.mjs --test', expectExit: 0 },
  // career-ops v1.23.0 sync: new standalone tools with inline self-tests.
  { name: 'discover-ats.mjs --self-test', expectExit: 0 },
  { name: 'contacts.mjs --self-test', expectExit: 0 },
  { name: 'company-history.mjs --self-test', expectExit: 0 },
  { name: 'rejection-latency.mjs --self-test', expectExit: 0 },
  { name: 'seed-fixture.mjs --self-test', expectExit: 0 },
  // career-ops follow-up sync (2026-07-30): check-table-freshness.mjs ships
  // its own fixture-driven --self-test (discovery shapes, expired/review-due
  // semantics, date-math boundaries).
  { name: 'check-table-freshness.mjs --self-test', expectExit: 0 },
  // career-ops v1.24.0 sync: new standalone tools with inline self-tests.
  { name: 'company-funded.mjs --self-test', expectExit: 0 },
  { name: 'invite-match.mjs --self-test', expectExit: 0 },
  { name: 'tracker-sync-check.mjs --self-test', expectExit: 0 },
  { name: 'weekly-digest.mjs --self-test', expectExit: 0 },
  // security sync (#2368): untrusted-external-content directive coverage guard.
  { name: 'validate-untrusted-content-coverage.mjs --self-test', expectExit: 0 },
  // Parity backfill: tools that predate the v1.24.0 window and were never ported.
  { name: 'jd-skill-gap.mjs --self-test', expectExit: 0 },
  { name: 'build-cv-html.mjs --test', expectExit: 0 },
  { name: 'eval-golden.mjs --self-test', expectExit: 0 },
  // NOTE: the eleven root-level suites that used to be hand-registered here
  // are gone. Each existed twice — once at the repo root, once under tests/ —
  // in two divergent versions, and BOTH ran, so the weaker copy decided
  // whether the suite was green (the root detect-reposts copy was 891 lines
  // against tests/'s 1352, and it failed outright once its subject was
  // replaced). Upstream retired the same duplication in #3247/#3306/#3388.
  // dead-boards.test.mjs was worse than duplicated: it was at the root and
  // never registered here, so nothing ran it at all. All of them now live in
  // tests/ and are auto-discovered — one discovery mechanism, one copy.
  // tracker-columns coverage lives at tests/tracker-columns.test.mjs
  // (auto-discovered) since the header-aware parsing port.
  { name: 'validate-portals.mjs --file templates/portals.example.yml', expectExit: 0 },
  // Bare run: no portals.yml in the repo, so it must exit 0 gracefully (and hit
  // no network). The probe logic itself is unit-tested below with a mock.
  // The one LIVE-NETWORK entry in this registry: it probes every portals.yml board.
  // Measured at 16-17s locally against the 30s default, which is not headroom — it
  // timed out once in five runs here, and an intermittently red gate is one people
  // learn to re-run instead of read. The budget is the flake, not the script.
  { name: 'verify-portals.mjs', expectExit: 0, timeoutMs: 120_000 },
  // fix-slugs.mjs has no --self-test flag (unlike its siblings above) — its
  // own testable surface is verify-portals.mjs's probe/suggestion logic,
  // which is network-dependent. Same graceful-on-no-portals.yml smoke check
  // as the bare verify-portals.mjs run directly above: confirms the module
  // loads and its default-path guard exits cleanly without touching network.
  // With a real portals.yml present (any working checkout) it DOES probe live boards: 23s measured,
  // so it gets verify-portals' budget rather than the 30s default.
  { name: 'fix-slugs.mjs', expectExit: 0, timeoutMs: 120_000 },
  // career-ops 1.27.0 sync: new standalone tool with an inline self-test.
  { name: 'negotiation-roi.mjs --self-test', expectExit: 0 },
  // career-ops 1.30.0 sync: ATS-friendliness scorer (#2064) ships an inline
  // self-test. Upstream also carries an inline fixture block for it in this
  // file; the fork registers the script's own self-test instead, which covers
  // the same scoring surface without a second copy of the fixtures.
  { name: 'verify-ats.mjs --self-test', expectExit: 0 },
  // The fork's layer over upstream, as a gate. Exits 1 naming any adaptation a
  // sync overwrote — the failure mode that otherwise ships silently with a
  // green suite (upstream #75 restored a wrong-profile read across 25 scripts
  // exactly that way). Green as of the normalisation pass; a red here means a
  // sync dropped something, not that the checker is noisy.
  { name: 'fork-adaptations.mjs', expectExit: 0 },
];

for (const { name, allowFail, skipIfMissing } of scripts) {
  if (skipIfMissing && !fileExists(name.split(' ')[0])) {
    warn(`${name} skipped (not shipped in this fork yet)`);
    continue;
  }
  const result = run(NODE, name.split(' '), { stdio: ['pipe', 'pipe', 'pipe'] });
  if (result !== null) {
    pass(`${name} runs OK`);
  } else if (allowFail && !crashedBeforeRunning(lastRunFailure())) {
    warn(`${name} exited with error (expected without user data)`);
  } else if (allowFail) {
    // allowFail says "a non-zero exit is expected here", never "any outcome
    // is fine". A script that dies with an uncaught exception did not run at
    // all, and reporting that as the expected failure is how #3440 sat in
    // upstream main: cv-sync-check.mjs threw a ReferenceError at module scope,
    // exited 1 like a missing cv.md, and the suite printed the reassuring
    // warning for a script that never reached a single check.
    fail(`${name} crashed before running — allowFail covers an expected exit, not an uncaught error${formatRunFailure()}`);
  } else {
    fail(`${name} crashed${formatRunFailure()}`);
  }
}

// ── 3. LIVENESS CLASSIFICATION ──────────────────────────────────

console.log('\n3. Liveness classification');

try {
  const { classifyLiveness } = await import(pathToFileURL(join(ROOT, 'liveness-core.mjs')).href);

  const expiredChromeApply = classifyLiveness({
    finalUrl: 'https://example.com/jobs/closed-role',
    bodyText: 'Company Careers\nApply\nThe job you are looking for is no longer open.',
    applyControls: [],
  });
  if (expiredChromeApply.result === 'expired') {
    pass('Expired pages are not revived by nav/footer "Apply" text');
  } else {
    fail(`Expired page misclassified as ${expiredChromeApply.result}`);
  }

  const activeWorkdayPage = classifyLiveness({
    finalUrl: 'https://example.workday.com/job/123',
    bodyText: [
      '663 JOBS FOUND',
      'Senior AI Engineer',
      'Join our applied AI team to ship production systems, partner with customers, and own delivery across evaluation, deployment, and reliability.',
    ].join('\n'),
    applyControls: ['Apply for this Job'],
  });
  if (activeWorkdayPage.result === 'active') {
    pass('Visible apply controls still keep real job pages active');
  } else {
    fail(`Active job page misclassified as ${activeWorkdayPage.result}`);
  }

  const closedMycareersfuture = classifyLiveness({
    finalUrl: 'https://www.mycareersfuture.gov.sg/job/engineering/senior-staff-embedded-software-engineer',
    bodyText: [
      'Senior Staff Embedded Software Engineer',
      'MaxLinear Asia Singapore Private Limited',
      '9 applications    Posted 27 Oct 2025    Closed on 26 Nov 2025',
      'Applications have closed for this job',
      'Log in to Apply',
      "You'll need to log in with Singpass to verify your identity.",
      'Roles & Responsibilities: design, develop and maintain embedded firmware for broadband communications ICs.',
    ].join('\n'),
    applyControls: ['Log in to Apply'],
  });
  if (closedMycareersfuture.result === 'expired') {
    pass('Closed postings with "Applications have closed" banner are detected');
  } else {
    fail(`Closed mycareersfuture posting misclassified as ${closedMycareersfuture.result}`);
  }

  const cloudflareChallenge = classifyLiveness({
    status: 403,
    finalUrl: 'https://www.pracuj.pl/praca/sap-consultant,oferta,1004870954',
    bodyText: 'www.pracuj.pl\nJust a moment...\nPerforming security verification\nThis website uses a security service to protect against malicious bots.\nRay ID: a06489bab8bc4cd7\nPerformance and Security by Cloudflare',
    applyControls: [],
  });
  if (cloudflareChallenge.result === 'uncertain' && cloudflareChallenge.code === 'bot_challenge') {
    pass('Cloudflare anti-bot challenge pages are uncertain, not expired');
  } else {
    fail(`Cloudflare challenge misclassified as ${cloudflareChallenge.result} (${cloudflareChallenge.code})`);
  }

  const blocked403 = classifyLiveness({
    status: 403,
    finalUrl: 'https://www.pracuj.pl/praca/sap-consultant,oferta,1004870954',
    bodyText: 'Access denied',
    applyControls: [],
  });
  if (blocked403.result === 'uncertain' && blocked403.code === 'access_blocked') {
    pass('HTTP 403 is treated as access-blocked (uncertain), not expired');
  } else {
    fail(`HTTP 403 misclassified as ${blocked403.result} (${blocked403.code})`);
  }

  const activePolishPosting = classifyLiveness({
    status: 200,
    finalUrl: 'https://www.pracuj.pl/praca/administrator-sap-utilities-warszawa,oferta,1004870954',
    bodyText: 'Administrator SAP Utilities. Connectis_. Siedziba firmy: Chmielna 71, Warszawa. '.repeat(6),
    applyControls: ['Aplikuj Aplikuj na ogłoszenie'],
  });
  if (activePolishPosting.result === 'active') {
    pass('Polish "Aplikuj" apply control marks a loaded posting active');
  } else {
    fail(`Polish apply control not recognized: ${activePolishPosting.result} (${activePolishPosting.code})`);
  }

  // Headed-fallback-on-challenge path (liveness-browser.mjs). Fake Playwright
  // pages script the goto/evaluate calls so we can exercise the wrapper without
  // launching a browser. checkUrlLiveness reads body text first, apply controls
  // second — the fake returns them in that order.
  const { checkUrlLiveness, checkUrlLivenessWithFallback, isChallengeResult, jitteredDelayMs } =
    await import(pathToFileURL(join(ROOT, 'liveness-browser.mjs')).href);

  const disabled = jitteredDelayMs(0) === 0 && jitteredDelayMs(-1) === 0;
  let inRange = true;
  for (let i = 0; i < 200; i += 1) {
    const d = jitteredDelayMs(5000);
    if (d < 5000 || d >= 10000) { inRange = false; break; }
  }
  if (disabled && inRange) {
    pass('jitteredDelayMs returns 0 when disabled and stays in [base, 2*base)');
  } else {
    fail(`jitteredDelayMs out of spec (disabled=${disabled}, inRange=${inRange})`);
  }

  const fakePage = ({ status, finalUrl, bodyText, applyControls }) => {
    let evalCall = 0;
    return {
      async goto() { return { status: () => status }; },
      async waitForTimeout() {},
      url() { return finalUrl; },
      async evaluate() { evalCall += 1; return evalCall === 1 ? bodyText : applyControls; },
    };
  };
  const URL = 'https://www.pracuj.pl/praca/sap-consultant,oferta,1004870954';
  const challengePage = () => fakePage({
    status: 403,
    finalUrl: URL,
    bodyText: 'Just a moment... Performing security verification. Ray ID: abc123. Cloudflare.',
    applyControls: [],
  });
  const livePage = () => fakePage({
    status: 200,
    finalUrl: URL,
    bodyText: 'Administrator SAP Utilities. '.repeat(20),
    applyControls: ['Apply for this job'],
  });

  if (isChallengeResult({ result: 'uncertain', code: 'bot_challenge' }) &&
      isChallengeResult({ result: 'uncertain', code: 'access_blocked' }) &&
      !isChallengeResult({ result: 'expired', code: 'http_gone' }) &&
      !isChallengeResult({ result: 'active', code: 'apply_control_visible' })) {
    pass('isChallengeResult flags only bot_challenge/access_blocked uncertains');
  } else {
    fail('isChallengeResult misclassified a result');
  }

  const fellBackToActive = await checkUrlLivenessWithFallback(challengePage(), URL, {
    getHeadedPage: async () => livePage(),
  });
  if (fellBackToActive.result === 'active') {
    pass('Headed fallback recovers a challenge-blocked page as active');
  } else {
    fail(`Headed fallback did not recover page: ${fellBackToActive.result} (${fellBackToActive.code})`);
  }

  const noProvider = await checkUrlLivenessWithFallback(challengePage(), URL, {});
  if (noProvider.result === 'uncertain' && noProvider.code === 'bot_challenge') {
    pass('No fallback provider keeps the original challenge result');
  } else {
    fail(`Missing provider changed result to ${noProvider.result} (${noProvider.code})`);
  }

  const stillBlocked = await checkUrlLivenessWithFallback(challengePage(), URL, {
    getHeadedPage: async () => challengePage(),
  });
  if (stillBlocked.result === 'uncertain' && stillBlocked.code === 'bot_challenge'
      && /headed retry also blocked/.test(stillBlocked.reason)) {
    pass('Persistent challenge stays uncertain after headed retry (never upgraded to expired)');
  } else {
    fail(`Persistent challenge mishandled: ${stillBlocked.result} (${stillBlocked.code})`);
  }

  const noHeadedAvailable = await checkUrlLivenessWithFallback(challengePage(), URL, {
    getHeadedPage: async () => null, // headed launch failed (no display)
  });
  if (noHeadedAvailable.result === 'uncertain' && noHeadedAvailable.code === 'bot_challenge') {
    pass('Headless-only environment degrades to original challenge result');
  } else {
    fail(`No-display degrade path wrong: ${noHeadedAvailable.result} (${noHeadedAvailable.code})`);
  }

  // SSRF guard — `rejectPrivateOrInvalid` has to refuse every URL whose host
  // resolves to loopback / private / link-local space. The earlier guard only
  // matched literal IPv4 patterns and bracketless IPv6, so several Chromium-
  // routable bypasses (0.0.0.0, [::], [::1] (bracketed), [::ffff:127.0.0.1],
  // localhost.) slipped through. These cases keep that regression covered.
  const { rejectPrivateOrInvalid } = await import(
    pathToFileURL(join(ROOT, 'liveness-browser.mjs')).href
  );
  const blockCases = [
    ['http://0.0.0.0/admin', 'IPv4 all-zeros (Linux routes to loopback)'],
    ['http://[::]/', 'IPv6 all-zeros (Linux routes to loopback)'],
    ['http://[::1]/', 'IPv6 loopback (brackets included in url.hostname)'],
    ['http://[::ffff:127.0.0.1]/', 'IPv4-mapped IPv6 loopback (dotted form)'],
    ['http://[::ffff:7f00:1]/', 'IPv4-mapped IPv6 loopback (hex form)'],
    ['http://[::ffff:169.254.169.254]/', 'IPv4-mapped IPv6 link-local (cloud metadata)'],
    ['http://[fc00::1]/', 'IPv6 ULA (private)'],
    ['http://[fe80::1]/', 'IPv6 link-local'],
    ['http://localhost./', 'FQDN-trailing-dot localhost'],
    ['http://localhost.localdomain/', 'localhost.localdomain alias'],
    ['http://169.254.169.254/latest/meta-data/', 'cloud metadata IPv4 link-local'],
    ['http://10.0.0.5/', 'IPv4 RFC1918'],
  ];
  let blockMissed = 0;
  for (const [url, label] of blockCases) {
    const verdict = rejectPrivateOrInvalid(url);
    if (verdict?.code !== 'blocked_host') {
      fail(`SSRF guard missed ${label}: ${url} → ${verdict ? verdict.code : 'allowed'}`);
      blockMissed += 1;
    }
  }
  if (blockMissed === 0) pass(`SSRF guard blocks ${blockCases.length} known bypass vectors`);

  const allowCases = [
    'https://boards.greenhouse.io/example/jobs/123',
    'https://jobs.lever.co/example/abc-def',
    'https://example.com/careers/role',
    'https://www.pracuj.pl/praca/role,oferta,1234567',
  ];
  let allowDenied = 0;
  for (const url of allowCases) {
    if (rejectPrivateOrInvalid(url) !== null) {
      fail(`SSRF guard false-positive on legitimate ATS URL: ${url}`);
      allowDenied += 1;
    }
  }
  if (allowDenied === 0) pass('SSRF guard lets legitimate ATS URLs through');

  const protoCase = rejectPrivateOrInvalid('file:///etc/passwd');
  if (protoCase?.code === 'unsupported_protocol') {
    pass('SSRF guard rejects unsupported protocol');
  } else {
    fail(`SSRF guard let unsupported protocol through: ${protoCase?.code ?? 'allowed'}`);
  }

  // SSRF redirect routing tests — the static rejectPrivateOrInvalid check above
  // only sees the URL passed to checkUrlLiveness. A page that passes that check
  // and then redirects (or fetches a subresource from) a private IP used to
  // sail through untouched; checkUrlLiveness now registers a page.route()
  // interceptor that re-validates every request. These drive that interceptor
  // directly with a fake Playwright page (no browser launched).
  let routeCallback = null;
  const mockPageInstance = {
    _blockedByGuard: null,
    async route(pattern, callback) {
      routeCallback = callback;
    },
    async goto() {
      if (routeCallback) {
        let aborted = false;
        const mockRoute = {
          request: () => ({ url: () => 'http://127.0.0.1/sensitive-internal' }),
          abort: async () => {
            aborted = true;
          },
          continue: async () => {}
        };
        await routeCallback(mockRoute);
        if (aborted) {
          throw new Error('net::ERR_BLOCKED_BY_CLIENT');
        }
      }
      return { status: () => 200 };
    },
    async waitForTimeout() {},
    url() { return 'https://example.com/redirected'; },
    async evaluate() { return 'body text'; }
  };

  const redirectResult = await checkUrlLiveness(mockPageInstance, 'https://example.com/public-landing');
  if (redirectResult.result === 'uncertain' && redirectResult.code === 'blocked_host') {
    pass('SSRF redirect guard blocks redirects/subresources to private IPs via routing');
  } else {
    fail(`SSRF redirect guard failed to block: ${JSON.stringify(redirectResult)}`);
  }

  let legitimateRouteCallback = null;
  const mockPageLegitimate = {
    _blockedByGuard: null,
    async route(pattern, callback) {
      legitimateRouteCallback = callback;
    },
    async goto() {
      if (legitimateRouteCallback) {
        let continued = false;
        const mockRoute = {
          request: () => ({ url: () => 'https://example.com/assets/logo.png' }),
          abort: async () => {},
          continue: async () => {
            continued = true;
          }
        };
        await legitimateRouteCallback(mockRoute);
        if (!continued) {
          throw new Error('Blocked legitimate request');
        }
      }
      return { status: () => 200 };
    },
    async waitForTimeout() {},
    url() { return 'https://example.com'; },
    async evaluate(fn) {
      // simulate evaluating body/controls
      const fnStr = fn.toString();
      if (fnStr.includes('body')) {
        return 'legitimate page body';
      }
      return ['Apply'];
    }
  };

  const legitimateResult = await checkUrlLiveness(mockPageLegitimate, 'https://example.com');
  if (legitimateResult.result === 'active') {
    pass('SSRF redirect guard allows legitimate subresource requests');
  } else {
    fail(`SSRF redirect guard blocked legitimate requests: ${JSON.stringify(legitimateResult)}`);
  }
} catch (e) {
  fail(`Liveness classification tests crashed: ${e.message}`);
}

// ── 5. DATA CONTRACT ────────────────────────────────────────────

console.log('\n5. Data contract validation');

// Check system files exist
const systemFiles = [
  'CLAUDE.md', 'OPENCODE.md', 'VERSION', 'DATA_CONTRACT.md',
  'modes/_shared.md', 'modes/_profile.template.md',
  'modes/oferta.md', 'modes/pdf.md', 'modes/scan.md',
  'templates/states.yml', 'templates/cv-template.html',
  '.claude/skills/career-ops/SKILL.md',
  '.opencode/skills/career-ops/SKILL.md',
  '.antigravitycli/skills/career-ops/SKILL.md',
];

for (const f of systemFiles) {
  if (fileExists(f)) {
    pass(`System file exists: ${f}`);
  } else {
    fail(`Missing system file: ${f}`);
  }
}

// Check user files are NOT tracked (gitignored)
const userFiles = [
  'config/profile.yml', 'modes/_profile.md', 'portals.yml',
];
for (const f of userFiles) {
  const tracked = run('git', ['ls-files', f]);
  if (tracked === '') {
    pass(`User file gitignored: ${f}`);
  } else if (tracked === null) {
    pass(`User file gitignored: ${f}`);
  } else {
    fail(`User file IS tracked (should be gitignored): ${f}`);
  }
}

const batchRunnerSource = readFile('batch/batch-runner.sh');
// Match any update_state entrypoint (bare, _retrying, _unlocked) so this asserts
// the gate's ordering rather than one spelling of the call.
const SKIPPED_STATE_WRITE = /update_state(?:_retrying|_unlocked)? "\$id" "\$url" "skipped"/;
const COMPLETED_STATE_WRITE = /update_state(?:_retrying|_unlocked)? "\$id" "\$url" "completed"/;
const minScoreSkipIndex = batchRunnerSource.search(SKIPPED_STATE_WRITE);
let minScoreReturnIndex = -1;
let completedStateIndex = -1;
if (minScoreSkipIndex !== -1) {
  minScoreReturnIndex = batchRunnerSource.indexOf('return 0', minScoreSkipIndex);
  const completedOffset = batchRunnerSource.slice(minScoreSkipIndex).search(COMPLETED_STATE_WRITE);
  completedStateIndex = completedOffset === -1 ? -1 : minScoreSkipIndex + completedOffset;
}
if (
  minScoreSkipIndex !== -1 &&
  minScoreReturnIndex !== -1 &&
  completedStateIndex !== -1 &&
  minScoreSkipIndex < minScoreReturnIndex &&
  minScoreReturnIndex < completedStateIndex
) {
  pass('Batch min-score gate returns before completed state update');
} else {
  fail('Batch min-score gate can fall through to completed state update');
}

if (/if \[\[ "\$status" == "completed" \|\| "\$status" == "skipped" \]\]/.test(batchRunnerSource)) {
  pass('Batch resume treats min-score skipped offers as terminal');
} else {
  fail('Batch resume can reprocess min-score skipped offers');
}

if (/local total=0 completed=0 skipped=0 failed=0 pending=0/.test(batchRunnerSource) &&
    /skipped\) skipped=\$\(\(skipped \+ 1\)\)/.test(batchRunnerSource) &&
    /Completed: \$completed \| Skipped: \$skipped \| Failed: \$failed \| Pending: \$pending/.test(batchRunnerSource)) {
  pass('Batch summary reports skipped offers separately from pending');
} else {
  fail('Batch summary can misreport skipped offers as pending');
}

// ── 6. PERSONAL DATA LEAK CHECK ─────────────────────────────────

console.log('\n6. Personal data leak check');

const leakPatterns = [
  'Santiago', 'santifer.io', 'Santifer iRepair', 'Zinkee', 'ALMAS',
  'hi@santifer.io', '688921377', '/Users/santifer/',
];

const scanExtensions = ['md', 'yml', 'html', 'mjs', 'sh', 'go', 'json'];
const allowedFiles = [
  // English README + localized translations (all legitimately credit Santiago)
  'README.md', 'README.es.md', 'README.fr.md', 'README.ja.md', 'README.ko-KR.md',
  'README.pt-BR.md', 'README.ru.md', 'README.cn.md', 'README.zh-TW.md',
  // Standard project files
  'LICENSE', 'CITATION.cff', 'CONTRIBUTING.md', 'CHANGELOG.md', 'TRADEMARK.md',
  'package.json', '.github/FUNDING.yml', 'CLAUDE.md', 'AGENTS.md', 'go.mod', 'test-all.mjs',
  '.claude-plugin/marketplace.json', '.claude-plugin/plugin.json',
  // Community / governance files (added in v1.3.0, all legitimately reference the maintainer)
  'CODE_OF_CONDUCT.md', 'GOVERNANCE.md', 'SECURITY.md', 'SUPPORT.md',
  '.github/SECURITY.md',
  // Upstream-author provenance credit
  'NOTICE.md',
];

// Build pathspec for git grep — only scan tracked files matching these
// extensions. This is what `grep -rn` was trying to do, but git-aware:
// untracked files (debate artifacts, AI tool scratch, local plans/) and
// gitignored files can't trigger false positives because they were never
// going to reach a commit anyway.
// argv form, not a shell string: run() is allowlist-only and never spawns a
// shell, so the pathspecs go across as separate argv entries (no quoting) and
// git's own stderr is dropped via stdio rather than `2>/dev/null`.
const grepPathspec = scanExtensions.map(e => `*.${e}`);

let leakFound = false;
for (const pattern of leakPatterns) {
  const result = run(
    'git',
    ['grep', '-n', pattern, '--', ...grepPathspec],
    { stdio: ['ignore', 'pipe', 'ignore'] }
  );
  if (result) {
    for (const line of result.split('\n')) {
      const file = line.split(':')[0];
      if (allowedFiles.some(a => file.includes(a))) continue;
      if (file.includes('dashboard/go.mod')) continue;
      warn(`Possible personal data in ${file}: "${pattern}"`);
      leakFound = true;
    }
  }
}
if (!leakFound) {
  pass('No personal data leaks outside allowed files');
}

// ── 7. ABSOLUTE PATH CHECK ──────────────────────────────────────

console.log('\n7. Absolute path check');

// Same git grep approach: only scans tracked files. Untracked AI tool
// outputs, local debate artifacts, etc. can't false-positive here.
// The `| grep -v ...` chain moved into JS: run() spawns no shell, so a pipeline
// can't be expressed as a command string any more. Same exclusions, same result.
const ABS_PATH_EXCLUDED = ['README.md', 'LICENSE', 'CLAUDE.md', 'test-all.mjs'];
const absPathResult = (run(
  'git',
  ['grep', '-n', '/Users/', '--', '*.mjs', '*.sh', '*.md', '*.go', '*.yml'],
  { stdio: ['ignore', 'pipe', 'ignore'] }
) || '')
  .split('\n')
  .filter(line => line && !ABS_PATH_EXCLUDED.some(f => line.includes(f)))
  .join('\n');
if (!absPathResult) {
  pass('No absolute paths in code files');
} else {
  for (const line of absPathResult.split('\n').filter(Boolean)) {
    fail(`Absolute path: ${line.slice(0, 100)}`);
  }
}

// ── 7b. PDF RENDER WAIT CONDITION ───────────────────────────────

console.log('\n7b. PDF render wait condition');

const generatePdfScript = readFile('generate-pdf.mjs');
if (/waitUntil:\s*['"]load['"]/.test(generatePdfScript)) {
  pass('generate-pdf waits for load before rendering');
} else {
  fail('generate-pdf does not wait for load before rendering');
}
if (!/waitUntil:\s*['"]networkidle['"]/.test(generatePdfScript)) {
  pass('generate-pdf does not wait for networkidle');
} else {
  fail('generate-pdf still waits for networkidle');
}

// ── 8. MODE FILE INTEGRITY ──────────────────────────────────────

console.log('\n8. Mode file integrity');

const expectedModes = [
  '_shared.md', '_profile.template.md', 'oferta.md', 'pdf.md', 'scan.md',
  'batch.md', 'apply.md', 'auto-pipeline.md', 'contacto.md', 'deep.md',
  'ofertas.md', 'pipeline.md', 'project.md', 'tracker.md', 'training.md',
  'interview.md', 'latex.md',
];

for (const mode of expectedModes) {
  if (fileExists(`modes/${mode}`)) {
    pass(`Mode exists: ${mode}`);
  } else {
    fail(`Missing mode: ${mode}`);
  }
}

// Check _shared.md references _profile.md
const shared = readFile('modes/_shared.md');
if (shared.includes('_profile.md')) {
  pass('_shared.md references _profile.md');
} else {
  fail('_shared.md does NOT reference _profile.md');
}

for (const skillPath of ['.claude/skills/career-ops/SKILL.md', '.agents/skills/career-ops/SKILL.md']) {
  if (!fileExists(skillPath)) {
    fail(`${skillPath} is missing`);
    continue;
  }
  const skill = readFile(skillPath);
  if (skill.includes('/career-ops latex')) {
    pass(`${skillPath} exposes /career-ops latex in discovery menu`);
  } else {
    fail(`${skillPath} does not expose /career-ops latex in discovery menu`);
  }
}

const applyMode = readFile('modes/apply.md');
if (
  applyMode.includes('## Step 5 — Preflight gate') &&
  applyMode.includes('verify liveness with Playwright') &&
  applyMode.includes('matching report has been loaded') &&
  applyMode.includes('Do not continue to Step 6 until this preflight is resolved') &&
  applyMode.includes('refuse to generate final copy')
) {
  pass('apply mode includes liveness and role-match preflight gate');
} else {
  fail('apply mode missing liveness/role-match preflight gate');
}

function readOfertaMode() {
  return readFile('modes/oferta.md')
    .replace(/^\*\*\d+\. .+?\*\*\. Read `(modes\/oferta-signals\/[^`]+)` when .*$/gm, (_, file) => readFile(file));
}
const ofertaMode = readOfertaMode();
const autoPipelineMode = readFile('modes/auto-pipeline.md');
if (
  ofertaMode.includes('## Liveness gate (URL inputs)') &&
  ofertaMode.includes('closed posting evidence') &&
  ofertaMode.includes('Do not continue to Block A until this gate is resolved') &&
  autoPipelineMode.includes('## Step 0.5 — Liveness gate') &&
  autoPipelineMode.includes('closed posting evidence') &&
  autoPipelineMode.includes('Do not continue to Step 1 until this gate is resolved')
) {
  pass('eval modes (oferta/auto-pipeline) gate dead links before evaluation');
} else {
  fail('eval modes missing liveness gate before evaluation');
}

// --- Block G pay-transparency range-width signal (#2019, re-scoped #2280) ---
{
  // Maintainer direction (#2280): the jurisdiction table is gone — no
  // external YAML, no legal threshold. Only the self-computed range-width
  // heuristic (former 13a) survives; the corroborating missing-range
  // sub-signal (former 13b) had no trigger without the table and was removed
  // with it.
  const ptPath = join(ROOT, 'templates', 'pay-transparency.yml');
  if (existsSync(ptPath)) {
    fail('templates/pay-transparency.yml should have been removed per maintainer direction (#2280)');
  } else {
    pass('templates/pay-transparency.yml removed — no jurisdiction table remains (#2280)');
  }

  // oferta.md carries the standalone, table-free range-width signal
  const ptStart = ofertaMode.indexOf('Pay-Transparency Range-Width Check');
  const ptEnd = ofertaMode.indexOf('### Output format:', Math.max(ptStart, 0));
  const ptSection = ptStart >= 0 && ptEnd > ptStart ? ofertaMode.slice(ptStart, ptEnd) : '';
  if (
    ptSection &&
    !ptSection.includes('templates/pay-transparency.yml') &&
    !/13b/.test(ptSection) &&
    ptSection.includes('general heuristic') &&
    ptSection.includes('top - bottom > 0.5 × bottom') &&
    ptSection.includes('Phrasing discipline (mandatory)') &&
    ptSection.includes('not legal advice')
  ) {
    pass('oferta Block G has the table-free, self-computed pay-transparency range-width signal (#2280)');
  } else {
    fail('oferta Block G missing/incomplete pay-transparency range-width section — needs table-free arithmetic heuristic, "general heuristic" framing, the documented threshold formula (top - bottom > 0.5 × bottom), phrasing discipline, not-legal-advice note, and no leftover table/13b references (#2280)');
  }

  // Phrasing discipline holds in the report-facing text: the blockquote
  // template the agent renders must state facts, never legal accusations.
  // (The rule text itself may quote the banned phrases to forbid them,
  // so only '>' lines — the rendered output templates — are scanned.)
  const ptQuoteLines = ptSection.split('\n').filter((l) => l.trimStart().startsWith('>'));
  const accusatory = ptQuoteLines.filter((l) => /illegal|violation|breaking the law/i.test(l));
  if (ptSection && ptQuoteLines.length >= 1 && accusatory.length === 0) {
    pass('pay-transparency report template states facts only — no "illegal"/"violation"/"breaking the law" assertions (#2280)');
  } else {
    fail(`pay-transparency phrasing discipline broken: ${accusatory.length ? `accusatory blockquote line(s): ${accusatory[0].trim().slice(0, 80)}` : 'expected 1+ blockquote output template in the section'} (#2280)`);
  }
}

// --- Block G minimum-wage lawyer question (#2025, reshaped #2280) ---
// Per maintainer direction on #2027: no jurisdiction wage table, no
// comparison/assertion against any statutory rate. This signal only does
// the arithmetic that needs no legal table (offer -> comparable hourly
// figure) and routes the actual compliance question to a lawyer.
{
  // 1. templates/minimum-wage.yml must be GONE — the reshape's whole point
  //    is that no rate table should exist to go stale.
  const mwPath = join(ROOT, 'templates', 'minimum-wage.yml');
  if (!existsSync(mwPath)) {
    pass('templates/minimum-wage.yml removed — no jurisdiction wage table ships (#2280)');
  } else {
    fail('templates/minimum-wage.yml still exists — maintainer direction on #2027/#2280 was to drop the rate table entirely');
  }

  // 2. oferta.md carries the reshaped section: no reference to the deleted
  //    table, jurisdiction still resolved strictly from the JD (no
  //    config/profile.yml fallback), the fixed-cash comparable-amount gate
  //    and JD-hours-first normalization are preserved, and no staleness/
  //    carve-out-eligibility machinery (which existed only to support the
  //    now-deleted table comparison) remains.
  const mwStart = ofertaMode.indexOf('**14. Minimum-Wage Lawyer Question**');
  const mwEnd = ofertaMode.indexOf('### Output format:', Math.max(mwStart, 0));
  const mwSection = mwStart >= 0 && mwEnd > mwStart ? ofertaMode.slice(mwStart, mwEnd) : '';
  if (
    mwSection &&
    !mwSection.includes('templates/minimum-wage.yml') &&
    mwSection.includes('NEVER from `config/profile.yml`') &&
    mwSection.includes('Comparable-amount gate (mandatory)') &&
    mwSection.includes('guaranteed, fixed cash amount') &&
    mwSection.includes('bonuses, commissions, allowances, overtime pay, 13th-month') &&
    mwSection.includes("JD's own stated working hours") &&
    mwSection.includes('2080 hours/year') &&
    mwSection.includes('always disclose in the output which hours figure was used') &&
    mwSection.includes('Jurisdiction resolution (mandatory)') &&
    mwSection.includes('[ask your lawyer]') &&
    mwSection.includes('never conditioned on whether') &&
    !mwSection.includes('staleness gate') &&
    !mwSection.includes('Carve-out honesty') &&
    !mwSection.includes('as_of') &&
    !mwSection.includes('reference rate')
  ) {
    pass('oferta Block G signal 13 dropped the wage-table reference and staleness/carve-out-eligibility machinery while keeping jurisdiction-strict resolution (no profile fallback), the fixed-cash comparable-amount gate, and JD-hours-first normalization (#2280)');
  } else {
    fail('oferta Block G signal 13 missing/incomplete post-#2280 reshape — needs: no templates/minimum-wage.yml reference, jurisdiction still resolved strictly from the JD only, fixed-cash comparable-amount gate excluding ranges/variable comp, JD-hours-first normalization with 2080 fallback disclosure, [ask your lawyer] routing, unconditional firing rule, AND removal of the old staleness gate / carve-out-honesty / as_of / reference-rate language that only made sense with a table (#2280)');
  }

  // 3. Phrasing discipline: the rendered blockquote must never assert or
  //    imply a current statutory minimum wage, never claim compliance either
  //    way, and must route to [ask your lawyer]. (The rule text itself may
  //    quote banned phrases to forbid them, so only '>' lines — the
  //    rendered output template — are scanned.)
  const mwQuoteLines = mwSection.split('\n').filter((l) => l.trimStart().startsWith('>'));
  const mwAccusatory = mwQuoteLines.filter((l) => /illegal|violation|breaking the law/i.test(l));
  const mwHasLawyerRouting = mwQuoteLines.some((l) => l.includes('[ask your lawyer]'));
  if (mwSection && mwQuoteLines.length >= 1 && mwAccusatory.length === 0 && mwHasLawyerRouting) {
    pass('minimum-wage report template routes to [ask your lawyer] with no "illegal"/"violation"/"breaking the law" assertions (#2280)');
  } else {
    fail(`minimum-wage phrasing discipline broken: ${mwAccusatory.length ? `accusatory blockquote line(s): ${mwAccusatory[0].trim().slice(0, 80)}` : (!mwHasLawyerRouting ? 'missing [ask your lawyer] routing in rendered blockquote' : 'expected a blockquote output template in the section')} (#2280)`);
  }

  // 4. The rendered lawyer question must follow santifer's exact shape from
  //    his #2027 comment: computed hourly figure, hours basis disclosed,
  //    jurisdiction name, statutory-minimum question, AND a mention of
  //    special rates (student/homeworker) as a prompt — never an assertion
  //    of eligibility, since there is no table to judge that from anymore.
  const mwHandoffQuote = mwQuoteLines.find((l) => l.includes('[ask your lawyer]')) || '';
  if (
    /\/hour/i.test(mwHandoffQuote) &&
    /statutory minimum/i.test(mwHandoffQuote) &&
    /jurisdiction_name|\{jurisdiction/i.test(mwHandoffQuote) &&
    /student/i.test(mwHandoffQuote) &&
    /homeworker/i.test(mwHandoffQuote)
  ) {
    pass('minimum-wage lawyer question follows the maintainer-specified shape: computed hourly figure, jurisdiction placeholder, statutory-minimum question, special-rates (student/homeworker) prompt (#2280)');
  } else {
    fail('minimum-wage lawyer question does not match the maintainer-specified shape — must include the hourly figure, the jurisdiction placeholder, the statutory-minimum question, and a student/homeworker special-rates prompt (#2280)');
  }

  // 5. Behavioral test for the hourly-conversion arithmetic itself (the part
  //    of the old algorithm that survives the reshape unchanged): fixed
  //    cash amount -> comparable hourly figure, JD-stated hours preferred,
  //    2080-hour fallback only when the JD is silent, ranges/variable comp
  //    excluded by the comparable-amount gate.
  {
    function computeHourlyFigure({ advertisedComp, isRange, isVariable, period, jdStatedHoursPerYear }) {
      if (advertisedComp == null || isRange || isVariable) return { skip: true };
      if (period === 'hourly') {
        return { skip: false, hourly: advertisedComp, hoursBasis: 'n/a (already hourly)' };
      }
      let annual = period === 'monthly' ? advertisedComp * 12 : advertisedComp;
      const hoursPerYear = jdStatedHoursPerYear ?? 2080;
      const hoursBasis = jdStatedHoursPerYear ? 'JD-stated' : '2080-hour fallback';
      if (!hoursPerYear) return { skip: true };
      return { skip: false, hourly: annual / hoursPerYear, hoursBasis };
    }

    // (a) already hourly -> passthrough
    const hourly = computeHourlyFigure({ advertisedComp: 22.50, isRange: false, isVariable: false, period: 'hourly' });
    // (b) annual, JD states 37.5 hrs/week * 52 = 1950 hrs/year -> preferred over 2080
    const annualJdHours = computeHourlyFigure({ advertisedComp: 62400, isRange: false, isVariable: false, period: 'annual', jdStatedHoursPerYear: 1950 });
    // (c) annual, JD silent on hours -> 2080 fallback
    const annualFallback = computeHourlyFigure({ advertisedComp: 62400, isRange: false, isVariable: false, period: 'annual' });
    // (d) monthly -> annualized first, then converted
    const monthly = computeHourlyFigure({ advertisedComp: 5000, isRange: false, isVariable: false, period: 'monthly' });
    // (e) comparable-amount gate: range excluded
    const rangeSkipped = computeHourlyFigure({ advertisedComp: 17, isRange: true, isVariable: false, period: 'hourly' });
    // (f) comparable-amount gate: variable comp (bonus/commission) excluded
    const variableSkipped = computeHourlyFigure({ advertisedComp: 5000, isRange: false, isVariable: true, period: 'annual' });
    // (g) null advertised_comp -> skip (pay-transparency signal's territory)
    const nullSkipped = computeHourlyFigure({ advertisedComp: null, isRange: false, isVariable: false, period: 'hourly' });

    const arithmeticOk =
      !hourly.skip && hourly.hourly === 22.50 &&
      !annualJdHours.skip && Math.abs(annualJdHours.hourly - 32) < 0.001 && annualJdHours.hoursBasis === 'JD-stated' &&
      !annualFallback.skip && Math.abs(annualFallback.hourly - 30) < 0.001 && annualFallback.hoursBasis === '2080-hour fallback' &&
      !monthly.skip && Math.abs(monthly.hourly - (60000 / 2080)) < 0.001 &&
      rangeSkipped.skip === true &&
      variableSkipped.skip === true &&
      nullSkipped.skip === true;

    if (arithmeticOk) {
      pass('hourly-conversion arithmetic correctly passes through hourly figures, prefers JD-stated hours over the 2080 fallback, annualizes monthly pay before converting, and the comparable-amount gate excludes ranges/variable comp/null advertised_comp (#2280)');
    } else {
      fail(`hourly-conversion arithmetic produced wrong results: hourly=${JSON.stringify(hourly)} annualJdHours=${JSON.stringify(annualJdHours)} annualFallback=${JSON.stringify(annualFallback)} monthly=${JSON.stringify(monthly)} rangeSkipped=${JSON.stringify(rangeSkipped)} variableSkipped=${JSON.stringify(variableSkipped)} nullSkipped=${JSON.stringify(nullSkipped)} (#2280)`);
    }
  }

  // 6. Signal-13 boundary check: signal 13 is the last numbered Block G
  //    signal before "### Output format:", so slicing it for phrasing
  //    checks elsewhere in this file must not accidentally swallow the
  //    output-format section.
  if (mwEnd > mwStart && mwStart >= 0) {
    pass('signal-13 section boundary (start of signal 13 to "### Output format:") resolved correctly for slicing (#2280)');
  } else {
    fail('could not locate signal 14 ("**14. Minimum-Wage Lawyer Question**") or its end boundary in modes/oferta.md (#2280)');
  }
}

// offer-prep is read here because the sub-statutory block below asserts against it;
// upstream defines it in the same place for the same reason.
const offerPrepMode = fileExists('modes/offer-prep.md') ? readFile('modes/offer-prep.md') : '';

// --- offer-prep sub-statutory-terms lawyer question (#2039, reworked per #2280) ---
// santifer's direction on PR #2042 (2026-07-29, reasoning in #2280): a
// jurisdiction table of category-regulation flags (floor_categories,
// void_doctrine) is a live legal fact this system can never verify or
// notice going stale, same as #2027's minimum-wage table — a stale flag
// with a citation is worse than no flag at all. templates/statutory-
// employment-minimums.yml is deleted entirely (no flags-only shape either).
// modes/offer-prep.md now only restates the clause's own stated term (no
// legal table needed) and routes the statutory-floor and voiding-doctrine
// questions to the lawyer unconditionally, for every jurisdiction, never
// gated on a table row. Tests below assert the table is gone and the
// section fires the lawyer questions without any table-backed gating.
{
  // 1. The table is gone, not merely emptied.
  const semPath = join(ROOT, 'templates', 'statutory-employment-minimums.yml');
  if (!existsSync(semPath)) {
    pass('templates/statutory-employment-minimums.yml deleted per maintainer direction (#2039, #2280)');
  } else {
    fail('templates/statutory-employment-minimums.yml should be deleted entirely per #2280 — a live legal fact this system cannot verify or notice going stale, same reasoning as #2027s minimum-wage table');
  }

  // templates/README.md carries no row for the deleted table.
  const templatesReadme = readFile('templates/README.md');
  if (!templatesReadme.includes('statutory-employment-minimums.yml')) {
    pass('templates/README.md carries no row for the deleted statutory-employment-minimums.yml (#2280)');
  } else {
    fail('templates/README.md still references statutory-employment-minimums.yml, which was deleted per #2280');
  }

  // 2. offer-prep carries the sub-statutory-terms subsection, reworked to
  //    route unconditionally to the lawyer list with no table lookup, no
  //    floor_categories/void_doctrine gating, and no reintroduced ESA
  //    figures or Waksdale narrative.
  const semStart = offerPrepMode.indexOf('Sub-statutory-terms lawyer question');
  const semEnd = offerPrepMode.indexOf('## Step 3', Math.max(semStart, 0));
  const semSection = semStart >= 0 && semEnd > semStart ? offerPrepMode.slice(semStart, semEnd) : '';
  if (
    semSection.includes('Questions for your lawyer') &&
    semSection.includes('#2280') &&
    /gone and is not coming back in any shape/.test(semSection) &&
    /Never assert a floor value, a regulation flag, a doctrine holding,\s+voidness, or violation\s+\(HARD RULE\)/.test(semSection) &&
    semSection.includes('always a lawyer question') &&
    semSection.includes('Render in {language.output}') &&
    /no floor-figure statements,\s+no regulation-flag statements/.test(semSection) &&
    /never computes, estimates, or\s+ranges a notice or severance amount/.test(semSection) &&
    // must NOT reference the deleted table's path, or gate any behavior on
    // its removed flag fields — `floor_categories`/`void_doctrine` may each
    // appear at most once, in the single historical sentence explaining
    // what the deleted table used to carry (not as active gating logic).
    !semSection.includes('templates/statutory-employment-minimums.yml') &&
    (semSection.match(/floor_categories/g) || []).length <= 1 &&
    (semSection.match(/void_doctrine/g) || []).length <= 1 &&
    !semSection.includes('Floors-absent silence') &&
    !semSection.includes('floorMatch') &&
    !semSection.includes('voidDoctrineMatch') &&
    // must NOT reintroduce the removed floor value / doctrine narrative, and
    // must NOT reintroduce a named case/doctrine (e.g. Bardal) as a factor
    // list or asserted holding — a bare case citation belongs only in
    // restrictive-covenants.yml's own `sources` field, never narrated here
    !/2 weeks|3 weeks|8 weeks|26 weeks/.test(semSection) &&
    !/Waksdale|ONCA 391|wilful.misconduct standard|Bardal/i.test(semSection)
  ) {
    pass('offer-prep sub-statutory-terms subsection documents the table deletion per #2280, routes unconditionally to lawyer questions with no table lookup or category/doctrine gating, never-assert hard rule, {language.output} rendering, no-calculations non-goal — and carries no reintroduced statutory figures or doctrine narrative (#2039, #2280)');
  } else {
    fail('offer-prep sub-statutory-terms subsection missing/incomplete, or still asserts a specific floor value / regulation flag / doctrine holding, or still gates on a table lookup — needs the #2280 table-deletion rationale, unconditional lawyer-question routing, the floor-value/flag/doctrine never-assert hard rule, {language.output} rendering, no-calculations non-goal, and must not restate the removed ESA figures or Waksdale narrative (#2039, #2280)');
  }

  // 3. Lawyer-question workflow: both the floor question and the
  //    doctrine-directed question are present, fire unconditionally (no
  //    table-flag gating), explicitly ask the lawyer for the current
  //    figure/effect rather than the mode asserting one, and are routed
  //    through {language.output} rendering at the presentation boundary.
  const semLawyerBlock = semSection.slice(
    Math.max(0, semSection.indexOf('Questions for your lawyer')),
    semSection.indexOf('candidate-empowering angle') > 0
      ? semSection.indexOf('candidate-empowering angle')
      : undefined
  );
  if (
    /at or above the statutory minimum/i.test(semLawyerBlock) &&
    /does this clause meet it/i.test(semLawyerBlock) &&
    /could void the whole clause/i.test(semLawyerBlock) &&
    !/void_doctrine: true/.test(semLawyerBlock) &&
    (semLawyerBlock.match(/Render in \{language\.output\}/g) || []).length >= 2
  ) {
    pass('sub-statutory-terms lawyer-question workflow generates both the statutory-floor question and the doctrine-directed question unconditionally (no table-flag gating), each asking the lawyer for the current figure/effect (never asserting one) and each rendered via [Render in {language.output}] at the presentation boundary (#2039, #2280)');
  } else {
    fail('sub-statutory-terms lawyer-question workflow incomplete — needs a statutory-floor question asking the lawyer for the current minimum, a doctrine-directed question about whether a defect could void the whole clause, both firing unconditionally with no void_doctrine table-flag gating, and both rendered via [Render in {language.output}] (#2039, #2280)');
  }

  // 4. Phrasing discipline holds in the report-facing text: no rendered
  //    output template may assert a specific floor value, a regulation
  //    flag, a doctrine holding, or a verdict about the candidate's own
  //    clause. Only '>' lines (rendered output templates) are scanned.
  const semQuoteLines = semSection.split('\n').filter((l) => l.trimStart().startsWith('>'));
  const semAssertive = semQuoteLines.filter((l) =>
    /(this|your|the candidate'?s?) (specific )?(clause|provision|term|contract) (is|would be|will be) (void|illegal|unenforceable|invalid|below the (statutory )?floor|in violation)/i.test(l)
  );
  const semFigureLeak = semQuoteLines.filter((l) => /Waksdale|ONCA 391|\b2 weeks\b|\b8 weeks\b|\b26 weeks\b/i.test(l));
  if (semSection && semQuoteLines.length >= 1 && semAssertive.length === 0 && semFigureLeak.length === 0) {
    pass('sub-statutory-terms rendered templates state only the clause\'s own term + the lawyer question — no void/illegal/unenforceable/below-the-floor assertions and no reintroduced statutory figures or doctrine names (#2039, #2280)');
  } else {
    fail(`sub-statutory-terms phrasing discipline broken: ${semAssertive.length ? `clause-directed verdict in blockquote: ${semAssertive[0].trim().slice(0, 80)}` : semFigureLeak.length ? `reintroduced statutory figure/doctrine name in blockquote: ${semFigureLeak[0].trim().slice(0, 80)}` : 'expected a blockquote output template in the section'} (#2039)`);
  }
}


const pipelineMode = readFile('modes/pipeline.md');
if (
  pipelineMode.includes('## Liveness sweep') &&
  pipelineMode.includes('check-liveness.mjs') &&
  pipelineMode.includes('unconfirmed') &&
  pipelineMode.includes('Do not') &&
  pipelineMode.includes('liveness sweep')
) {
  pass('pipeline mode sweeps unconfirmed entries for liveness before processing');
} else {
  fail('pipeline mode missing batch liveness sweep for unconfirmed entries');
}

const expandMode = readFile('modes/expand.md');
if (
  expandMode.includes('never fetch unlinked URLs') &&
  expandMode.includes('halt until explicit approval is given') &&
  expandMode.includes('node add-entry.mjs') &&
  expandMode.includes('--stdin') &&
  expandMode.includes('Additive Only') &&
  expandMode.includes('Treat fetched evidence text as literal')
) {
  pass('expand mode includes url limits, confirm gate, add-entry funneling, additive-only, and literal evidence rules');
} else {
  fail('expand mode missing required behavior boundaries (url limits, confirm gate, additive-only, literal evidence, add-entry funneling)');
}

// Same shape, for the untrusted-external-content directive (security sync
// #2368): every mode that ingests raw external text must reference the
// canonical AGENTS.md rule, or a new/edited mode can silently lose it with
// no signal until it's exploited. Runs against the real ROOT tree — the
// --self-test entry above only exercises the pure matcher functions.
{
  const untrusted = spawnSync(process.execPath, [join(ROOT, 'validate-untrusted-content-coverage.mjs')], {
    cwd: ROOT,
    encoding: 'utf-8',
  });
  if (untrusted.status === 0) {
    pass('canonical untrusted-external-content directive is present and referenced by every ingesting mode');
  } else {
    fail(`Untrusted-content directive coverage gap:\n${(untrusted.stderr || untrusted.stdout || '').trim()}`);
  }
}

// ── 9. LOCAL PARSER CONTRACT ────────────────────────────────────

console.log('\n9. Local parser contract');

const scanScript = readFile('scan.mjs');
if (
  scanScript.includes('typeof entry.name !== \'string\'') &&
  scanScript.includes('entry.name.trim()') &&
  scanScript.includes('entry.name.toLowerCase()')
) {
  pass('scan.mjs guards company names before filtering');
} else {
  fail('scan.mjs does not guard company names before filtering');
}

if (
  scanScript.includes("skipIds: ['local-parser']") &&
  scanScript.includes('local parser failed, used API fallback') &&
  scanScript.includes('resolveProvider(company, providers')
) {
  pass('scan.mjs falls back to ATS API when local parser fails');
} else {
  fail('scan.mjs does not fall back to ATS API when local parser fails');
}

if (fileExists('providers/local-parser.mjs')) {
  pass('local-parser provider module exists');
} else {
  fail('local-parser provider module is missing');
}

const scanMode = fileExists('modes/scan.md') ? readFile('modes/scan.md') : '';
if (
  scanMode.includes('local_parser_ok') &&
  (scanMode.includes('No Expensive Scraping Repetition') || scanMode.includes('no repetir scraping caro')) &&
  (scanMode.includes('name not listed in `local_parser_ok`') || scanMode.includes('nombre no listado en `local_parser_ok`'))
) {
  pass('scan.md skips expensive levels after successful local parser');
} else {
  fail('scan.md missing local_parser_ok skip rules for agent scan');
}

if (!fileExists('scripts/parsers/cohere_jobs.py')) {
  pass('Cohere parser example is not bundled as a runtime script');
} else {
  fail('Cohere parser example is still bundled as a runtime script');
}

const portalExample = readFile('templates/portals.example.yml');
if (
  portalExample.includes('script: local/example-js-company-jobs.js') &&
  portalExample.includes('script: local/example_python_company_jobs.py') &&
  !/^\s*#?\s*script:\s*['"]?scripts\/parsers\//m.test(portalExample)
) {
  pass('portals example points the local-parser script at a gitignored path');
} else {
  fail('portals example local-parser script is under the Git-tracked scripts/parsers/');
}

// Security hardening: command allowlist, in-repo script containment, careers_url/company validation.
try {
  const localParser = (await import(pathToFileURL(join(ROOT, 'providers/local-parser.mjs')).href)).default;

  if (localParser.detect({ name: 'X', careers_url: 'https://x.co', parser: { command: 'rm' } }) === null) {
    pass('local-parser rejects a non-interpreter command (e.g. rm)');
  } else {
    fail('local-parser should reject a command that is not a whitelisted interpreter or in-repo script');
  }

  if (localParser.detect({ name: 'X', careers_url: 'https://x.co', parser: { command: 'python3', script: '/etc/passwd' } }) === null) {
    pass('local-parser rejects a script outside the project root');
  } else {
    fail('local-parser should reject a script path that escapes the project root');
  }

  const okEntry = localParser.detect({
    name: 'X', careers_url: 'https://x.co',
    parser: { command: 'node', script: 'scan.mjs' },
  });
  if (okEntry && okEntry.url) pass('local-parser accepts a whitelisted interpreter + an in-repo script');
  else fail('local-parser should accept a whitelisted interpreter with an in-repo script');

  let rejectedUrl = false;
  try {
    await localParser.fetch({ name: 'X', careers_url: '--oops', parser: { command: 'python3', args: ['--url', '{careers_url}'] } });
  } catch (e) {
    rejectedUrl = /careers_url/.test(e.message);
  }
  if (rejectedUrl) pass('local-parser rejects a non-URL careers_url before spawning (argument injection guard)');
  else fail('local-parser should reject a careers_url that is not http(s)');

  let rejectedCompany = false;
  try {
    await localParser.fetch({ name: '--rf', careers_url: 'https://x.co', parser: { command: 'python3', args: ['--company', '{company}'] } });
  } catch (e) {
    rejectedCompany = /company/.test(e.message);
  }
  if (rejectedCompany) pass('local-parser rejects a company name that could be read as a flag');
  else fail('local-parser should reject an unsafe company name');

  if (localParser.detect({ name: 'X', careers_url: 'https://x.co', parser: { command: 'node', args: ['-e', 'process.exit(0)'] } }) === null) {
    pass('local-parser rejects inline interpreter code (node -e ...)');
  } else {
    fail('local-parser should reject inline-code flags (-e/-c/--eval)');
  }

  if (localParser.detect({ name: 'X', careers_url: 'https://x.co', parser: { command: 'node', args: ['--eval=globalThis.x=1', 'scan.mjs'] } }) === null) {
    pass('local-parser rejects interpreter options before the script (node --eval=… script)');
  } else {
    fail('local-parser should reject interpreter options preceding the parser script');
  }

  if (localParser.detect({ name: 'Yahoo!', careers_url: 'https://x.co', parser: { command: 'node', script: 'scan.mjs' } })?.url) {
    pass('local-parser accepts a company name with punctuation when {company} is unused');
  } else {
    fail('local-parser should not reject a fixed-script entry over an unused company placeholder');
  }
} catch (e) {
  fail(`local-parser hardening tests crashed: ${e.message}`);
}

// Reverse-scan SSRF guard: a constructed careers_url must resolve to the ATS's own host.
try {
  const { entryOnHost } = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);
  const canonical = entryOnHost('acme', 'https://jobs.lever.co/acme', (h) => h === 'jobs.lever.co');
  const offHost = entryOnHost('acme', 'https://evil.example.com/acme', (h) => h === 'jobs.lever.co');
  if (canonical && canonical.careers_url === 'https://jobs.lever.co/acme' && offHost === null) {
    pass('scan-ats-full entryOnHost keeps canonical ATS hosts and drops others (SSRF guard)');
  } else {
    fail('scan-ats-full entryOnHost should keep canonical hosts and drop non-canonical ones');
  }
} catch (e) {
  fail(`scan-ats-full host-guard test crashed: ${e.message}`);
}

// ── 10. PORTALS CONFIG VALIDATOR ────────────────────────────────

console.log('\n10. Portals config validator');

try {
  const tmp = mkdtempSync(join(tmpdir(), 'career-ops-portals-validator-'));
  const validPath = join(tmp, 'valid.yml');
  const invalidProviderPath = join(tmp, 'invalid-provider.yml');
  const emptyKeywordPath = join(tmp, 'empty-keyword.yml');
  const duplicateCompanyPath = join(tmp, 'duplicate-company.yml');
  const badContentFilterPath = join(tmp, 'bad-content-filter.yml');
  const badVisaFilterPath = join(tmp, 'bad-visa-filter.yml');

  writeFileSync(validPath, `
title_filter:
  positive: ["AI"]
  negative: ["Intern"]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`, 'utf-8');

  writeFileSync(invalidProviderPath, `
title_filter:
  positive: ["AI"]
tracked_companies:
  - name: "Acme"
    provider: "missing-provider"
    careers_url: "https://jobs.lever.co/acme"
`, 'utf-8');

  writeFileSync(emptyKeywordPath, `
title_filter:
  positive: ["AI", "   "]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`, 'utf-8');

  writeFileSync(duplicateCompanyPath, `
title_filter:
  positive: ["AI"]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
  - name: " acme "
    careers_url: "https://jobs.lever.co/acme2"
`, 'utf-8');

  // content_filter with an empty-string keyword must be rejected, same as
  // title/location filters (an empty keyword would match every description).
  writeFileSync(badContentFilterPath, `
title_filter:
  positive: ["AI"]
content_filter:
  positive: ["rust", "   "]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`, 'utf-8');

  // visa_filter with an empty-string keyword or a non-boolean require_mention
  // must be rejected (an empty keyword would match every description).
  writeFileSync(badVisaFilterPath, `
title_filter:
  positive: ["AI"]
visa_filter:
  require_mention: "yes"
  positive: ["h-1b", "   "]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`, 'utf-8');

  const validResult = run(NODE, ['validate-portals.mjs', '--file', validPath]);
  if (validResult !== null && validResult.includes('0 errors')) {
    pass('validate-portals accepts a minimal valid portals file');
  } else {
    fail('validate-portals should accept a minimal valid portals file');
  }

  const exampleResult = run(NODE, ['validate-portals.mjs', '--file', 'templates/portals.example.yml']);
  if (exampleResult !== null && exampleResult.includes('0 errors')) {
    pass('validate-portals accepts templates/portals.example.yml');
  } else {
    fail('validate-portals should accept templates/portals.example.yml');
  }

  const invalidProviderResult = run(NODE, ['validate-portals.mjs', '--file', invalidProviderPath]);
  if (invalidProviderResult === null) {
    pass('validate-portals rejects unknown explicit providers');
  } else {
    fail('validate-portals should reject unknown explicit providers');
  }

  const emptyKeywordResult = run(NODE, ['validate-portals.mjs', '--file', emptyKeywordPath]);
  if (emptyKeywordResult === null) {
    pass('validate-portals rejects empty title/location keywords');
  } else {
    fail('validate-portals should reject empty title/location keywords');
  }

  const duplicateCompanyResult = run(NODE, ['validate-portals.mjs', '--file', duplicateCompanyPath]);
  if (duplicateCompanyResult !== null && duplicateCompanyResult.includes('1 warning')) {
    pass('validate-portals warns on duplicate enabled company names');
  } else {
    fail('validate-portals should warn on duplicate enabled company names');
  }

  const badContentFilterResult = run(NODE, ['validate-portals.mjs', '--file', badContentFilterPath]);
  if (badContentFilterResult === null) {
    pass('validate-portals rejects empty content_filter keywords');
  } else {
    fail('validate-portals should reject empty content_filter keywords');
  }

  const badVisaFilterResult = run(NODE, ['validate-portals.mjs', '--file', badVisaFilterPath]);
  if (badVisaFilterResult === null) {
    pass('validate-portals rejects invalid visa_filter (empty keyword / non-boolean require_mention)');
  } else {
    fail('validate-portals should reject invalid visa_filter');
  }

  rmSync(tmp, { recursive: true, force: true });
} catch (e) {
  fail(`portals validator tests crashed: ${e.message}`);
}

// ── 10b. PORTAL SLUG VALIDATOR (verify-portals.mjs) ─────────────

console.log('\n10b. Portal slug validator');

try {
  const { deriveSlugCandidates, parseAtsSlug, verifyCompanies } =
    await import(pathToFileURL(join(ROOT, 'verify-portals.mjs')).href);

  const slugs = deriveSlugCandidates('Acme Corp!');
  if (['acmecorp', 'acme-corp', 'acme_corp', 'acme'].every((x) => slugs.includes(x)) && slugs.includes('acmeai') && slugs.includes('acme.tech')) {
    pass('verify-portals derives slug candidates from a company name');
  } else {
    fail(`verify-portals slug candidates wrong: ${JSON.stringify(slugs)}`);
  }

  if (
    parseAtsSlug('https://job-boards.greenhouse.io/acme')?.ats === 'greenhouse' &&
    parseAtsSlug('https://jobs.ashbyhq.com/acme')?.ats === 'ashby' &&
    parseAtsSlug('https://api.lever.co/v0/postings/acme')?.slug === 'acme' &&
    parseAtsSlug('https://openai.com/careers') === null
  ) {
    pass('verify-portals recognizes ATS slugs and skips branded URLs');
  } else {
    fail('verify-portals parseAtsSlug misclassified an ATS or branded URL');
  }

  // Mock fetchJson: 200+jobs → live, 200+empty → empty, otherwise 404 → missing.
  const mockFetch = async (url) => {
    if (url.includes('/boards/live/')) return { jobs: [{}, {}] };
    if (url.includes('/boards/empty/')) return { jobs: [] };
    const err = new Error('HTTP 404'); err.status = 404; throw err;
  };
  const results = await verifyCompanies([
    { name: 'Live', careers_url: 'https://job-boards.greenhouse.io/live' },
    { name: 'Empty', careers_url: 'https://job-boards.greenhouse.io/empty' },
    { name: 'Typo', careers_url: 'https://job-boards.greenhouse.io/nope' },
    { name: 'Branded', careers_url: 'https://acme.com/careers' },
    { name: 'Off', enabled: false, careers_url: 'https://job-boards.greenhouse.io/live' },
  ], { fetchJson: mockFetch });
  const byName = Object.fromEntries(results.map((r) => [r.name, r.status]));
  if (
    results.length === 4 &&
    byName.Live === 'live' && byName.Empty === 'empty' &&
    byName.Typo === 'missing' && byName.Branded === 'skipped'
  ) {
    pass('verify-portals classifies live / empty / unresolved / non-ATS (disabled excluded)');
  } else {
    fail(`verify-portals classification wrong: ${JSON.stringify(byName)} (${results.length} rows)`);
  }
} catch (e) {
  fail(`portal slug validator tests crashed: ${e.message}`);
}

// ── 11. AGENTS.md INTEGRITY ─────────────────────────────────────

console.log('\n11. AGENTS.md integrity');

const agents = readFile('AGENTS.md');
// 'Update Check' intentionally excluded — this fork deliberately doesn't
// ship a self-update flow (career-ops syncs upstream via hand-merge).
const requiredSections = [
  'Data Contract', 'Ethical Use',
  'Offer Verification', 'Canonical States', 'TSV Format',
  'First Run', 'Onboarding',
];

for (const section of requiredSections) {
  if (agents.includes(section)) {
    pass(`AGENTS.md has section: ${section}`);
  } else {
    fail(`AGENTS.md missing section: ${section}`);
  }
}

// ── 11. CLI WRAPPER FILE INTEGRITY ──────────────────────────

console.log('\n11. CLI wrapper file integrity');

const cliWrappers = ['CLAUDE.md', 'OPENCODE.md', 'GEMINI.md'];
for (const f of cliWrappers) {
  if (!fileExists(f)) {
    fail(`Missing CLI wrapper: ${f}`);
    continue;
  }
  const content = readFile(f);
  if (content.includes('AGENTS.md')) {
    pass(`${f} references AGENTS.md`);
  } else {
    fail(`${f} does NOT reference AGENTS.md`);
  }
}

// ── 12. SKILL SYMLINK INTEGRITY ─────────────────────────────

console.log('\n12. Skill symlink integrity');

const canonicalSkill = '.agents/skills/career-ops/SKILL.md';
const symlinks = [
  '.claude/skills/career-ops/SKILL.md',
  '.opencode/skills/career-ops/SKILL.md',
  '.antigravitycli/skills/career-ops/SKILL.md',
];

let canonicalReal = null;
let canonicalContent = null;
try {
  canonicalReal = realpathSync(join(ROOT, canonicalSkill));
  canonicalContent = readFile(canonicalSkill);
  pass(`Canonical skill resolves: ${canonicalSkill}`);
} catch {
  fail(`Canonical skill not found: ${canonicalSkill}`);
}

for (const link of symlinks) {
  let resolved = null;
  try {
    resolved = realpathSync(join(ROOT, link));
    if (resolved !== canonicalReal) {
      const content = readFileSync(resolved, 'utf-8').trim();
      if (content.startsWith('..') && content.split('\n').length === 1) {
        resolved = realpathSync(join(dirname(join(ROOT, link)), content));
      }
    }
  } catch {
    resolved = null;
  }
  if (resolved === null) {
    fail(`Symlink missing: ${link}`);
    continue;
  }
  if (resolved === canonicalReal) {
    pass(`${link} → canonical skill`);
  } else if (canonicalContent !== null && readFile(link) === canonicalContent) {
    pass(`${link} is a materialized copy of canonical skill`);
  } else {
    fail(`${link} resolves to ${resolved}, expected ${canonicalReal} or byte-identical canonical skill copy`);
  }
}

// ── 14. VERSION FILE ─────────────────────────────────────────────

console.log('\n14. Version file');

if (fileExists('VERSION')) {
  // VERSION may carry a release-please marker, e.g. "1.9.0 # x-release-please-version".
  // Validate the first whitespace-delimited token, mirroring update-system.mjs parseVersionFile().
  // Accept full SemVer 2.0.0 incl. optional prerelease (e.g. 2.0.0-rc.1) and build (+meta) suffixes.
  const version = readFile('VERSION').trim().split(/\s+/)[0];
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    pass(`VERSION is valid semver: ${version}`);
  } else {
    fail(`VERSION is not valid semver: "${version}"`);
  }

  const pkgVersion = JSON.parse(readFile('package.json')).version;
  if (pkgVersion === version) {
    pass(`package.json version matches VERSION (${version})`);
  } else {
    fail(`package.json version "${pkgVersion}" does not match VERSION "${version}" — bump one to match the other`);
  }
} else {
  fail('VERSION file missing');
}

// ── 15. LOCATION FILTER — always_allow tier ───────────────────────

console.log('\n15. Location filter — always_allow tier');

try {
  const {
    buildLocationFilter,
    titleSignalsRemote,
    locationHintFromUrl,
    buildContentFilter,
    shouldDedupScanHistoryRow,
    formatPipelineOffer,
    formatScanHistoryRow,
  } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
  const { SCAN_HISTORY_COLUMNS, parseScanHistoryLine } = await import(pathToFileURL(join(ROOT, 'lib/scan-history-columns.mjs')).href);

  const filter = buildLocationFilter({
    always_allow: ['belgium', 'brussels'],
    allow: ['europe', 'emea', 'remote'],
    block: ['france', 'germany', 'united states'],
  });

  // Case 1: home-region passes regardless of other text
  if (filter('Brussels, Belgium') === true) pass('Brussels, Belgium passes (always_allow hit)');
  else fail('Brussels, Belgium should pass');

  // Case 2: always_allow wins over block (THE motivating case for this tier)
  if (filter('Remote, Belgium or France') === true) pass('Remote, Belgium or France passes (always_allow beats block)');
  else fail('Remote, Belgium or France should pass — always_allow must win over block');

  // Case 3: no always_allow hit, block still rejects
  if (filter('Paris, France') === false) pass('Paris, France is rejected (block still applies)');
  else fail('Paris, France should be rejected');

  // Case 4: empty location → pass (existing semantics, unchanged)
  if (filter('') === true) pass('empty location passes (unchanged semantics)');
  else fail('empty location should pass');

  // Case 5: case-insensitivity
  if (filter('BRUSSELS, BELGIUM') === true) pass('case-insensitive match works');
  else fail('case-insensitive match failed');

  // Case 6: backward compatibility — no always_allow key behaves like stock allow/block
  const stockFilter = buildLocationFilter({
    allow: ['europe', 'remote'],
    block: ['france'],
  });
  if (stockFilter('Remote, Belgium or France') === false) pass('without always_allow, block still wins (backward compatible)');
  else fail('without always_allow, behaviour must match stock allow/block (block wins)');

  // Case 7: null/missing locationFilter → pass-all filter (early-return path)
  const nullFilter = buildLocationFilter(null);
  if (nullFilter('Anywhere on Earth') === true && nullFilter('') === true) {
    pass('null locationFilter returns a pass-all filter (early-return path)');
  } else {
    fail('null locationFilter should return a pass-all filter');
  }

  // Case 8: string-instead-of-array → wrapped to a 1-item list
  const stringFilter = buildLocationFilter({ always_allow: 'belgium', block: ['france'] });
  if (stringFilter('Remote, Belgium or France') === true) {
    pass('always_allow as a bare string is wrapped to a single-item list');
  } else {
    fail('always_allow as a bare string should still work');
  }

  // Case 9: null/non-string items are filtered out (no crash, no false matches)
  const messyFilter = buildLocationFilter({
    always_allow: [null, 'belgium', 42, undefined],
    block: ['france', null, 7],
  });
  if (messyFilter('Brussels, Belgium') === true && messyFilter('Paris, France') === false) {
    pass('non-string entries (null, numbers, undefined) are filtered out without crashing');
  } else {
    fail('mixed-type keyword lists should not crash and should still match string entries');
  }

  // Case 10: all-null/non-string list → empty after normalization (no false rejects)
  const allBadFilter = buildLocationFilter({ block: [null, 42, undefined], allow: ['remote'] });
  if (allBadFilter('Remote') === true) {
    pass('a block list with only non-string entries normalizes to [] (no false rejects)');
  } else {
    fail('non-string-only block list should not cause rejection');
  }

  // Case 11: empty / whitespace-only entries are dropped (would otherwise pass-all via includes(''))
  const emptyKeywordFilter = buildLocationFilter({
    always_allow: ['', '  '],
    allow: ['remote'],
    block: ['france'],
  });
  if (emptyKeywordFilter('Paris, France') === false) {
    pass('empty/whitespace always_allow entries are dropped (no pass-all via includes(""))');
  } else {
    fail('empty always_allow entries should NOT bypass block — would have made the filter pass-all');
  }

  // Case 12: surrounding whitespace is trimmed so the keyword still matches
  const whitespaceFilter = buildLocationFilter({
    always_allow: ['  Belgium  ', '\tBrussels\n'],
    block: ['france'],
  });
  if (whitespaceFilter('Remote, Belgium or France') === true) {
    pass('whitespace-padded keywords still match after trim');
  } else {
    fail('"  Belgium  " should be trimmed and still match "Remote, Belgium or France"');
  }

  // Case 13: whitespace-only location is treated as missing (pass-all-tiers)
  if (filter('   \t  ') === true) pass('whitespace-only location passes (treated as missing)');
  else fail('whitespace-only location should pass');

  // Case 14: non-string location (number/object/null) → pass without throwing
  let crashed = false;
  try {
    const r1 = filter(42);
    const r2 = filter({ city: 'Brussels' });
    const r3 = filter(null);
    const r4 = filter(undefined);
    if (r1 === true && r2 === true && r3 === true && r4 === true) {
      pass('non-string location values (number, object, null, undefined) pass without throwing');
    } else {
      fail(`non-string location results: number=${r1}, object=${r2}, null=${r3}, undefined=${r4}`);
    }
  } catch (e) {
    crashed = true;
    fail(`non-string location crashed: ${e.message}`);
  }

  // Case 15: a malformed location (e.g. legacy object) does NOT bypass block when interpreted naively —
  // the guard returns true (pass) BEFORE block/allow even run, which is correct: scoring/eval happens
  // downstream from the scan filter, so malformed locations should fall through to the manual evaluation
  // step rather than being silently dropped here.
  if (filter(42) === true) pass('non-string locations are passed through to downstream evaluation, not silently dropped');
  else fail('non-string locations should pass through');


  // Case 16: URL location hint — rolled-up display strings ("5 Locations") hide the
  // real location, which the Workday URL still names. Motivating real case: Kyndryl
  // postings that render as "5 Locations" with a .../job/Hyderabad-Telangana-India/... URL.
  const urlFilter = buildLocationFilter({
    always_allow: ['united states'],
    block: ['india', 'hyderabad', 'germany'],
  });
  if (urlFilter('5 Locations', 'https://kyndryl.wd5.myworkdayjobs.com/careers/job/Hyderabad-Telangana-India/Network-Engineer_R-65193-1') === false) {
    pass('URL hint rejects a rolled-up "5 Locations" row whose canonical URL is India');
  } else {
    fail('"5 Locations" + Hyderabad URL should be rejected via the URL location hint');
  }

  // Case 17: always_allow still wins over a blocked URL hint — a genuinely US role is
  // never dropped because of what its URL happens to contain.
  if (urlFilter('New York, United States', 'https://x.wd5.myworkdayjobs.com/c/job/Hyderabad-Telangana-India/Eng_R1') === true) {
    pass('always_allow on the display string beats a blocked URL hint');
  } else {
    fail('an explicit "United States" location must survive a blocked URL hint');
  }

  // Case 18: providers without the /job/{location}/ convention are unaffected
  if (
    locationHintFromUrl('https://jobs.ashbyhq.com/snowflake/4fe8d816') === '' &&
    locationHintFromUrl('https://boards.greenhouse.io/acme/jobs/12345') === '' &&
    locationHintFromUrl('not a url') === '' &&
    locationHintFromUrl('') === '' &&
    locationHintFromUrl(null) === ''
  ) {
    pass('locationHintFromUrl yields no hint for non-Workday, malformed, and empty URLs');
  } else {
    fail('locationHintFromUrl should return "" for URLs without a /job/{location}/ segment');
  }

  // Case 19: hint normalization — separators become spaces so multi-word keywords match
  if (
    locationHintFromUrl('https://x.wd1.myworkdayjobs.com/c/job/Hyderabad-Telangana-India/Eng_R1') === 'hyderabad telangana india' &&
    locationHintFromUrl('https://x.wd1.myworkdayjobs.com/c/job/USA---El-Segundo-CA/Eng_R1') === 'usa el segundo ca'
  ) {
    pass('URL hint normalizes separators to spaces and lowercases');
  } else {
    fail(`URL hint normalization wrong: got "${locationHintFromUrl('https://x.wd1.myworkdayjobs.com/c/job/Hyderabad-Telangana-India/Eng_R1')}"`);
  }

  // Case 20: omitting the url argument preserves the original location-only behaviour
  if (urlFilter('Bengaluru, India') === false && urlFilter('Austin, TX') === true) {
    pass('calling the filter without a url keeps original location-only semantics');
  } else {
    fail('single-argument calls must behave exactly as before the url-hint change');
  }

  // Case 21: keywords match on word boundaries, not raw substrings. Blocking "india"
  // must NOT reject the US locations Indian Head MD, Indiana, or Indianapolis — the
  // substring bug that silently dropped real US roles from every scan.
  const boundaryFilter = buildLocationFilter({ block: ['india', 'china', 'uk -'] });
  if (
    boundaryFilter('Indian Head, MD') === true &&
    boundaryFilter('Indianapolis, IN') === true &&
    boundaryFilter('West Lafayette, Indiana') === true &&
    boundaryFilter('Chinatown, San Francisco') === true &&
    boundaryFilter('Truck - Depot') === true
  ) {
    pass('block keywords honour word boundaries (Indiana/Indian Head/Indianapolis/Chinatown not rejected)');
  } else {
    fail('word-boundary matching failed — a substring match is silently dropping US locations');
  }

  // Case 22: ...while the genuine country matches still get blocked
  if (
    boundaryFilter('Hyderabad, India') === false &&
    boundaryFilter('India') === false &&
    boundaryFilter('Beijing, China') === false &&
    boundaryFilter('UK - London') === false
  ) {
    pass('word-boundary matching still blocks the real country/region hits');
  } else {
    fail('word-boundary matching must not weaken genuine block hits');
  }

  // Case 23: boundary matching applies to the URL hint too
  if (
    boundaryFilter('5 Locations', 'https://x.wd1.myworkdayjobs.com/c/job/Hyderabad-Telangana-India/Eng_R1') === false &&
    boundaryFilter('5 Locations', 'https://x.wd1.myworkdayjobs.com/c/job/Indianapolis-Indiana/Eng_R1') === true
  ) {
    pass('URL hint is boundary-matched as well (Indianapolis URL survives, India URL does not)');
  } else {
    fail('URL hint must use the same word-boundary matching as the location string');
  }

  // Case 24: a remote marker in the TITLE satisfies `allow` when the location
  // names only a city/state. Radancy/TalentBrew tenants (Optum, Kaiser) report
  // the hiring office as the location and state remoteness in the title, so a
  // country/region `allow` list rejected genuinely remote US roles. Measured
  // live on careers.unitedhealthgroup.com: 14 PM-family postings, 0 passed.
  const remoteTitleFilter = buildLocationFilter({
    allow: ['remote', 'united states', 'usa', 'us', 'new york'],
    block: ['india', 'united kingdom', 'london'],
  });
  if (
    remoteTitleFilter('Costa Mesa, California', undefined, 'Sr. PBM Client Implementation Project Manager - Remote') === true &&
    remoteTitleFilter('Las Vegas, Nevada', undefined, 'Program Manager - Remote') === true &&
    remoteTitleFilter('St Louis, Missouri', undefined, 'Clinical Program Manager (Case Management) - Remote in MO') === true &&
    remoteTitleFilter('Phoenix, Arizona', undefined, 'Project Manager (Remote)') === true &&
    remoteTitleFilter('Dallas, Texas', undefined, 'IT Program Manager, Remote - US') === true
  ) {
    pass('a remote marker in the title satisfies allow when the location is city-only');
  } else {
    fail('title-stated remote roles are still being rejected for a city-only location');
  }

  // Case 25: the rescue must NOT widen `block`. It runs after the block tier, so
  // a remote title can never pull in an excluded country.
  if (
    remoteTitleFilter('Bengaluru, Karnataka, India', undefined, 'Program Manager - Remote') === false &&
    remoteTitleFilter('London, United Kingdom', undefined, 'Project Manager - Remote') === false &&
    remoteTitleFilter('5 Locations', 'https://x.wd1.myworkdayjobs.com/c/job/Hyderabad-Telangana-India/PM_R1', 'Program Manager - Remote') === false
  ) {
    pass('a remote title never rescues a blocked location (block still wins, URL hint included)');
  } else {
    fail('remote-title rescue must not override the block tier');
  }

  // Case 26: only a work-arrangement marker counts. "Remote Sensing" is a GIS
  // domain compound — Esri, a tracked company, posts on-site roles with exactly
  // that phrase, so a bare /remote/ test would silently admit them.
  if (
    remoteTitleFilter('Redlands, California', undefined, 'Remote Sensing Program Manager') === false &&
    remoteTitleFilter('Austin, Texas', undefined, 'Remote Monitoring Project Manager') === false &&
    titleSignalsRemote('Remote Sensing Analyst') === false &&
    titleSignalsRemote('Program Manager - Remote') === true &&
    titleSignalsRemote('Telremote Engineer') === false
  ) {
    pass('remote-title detection ignores domain compounds (Remote Sensing/Monitoring) and mid-word hits');
  } else {
    fail('remote-title detection must not fire on "Remote Sensing"-style compounds');
  }

  // Case 27a: an explicit negation must lose. "Non-Remote"/"Not Remote" satisfy
  // REMOTE_TITLE_RE on their own — the delimiter clears the lookbehind and the
  // trailing position clears the lookahead — so without a negation guard an
  // explicitly on-site role would bypass a non-empty `allow` list.
  if (
    titleSignalsRemote('Project Manager - Non-Remote') === false &&
    titleSignalsRemote('Project Manager - Not Remote') === false &&
    titleSignalsRemote('Office Manager (Non-Remote)') === false &&
    titleSignalsRemote('Program Manager - NonRemote') === false &&
    titleSignalsRemote('Program Manager - No Remote') === false &&
    remoteTitleFilter('Eden Prairie, Minnesota', undefined, 'Project Manager - Non-Remote') === false &&
    remoteTitleFilter('Eden Prairie, Minnesota', undefined, 'Project Manager - Not Remote') === false
  ) {
    pass('an explicit negation ("Non-Remote"/"Not Remote") never counts as a remote marker');
  } else {
    fail('negated remote titles are being admitted — an on-site role can bypass allow');
  }

  // Case 27b: the negation guard must not over-reach. `[\s-]*` spans only spaces
  // and hyphens, so a word-initial "non"/"not" in an unrelated token cannot
  // reach across to "remote".
  if (
    titleSignalsRemote('Nonprofit Program Manager - Remote') === true &&
    titleSignalsRemote('Not-for-Profit Program Manager - Remote') === true &&
    titleSignalsRemote('Nordic Program Manager - Remote') === true &&
    titleSignalsRemote('Notary Operations Manager - Remote') === true
  ) {
    pass('the negation guard does not misfire on Nonprofit/Not-for-Profit/Nordic/Notary titles');
  } else {
    fail('negation guard is over-rejecting legitimate remote titles');
  }

  // Case 27c: the negation separator must be at least as broad as the marker's
  // own delimiter lookahead. An ASCII-only [\s-] let every non-ASCII dash through
  // — en dash, em dash, non-breaking hyphen, figure dash and minus all still read
  // as remote, trivially sidestepping the guard.
  const negatedDashes = ['-', '–', '—', '‑', '‒', '−', '', ' ', '/'];
  if (negatedDashes.every((d) => titleSignalsRemote(`Project Manager - Non${d}Remote`) === false)) {
    pass('the negation guard survives Unicode dash variants (en/em/non-breaking/figure/minus)');
  } else {
    const leak = negatedDashes.filter((d) => titleSignalsRemote(`Project Manager - Non${d}Remote`) !== false);
    fail(`negated titles leak through with separator(s): ${JSON.stringify(leak)}`);
  }

  // Case 27: unchanged behavior — on-site city-only roles with no remote marker
  // stay rejected, and malformed/absent titles are inert.
  if (
    remoteTitleFilter('Eden Prairie, Minnesota', undefined, 'Senior Project Manager I') === false &&
    remoteTitleFilter('Eden Prairie, Minnesota', undefined, undefined) === false &&
    remoteTitleFilter('Eden Prairie, Minnesota', undefined, 42) === false &&
    remoteTitleFilter('Eden Prairie, Minnesota', undefined, '   ') === false &&
    remoteTitleFilter('United States', undefined, 'Program Manager') === true
  ) {
    pass('on-site city-only roles stay rejected; non-string/blank titles are inert');
  } else {
    fail('remote-title rescue changed behavior for non-remote or malformed titles');
  }

  if (
    shouldDedupScanHistoryRow({ firstSeen: '2026-06-01', status: 'added' }, { recheckAfterDays: 30, today: '2026-06-10' }) === true &&
    shouldDedupScanHistoryRow({ firstSeen: '2026-05-01', status: 'added' }, { recheckAfterDays: 30, today: '2026-06-10' }) === false &&
    shouldDedupScanHistoryRow({ firstSeen: '2026-02-31', status: 'added' }, { recheckAfterDays: 30, today: '2026-06-10' }) === true &&
    shouldDedupScanHistoryRow({ firstSeen: '2026-05-01', status: 'skipped_blocked_host' }, { recheckAfterDays: 30, today: '2026-06-10' }) === true &&
    shouldDedupScanHistoryRow({ firstSeen: '2026-05-01', status: 'added' }, { today: '2026-06-10' }) === true &&
    scanScript.includes('Recheck eligible:')
  ) {
    pass('scan-history TTL rechecks old added URLs while permanent statuses stay deduped');
  } else {
    fail('scan-history TTL policy did not match expected recheck/permanent behavior');
  }

  const hostileOffer = {
    url: 'https://jobs.example.com/123|evil\nhttps://evil.example/later',
    source: 'local-parser',
    title: 'Senior Engineer | Growth\n- [ ] https://evil.example/job | EvilCorp | Injected',
    company: '=ACME\\Corp\t| R&D',
    location: '@Remote\nEU',
    requisitionId: '=R1\tDROP\nx',
    language: '@en\n-GB',
  };
  const pipelineRow = formatPipelineOffer(hostileOffer);
  const pendingLines = pipelineRow.split('\n').filter(line => /^\s*- \[ \] https?:\/\//.test(line));
  const pipelineFields = pipelineRow.split('|').map(part => part.trim());
  if (
    pendingLines.length === 1 &&
    pipelineFields.length === 4 &&
    pipelineFields[0] === '- [ ] https://jobs.example.com/123%7Cevil' &&
    pipelineFields[3] === '@Remote EU' &&
    !pipelineRow.includes('\n') &&
    !pipelineRow.includes('\t') &&
    !pipelineRow.includes('\\|') &&
    pipelineRow.includes('=ACME\\\\Corp / R&D') &&
    pipelineRow.includes('- \\[ \\] https://evil.example/job / EvilCorp / Injected')
  ) {
    pass('scan pipeline writer preserves row shape (optional location 4th col) without injected checkboxes or extra pipes');
  } else {
    fail(`scan pipeline metadata sanitizer produced unsafe row: ${pipelineRow}`);
  }

  const historyRow = formatScanHistoryRow(hostileOffer, '2026-06-18');
  const history = parseScanHistoryLine(historyRow);
  // The stored cells carry the formula escaping; parseScanHistoryLine undoes it.
  const stored = Object.fromEntries(SCAN_HISTORY_COLUMNS.map((name, i) => [name, historyRow.split('\t')[i]]));
  if (
    historyRow.split('\t').length === SCAN_HISTORY_COLUMNS.length && // every declared column, empty ones included
    !historyRow.includes('\n') && !historyRow.includes('\r') &&
    !historyRow.split('\t').some(col => /[\r\n\t]/.test(col)) &&
    history.posted_at === '' &&
    history.trust_score === '' && history.trust_flags === '' &&
    history.url === 'https://jobs.example.com/123|evil' &&
    history.title.includes('- [ ] https://evil.example/job') &&
    stored.company === "'=ACME\\Corp | R&D" &&
    stored.location === "'@Remote EU" &&
    stored.requisition_id === "'=R1 DROP x" &&
    stored.language === "'@en -GB" &&
    history.company === '=ACME\\Corp | R&D' &&
    history.location === '@Remote EU' &&
    history.requisition_id === '=R1 DROP x' &&
    history.language === '@en -GB' &&
    history.listing_key === ''
  ) {
    pass('scan-history writer preserves row shape and neutralizes spreadsheet formulas; the reader gets the values back');
  } else {
    fail(`scan-history metadata sanitizer produced unsafe TSV row: ${JSON.stringify({ stored, history })}`);
  }

  // ── content_filter (#734) ──
  // Absent config → all jobs pass.
  const noContentFilter = buildContentFilter(null);
  if (noContentFilter('any description') === true && noContentFilter('') === true) {
    pass('content_filter absent → all jobs pass');
  } else {
    fail('content_filter absent should pass all jobs');
  }

  // Empty / missing description always passes (providers without descriptions
  // must never be silently dropped).
  const cf = buildContentFilter({ positive: ['rust'], negative: ['php'] });
  if (cf('') === true && cf('   ') === true && cf(undefined) === true && cf(null) === true && cf(42) === true) {
    pass('content_filter passes empty/missing/non-string descriptions');
  } else {
    fail('content_filter should pass empty/missing/non-string descriptions');
  }

  // Negative keyword present → reject (even if a positive also matches).
  if (cf('We build in PHP and Rust') === false && cf('Legacy PHP shop') === false) {
    pass('content_filter rejects descriptions containing a negative keyword');
  } else {
    fail('content_filter should reject negative-keyword descriptions');
  }

  // Positive required when positive list is non-empty.
  if (cf('We write everything in Rust') === true && cf('A Python and Go team') === false) {
    pass('content_filter requires a positive keyword when positives are set');
  } else {
    fail('content_filter should require a positive keyword');
  }

  // Positive empty → pass after clearing negatives.
  const negOnly = buildContentFilter({ negative: ['wordpress'] });
  if (negOnly('Modern TypeScript stack') === true && negOnly('WordPress maintenance') === false) {
    pass('content_filter with only negatives blocks them and passes the rest');
  } else {
    fail('content_filter negative-only behavior wrong');
  }

  // Case-insensitive.
  const caseCf = buildContentFilter({ positive: ['Kubernetes'] });
  if (caseCf('deploys on KUBERNETES daily') === true) {
    pass('content_filter matches case-insensitively');
  } else {
    fail('content_filter should be case-insensitive');
  }

  // content_filter.by_title_keyword (#1638): a stricter override scoped to
  // only jobs whose title matched a specific title_filter.positive keyword.
  const { matchedTitleKeywords } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
  const byKeywordCf = buildContentFilter({
    positive: ['engineer'],
    negative: [],
    by_title_keyword: { 'ai engineer': { positive: ['pytorch', 'tensorflow'] } },
  });
  const titleFilterCfg = { positive: ['ai engineer', 'engineer'] };
  const aiMatched = matchedTitleKeywords('Senior AI Engineer', titleFilterCfg);
  if (byKeywordCf('Builds models in PyTorch', aiMatched) === true) {
    pass('content_filter.by_title_keyword override passes on its own positive keyword');
  } else {
    fail('content_filter.by_title_keyword override should pass on its own positive keyword');
  }
  if (byKeywordCf('Uses only Excel macros', aiMatched) === false) {
    pass('content_filter.by_title_keyword override rejects when its positive keyword is absent');
  } else {
    fail('content_filter.by_title_keyword override should reject without its positive keyword');
  }
  // A title match with NO override entry falls back to the global pair.
  const backendMatched = matchedTitleKeywords('Backend Engineer', titleFilterCfg);
  if (byKeywordCf('Generic engineering role', backendMatched) === true) {
    pass('content_filter.by_title_keyword falls back to global pair for unmatched-override keywords');
  } else {
    fail('content_filter.by_title_keyword should fall back to the global pair without an override');
  }

  // formatPipelineOffer: optional labeled `| note: {text}` segment (#1483).
  const notedOffer = { url: 'https://jobs.example.com/9', company: 'Acme', title: 'Engineer', note: 'curated list' };
  const notedRow = formatPipelineOffer(notedOffer);
  if (notedRow.endsWith('| note: curated list')) {
    pass('formatPipelineOffer appends a labeled note segment when offer.note is set');
  } else {
    fail(`formatPipelineOffer should append "| note: ..." — got: ${notedRow}`);
  }
  const unnotedOffer = { url: 'https://jobs.example.com/10', company: 'Acme', title: 'Engineer' };
  if (!formatPipelineOffer(unnotedOffer).includes('note:')) {
    pass('formatPipelineOffer omits the note segment when offer.note is absent (byte-identical output)');
  } else {
    fail('formatPipelineOffer should omit the note segment without offer.note');
  }

} catch (e) {
  fail(`always_allow tests crashed: ${e.message}`);
}

// ── SCAN-RUNS PERSISTENCE (#1604) ────────────────────────────────
console.log('\nscan.mjs — scan-runs.tsv persistence (#1604)');
try {
  const { appendScanRunSummary, SCAN_RUNS_HEADER } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
  const runsTmp = mkdtempSync(join(tmpdir(), 'career-ops-scan-runs-'));
  try {
    const runsFile = join(runsTmp, 'scan-runs.tsv');
    appendScanRunSummary({
      timestamp: '2026-07-08T00:00:00.000Z', companies: 10, boards: 2, found: 50,
      filteredTitle: 5, filteredTier: 1, filteredLocation: 2, filteredPostingAge: 7,
      filteredSalary: 0, filteredContent: 3, filteredCooldown: 4, dupes: 6, newAdded: 29,
      errors: 0, filteredBlacklist: 8, filteredVisa: 2, filteredPostedDate: 1,
      filteredCountryEligibility: 4,
    }, runsFile);
    const content = readFileSync(runsFile, 'utf-8');
    const lines = content.trim().split('\n');
    if (lines[0] + '\n' === SCAN_RUNS_HEADER) {
      pass('appendScanRunSummary writes the canonical header on first write');
    } else {
      fail(`appendScanRunSummary header mismatch — got: ${lines[0]}`);
    }
    const cols = lines[1].split('\t');
    // filtered_blacklist/filtered_visa/filtered_posted_date/filtered_country_eligibility
    // land in the four trailing columns (16-19), per the header-name append-only
    // contract: an older file keeps parsing, the extra cells are simply unnamed there.
    if (cols.length === 19 && cols[0] === '2026-07-08T00:00:00.000Z' && cols[1] === 'completed'
        && cols[13] === '29' && cols[15] === '8' && cols[16] === '2' && cols[17] === '1'
        && cols[18] === '4') {
      pass('appendScanRunSummary writes one tab-delimited row with the run counters');
    } else {
      fail(`appendScanRunSummary row shape wrong: ${JSON.stringify(cols)}`);
    }
    // Second call appends without rewriting the header.
    appendScanRunSummary({ timestamp: '2026-07-09T00:00:00.000Z', companies: 10, boards: 2, found: 40, filteredTitle: 0, filteredTier: 0, filteredLocation: 0, filteredSalary: 0, filteredContent: 0, filteredCooldown: 0, dupes: 0, newAdded: 40, errors: 0 }, runsFile);
    const afterSecond = readFileSync(runsFile, 'utf-8').trim().split('\n');
    if (afterSecond.length === 3) {
      pass('appendScanRunSummary appends a second row without duplicating the header');
    } else {
      fail(`appendScanRunSummary should have 3 lines (header + 2 rows), got ${afterSecond.length}`);
    }
  } finally {
    rmSync(runsTmp, { recursive: true, force: true });
  }
} catch (e) {
  fail(`scan-runs persistence tests crashed: ${e.message}`);
}
// ── 12. FOLLOW-UP CADENCE LOGIC ─────────────────────────────────

console.log('\n12. Follow-up cadence logic');

try {
  // Pin the cadence source BEFORE followup-cadence.mjs is evaluated (#2268).
  // Its module-level `CADENCE = resolveCadenceConfig()` reads CAREER_OPS_PROFILE at
  // import time and otherwise falls back to the USER's config/profile.yml - so the
  // computeUrgency / computeNextFollowupDate cases below, which encode
  // DEFAULT_CADENCE, went red on a perfectly healthy install where the user had
  // customized followup_cadence. #2446 pinned the two standalone suites this way;
  // this in-process import was the piece left over.
  //
  // The import below must stay DYNAMIC: ESM hoists static imports above every
  // statement in the file, so a static import would evaluate the module before this
  // assignment and the pin would silently do nothing.
  const CADENCE_FIXTURE = join(ROOT, 'tests', 'fixtures', 'profile-default-cadence.yml');
  const priorCadenceProfile = process.env.CAREER_OPS_PROFILE;
  process.env.CAREER_OPS_PROFILE = CADENCE_FIXTURE;

  let cadence;
  let cliOut = '';
  try {
    cadence = await import(pathToFileURL(join(ROOT, 'followup-cadence.mjs')).href);

    // CLI regression: the import.meta.url guard must still let the module run as a CLI.
    // Data-independent — default mode emits the result as JSON: a `metadata` object when
    // the tracker has applications, or an `{error}` object (exit 1) when it is empty.
    // Empty output would mean the guard wrongly suppressed main().
    //
    // The pin is passed explicitly: this is a FRESH process, so it re-resolves the
    // profile on its own and would otherwise read the user's config/profile.yml no
    // matter what the parent set.
    try {
      cliOut = execFileSync(NODE, [join(ROOT, 'followup-cadence.mjs')], {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30000,
        env: { ...process.env, CAREER_OPS_PROFILE: CADENCE_FIXTURE },
      });
    } catch (cliErr) {
      cliOut = `${cliErr.stdout || ''}`; // exit 1 on an empty tracker is expected; keep stdout
    }
  } finally {
    // Restore immediately. followup-cadence.mjs froze CADENCE at import above, so the
    // pin has already done its job, and other modules read the same variable
    // (scan.mjs, cv-templates.mjs, providers/_profile-keywords.mjs, plugins/_engine.mjs)
    // - later sections must not silently inherit the fixture.
    if (priorCadenceProfile === undefined) delete process.env.CAREER_OPS_PROFILE;
    else process.env.CAREER_OPS_PROFILE = priorCadenceProfile;
  }

  // Guard the pin itself: if it ever stops taking effect, the two cadence-dependent
  // blocks below revert to silently asserting against whatever the developer happens
  // to have configured. This fails loudly instead.
  //
  // The module-private CADENCE isn't exported, but resolveCadenceConfig() with no
  // arguments re-reads the same module-level PROFILE_FILE that CADENCE was built
  // from - which was resolved from CAREER_OPS_PROFILE at import time. So this is a
  // faithful proxy for "the pin was in place when the module was evaluated".
  {
    const pinned = cadence.resolveCadenceConfig();
    const drift = Object.keys(cadence.DEFAULT_CADENCE)
      .filter((k) => pinned[k] !== cadence.DEFAULT_CADENCE[k]);
    if (drift.length === 0) {
      pass('section 12 pins CAREER_OPS_PROFILE, so cadence resolves to the documented defaults');
    } else {
      fail(`section 12 cadence pin did not take effect - drifted keys: ${drift.join(', ')} (got ${JSON.stringify(pinned)})`);
    }
  }
  let cliJson = null;
  try { cliJson = JSON.parse(cliOut.trim()); } catch { /* leave null → fail below */ }
  if (cliJson && typeof cliJson === 'object' && ('metadata' in cliJson || 'error' in cliJson)) {
    pass('CLI still executes under the import.meta.url guard (emits result JSON)');
  } else {
    fail('CLI produced no structured JSON when run directly — import.meta.url guard may be broken');
  }

  // Date helpers
  if (cadence.addDays(cadence.parseDate('2026-05-01'), 7) === '2026-05-08') {
    pass('addDays advances a parsed date by N days (UTC)');
  } else {
    fail(`addDays produced ${cadence.addDays(cadence.parseDate('2026-05-01'), 7)}`);
  }
  if (cadence.daysBetween(cadence.parseDate('2026-05-01'), cadence.parseDate('2026-05-08')) === 7) {
    pass('daysBetween counts whole days between two dates');
  } else {
    fail('daysBetween miscounted');
  }
  if (cadence.parseDate('not-a-date') === null && cadence.parseDate('2026-05-01') instanceof Date) {
    pass('parseDate rejects malformed input and accepts ISO dates');
  } else {
    fail('parseDate validation wrong');
  }

  // parseAppliedDate — extracts the real submission date from notes (the
  // tracker `date` column is the evaluation date), case-insensitive.
  if (cadence.parseAppliedDate('Applied 2026-06-09 via Personio; raised part-time') === '2026-06-09') {
    pass('parseAppliedDate extracts "Applied YYYY-MM-DD" from notes');
  } else {
    fail(`parseAppliedDate got ${JSON.stringify(cadence.parseAppliedDate('Applied 2026-06-09 via Personio; raised part-time'))}`);
  }
  if (cadence.parseAppliedDate('APPLIED 2026-06-17 (German CV; jobId=104170)') === '2026-06-17') {
    pass('parseAppliedDate is case-insensitive (APPLIED)');
  } else {
    fail('parseAppliedDate should match uppercase APPLIED');
  }
  // First "Applied" date wins even when a later status date follows.
  if (cadence.parseAppliedDate('Applied 2026-06-09. No response; discarded 2026-06-18.') === '2026-06-09') {
    pass('parseAppliedDate takes the first applied date, not a later status date');
  } else {
    fail('parseAppliedDate should take the first applied date');
  }
  if (cadence.parseAppliedDate('On-archetype fit; no submission yet') === null && cadence.parseAppliedDate('') === null) {
    pass('parseAppliedDate returns null when notes carry no applied date');
  } else {
    fail('parseAppliedDate should return null without an applied date');
  }
  // "reapplied" must not be mistaken for an applied date (word boundary).
  if (cadence.parseAppliedDate('reapplied 2026-06-09 after rejection') === null) {
    pass('parseAppliedDate does not match inside "reapplied"');
  } else {
    fail('parseAppliedDate should not match the date inside "reapplied"');
  }
  // An estimated apply date is written "Applied ~YYYY-MM-DD". Without tolerating
  // the tilde the note is skipped and the cadence silently falls back to the
  // evaluation date — the same wrong-age failure the notes lookup exists to fix.
  if (cadence.parseAppliedDate('Applied ~2026-06-09 (date estimated)') === '2026-06-09') {
    pass('parseAppliedDate tolerates an estimated "Applied ~YYYY-MM-DD" date');
  } else {
    fail(`parseAppliedDate should tolerate "~", got ${JSON.stringify(cadence.parseAppliedDate('Applied ~2026-06-09 (date estimated)'))}`);
  }
  if (cadence.parseAppliedDate('reapplied ~2026-06-09 after rejection') === null) {
    pass('parseAppliedDate still refuses "reapplied" when a tilde is present');
  } else {
    fail('parseAppliedDate must not match inside "reapplied" even with a tilde');
  }
  // #2607 — a note citing ANOTHER row's apply date must not win. Notes routinely
  // reference a sibling requisition's timeline for context, and that citation
  // reads exactly like this row's own date to a positional scan.
  const crossRefNote =
    'STRATEGY DECISION NEEDED: #154 Sr PM M&A is already live in the same ATS '
    + '(applied 2026-08-04) - recommend applying anyway. TIER A flagship CV '
    + 'required. APPLIED 2026-08-06 - submitted directly by Jason.';
  if (cadence.parseAppliedDate(crossRefNote) === '2026-08-06') {
    pass('parseAppliedDate ignores a date cited about another row (#2607)');
  } else {
    fail(`parseAppliedDate cross-reference: got ${JSON.stringify(cadence.parseAppliedDate(crossRefNote))}, want 2026-08-06`);
  }
  // The reference's scope ends at a sentence boundary — otherwise any note that
  // mentions a sibling row would lose its own date.
  if (cadence.parseAppliedDate('Sibling #140 was slow. Applied 2026-08-06.') === '2026-08-06') {
    pass('parseAppliedDate: a sentence boundary ends the row-reference scope');
  } else {
    fail('parseAppliedDate should keep its own date after a sentence break');
  }
  // ...but a SEMICOLON is not a boundary: it joins independent clauses inside
  // one sentence, so the subject carries across it and the date is still the
  // referenced row's.
  const semicolonRef = '#154 is already live; applied 2026-08-04. Not submitted here yet.';
  if (cadence.parseAppliedDate(semicolonRef) === null) {
    pass('parseAppliedDate: a semicolon does NOT end the scope of a reference that has no date yet');
  } else {
    fail(`parseAppliedDate semicolon scope: got ${JSON.stringify(cadence.parseAppliedDate(semicolonRef))}, want null`);
  }
  // ...but once the citation HAS been given its own date, a separator does end
  // it, and what follows is this row's. This is the mixed shape #2610 review
  // called out: the note names a sibling AND records this submission, which is
  // the common case when two roles are live at one employer. Reading the whole
  // note as the sibling's throws away a real measured date.
  //
  // It is also the pair a future simplification would silently re-break — the
  // two cases differ only by whether a date precedes the separator, so they are
  // asserted together on purpose.
  for (const [note, want, why] of [
    ['#154 Sr PM (applied 2026-08-04); applied 2026-06-15', '2026-06-15', 'semicolon, citation already dated'],
    ['#154 Sr PM (applied 2026-08-04) | applied 2026-06-15', '2026-06-15', 'pipe, citation already dated'],
    // No space after the separator. A full stop needs trailing whitespace to
    // avoid firing on "3.5", but `;` and `|` never appear inside numbers, and a
    // hand-typed note writes ";applied" as readily as "; applied".
    ['#154 Sr PM (applied 2026-08-04);applied 2026-06-15', '2026-06-15', 'unspaced semicolon'],
    ['#154 Sr PM (applied 2026-08-04)|applied 2026-06-15', '2026-06-15', 'unspaced pipe'],
    ['#154 is already live;applied 2026-08-04.', null, 'unspaced separator, citation NOT yet dated'],
    ['#154 Sr PM (applied 2026-08-04)', null, 'citation dated, nothing after it'],
  ]) {
    const got = cadence.parseAppliedDate(note);
    if (got === want) pass(`parseAppliedDate: ${why} → ${JSON.stringify(want)}`);
    else fail(`parseAppliedDate ${why}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  // When EVERY apply-date belongs to another row, the note does not state this
  // row's date. Degrade to the labelled evaluation-date fallback rather than
  // report a real-but-foreign date as measured.
  const onlyForeign = 'Same posting as #140 (applied 2026-07-20). Not yet submitted.';
  if (cadence.parseAppliedDate(onlyForeign) === null) {
    pass('parseAppliedDate returns null when every applied date is a cross-reference');
  } else {
    fail(`parseAppliedDate should not adopt a foreign date, got ${JSON.stringify(cadence.parseAppliedDate(onlyForeign))}`);
  }
  {
    const r = cadence.resolveAppliedDate({ notes: onlyForeign, date: '2026-07-25' });
    if (r.appliedDate === '2026-07-25' && r.appDateSource === 'evaluation-date-fallback') {
      pass('resolveAppliedDate labels a cross-reference-only note as the evaluation-date fallback');
    } else {
      fail(`resolveAppliedDate cross-ref-only: got ${JSON.stringify(r)}`);
    }
  }
  // A `#NNN` carrying a req/job/posting/ref label is THIS row's ATS identifier,
  // not a pointer at another tracker row. Without this scoping the row's own
  // posting id disqualified the row's own apply date — a false positive that
  // costs a real measured date, so the extra rule earns its keep (#2610 review).
  for (const [note, why] of [
    ['Req #1311 - applied 2026-08-06.', 'req'],
    ['Job ID #65136; applied 2026-08-06.', 'job id'],
    ['Posting #4471 — applied 2026-08-06.', 'posting'],
    ['Ref #R2857957 applied 2026-08-06.', 'ref'],
  ]) {
    if (cadence.parseAppliedDate(note) === '2026-08-06') {
      pass(`parseAppliedDate reads a "${why}"-labelled #id as this row's own, not a cross-reference`);
    } else {
      fail(`parseAppliedDate "${why}"-labelled id: got ${JSON.stringify(cadence.parseAppliedDate(note))}, expected 2026-08-06`);
    }
  }
  // ...and the exemption must not blunt the rule it scopes: a BARE #NNN in the
  // same shape is still a cross-reference.
  if (cadence.parseAppliedDate('Sibling #1311 - applied 2026-08-06.') === null) {
    pass('parseAppliedDate still treats a bare #id in the same shape as a cross-reference');
  } else {
    fail('the req-label exemption swallowed a genuine cross-reference');
  }
  // A malformed value must be rejected, not silently truncated to a plausible
  // date. Truncating "2026-06-091" to "2026-06-09" would be reported as a
  // measured application date and quietly shift the whole cadence — worse than
  // the honest evaluation-date fallback, because nothing marks it as a guess.
  const trailingJunk = [
    ['Applied 2026-06-091', 'a trailing digit'],
    ['Applied ~2026-06-091', 'a trailing digit after a tilde'],
    ['Applied 2026-06-09-foo', 'a hyphenated suffix'],
    ['Applied 2026-06-09foo', 'an unseparated word suffix'],
    ['Applied 2026-06-09_v2', 'an underscore suffix'],
    ['Applied 2026-06-09-2026-06-10', 'an ambiguous date range'],
  ];
  for (const [notes, label] of trailingJunk) {
    if (cadence.parseAppliedDate(notes) === null) {
      pass(`parseAppliedDate rejects ${label} instead of truncating (${notes})`);
    } else {
      fail(`parseAppliedDate should reject ${label}, got ${JSON.stringify(cadence.parseAppliedDate(notes))} from ${JSON.stringify(notes)}`);
    }
  }
  // A leading digit is the mirror-image malformation and must fail the same way.
  if (cadence.parseAppliedDate('Applied 12026-06-09') === null) {
    pass('parseAppliedDate rejects a leading extra digit');
  } else {
    fail(`parseAppliedDate should reject "Applied 12026-06-09", got ${JSON.stringify(cadence.parseAppliedDate('Applied 12026-06-09'))}`);
  }
  // Rejecting a malformed candidate must not swallow a valid one later in the
  // note — the scan has to continue past the bad match, not stop at it.
  if (cadence.parseAppliedDate('Applied 2026-06-091 (typo); Applied 2026-06-17 for real') === '2026-06-17') {
    pass('parseAppliedDate skips a malformed date and takes the next valid one');
  } else {
    fail(`parseAppliedDate should skip the malformed date, got ${JSON.stringify(cadence.parseAppliedDate('Applied 2026-06-091 (typo); Applied 2026-06-17 for real'))}`);
  }
  // A date can match the token shape and still not exist. These must not be
  // returned as MEASURED application dates: parseDate() rolls them over
  // (2026-06-31 -> 2026-07-01), so an impossible date silently becomes a real
  // but wrong one and shifts the cadence by days. The honest
  // evaluation-date fallback is strictly better than a fabricated date.
  const impossibleDates = [
    ['Applied 2026-06-31', 'a 31st in a 30-day month'],
    ['Applied 2026-02-30', 'a 30th in February'],
    ['Applied 2026-02-29', 'a 29th of February in a non-leap year'],
    ['Applied 2026-13-01', 'a 13th month'],
    ['Applied 2026-00-10', 'a zero month'],
    ['Applied 2026-06-00', 'a zero day'],
  ];
  const VALIDATE = { requireValidCalendarDate: true };
  for (const [notes, label] of impossibleDates) {
    if (cadence.parseAppliedDate(notes, VALIDATE) === null) {
      pass(`parseAppliedDate rejects ${label} when calendar validation is requested (${notes})`);
    } else {
      fail(`parseAppliedDate should reject ${label}, got ${JSON.stringify(cadence.parseAppliedDate(notes, VALIDATE))} from ${JSON.stringify(notes)}`);
    }
  }
  // Validation is OPT-IN. followup-seed.mjs depends on receiving the raw
  // candidate so it can throw INVALID_DATE and make the user fix the typo;
  // filtering unconditionally would turn that loud, fixable error into a
  // silent wrong answer.
  if (cadence.parseAppliedDate('Applied 2026-06-31') === '2026-06-31') {
    pass('parseAppliedDate returns the raw candidate by default so callers can reject it loudly');
  } else {
    fail(`parseAppliedDate default mode must not swallow an impossible date, got ${JSON.stringify(cadence.parseAppliedDate('Applied 2026-06-31'))}`);
  }
  // A real leap day must still be accepted — the validity check must not
  // over-reject.
  if (cadence.parseAppliedDate('Applied 2024-02-29', VALIDATE) === '2024-02-29') {
    pass('parseAppliedDate accepts a real leap day under validation');
  } else {
    fail(`parseAppliedDate should accept 2024-02-29, got ${JSON.stringify(cadence.parseAppliedDate('Applied 2024-02-29', VALIDATE))}`);
  }
  // The continued-scan contract applies to calendar-invalid candidates too.
  if (cadence.parseAppliedDate('Applied 2026-06-31; corrected: Applied 2026-06-30', VALIDATE) === '2026-06-30') {
    pass('parseAppliedDate skips an impossible date and takes the next valid one');
  } else {
    fail(`parseAppliedDate should skip the impossible date, got ${JSON.stringify(cadence.parseAppliedDate('Applied 2026-06-31; corrected: Applied 2026-06-30', VALIDATE))}`);
  }
  // isRealCalendarDate is exported so callers share one definition of validity.
  if (cadence.isRealCalendarDate('2024-02-29') && !cadence.isRealCalendarDate('2026-02-29') && !cadence.isRealCalendarDate('nope')) {
    pass('isRealCalendarDate distinguishes a real leap day from an impossible one');
  } else {
    fail('isRealCalendarDate mis-classifies a calendar date');
  }
  // Date.UTC() maps years 0-99 onto 1900-1999, so a literal ISO year below
  // 0100 would be validated against the wrong year entirely.
  if (cadence.isRealCalendarDate('0096-02-29') && !cadence.isRealCalendarDate('0097-02-29')) {
    pass('isRealCalendarDate preserves a literal ISO year below 0100');
  } else {
    fail(`isRealCalendarDate mishandles a sub-0100 year: 0096-02-29=${cadence.isRealCalendarDate('0096-02-29')} 0097-02-29=${cadence.isRealCalendarDate('0097-02-29')}`);
  }
  // And the source must degrade to the fallback, not report a fabricated date.
  {
    const r = cadence.resolveAppliedDate({ date: '2026-06-01', notes: 'Applied 2026-06-31' });
    if (r.appliedDate === '2026-06-01' && r.appDateSource === 'evaluation-date-fallback') {
      pass('resolveAppliedDate falls back when the notes date is not a real calendar date');
    } else {
      fail(`resolveAppliedDate impossible-date case got ${JSON.stringify(r)}`);
    }
  }
  if (cadence.parseAppliedDate('Reapplied 2026-06-09; applied 2026-06-17') === '2026-06-17') {
    pass('parseAppliedDate skips a "reapplied" match and takes the next valid one');
  } else {
    fail(`parseAppliedDate should skip "reapplied" and continue, got ${JSON.stringify(cadence.parseAppliedDate('Reapplied 2026-06-09; applied 2026-06-17'))}`);
  }
  // Two valid dates: the first still wins (already covered for a status date;
  // this pins it for two literal "applied" mentions).
  if (cadence.parseAppliedDate('Applied 2026-06-09, then applied 2026-07-01 to a second req') === '2026-06-09') {
    pass('parseAppliedDate keeps the first of two "applied" dates');
  } else {
    fail(`parseAppliedDate should keep the first applied date, got ${JSON.stringify(cadence.parseAppliedDate('Applied 2026-06-09, then applied 2026-07-01 to a second req'))}`);
  }
  // Reverse ordering: a later malformed candidate must not disturb the earlier
  // valid match the scan already found.
  if (cadence.parseAppliedDate('Applied 2026-06-09; Applied 2026-06-171 (typo)') === '2026-06-09') {
    pass('parseAppliedDate keeps a valid first date despite a later malformed one');
  } else {
    fail(`parseAppliedDate should keep the valid first date, got ${JSON.stringify(cadence.parseAppliedDate('Applied 2026-06-09; Applied 2026-06-171 (typo)'))}`);
  }
  // Boundary characters that legitimately terminate a date must keep matching —
  // a boundary guard that also rejects these would break real tracker notes.
  const validTerminators = [
    ['Applied 2026-06-09', 'end of string'],
    ['Applied 2026-06-09.', 'a period'],
    ['Applied 2026-06-09; noted', 'a semicolon'],
    ['Applied 2026-06-09)', 'a closing paren'],
    ['Applied 2026-06-09\nvia Personio', 'a newline'],
  ];
  for (const [notes, label] of validTerminators) {
    if (cadence.parseAppliedDate(notes) === '2026-06-09') {
      pass(`parseAppliedDate still matches a date terminated by ${label}`);
    } else {
      fail(`parseAppliedDate should match with ${label}, got ${JSON.stringify(cadence.parseAppliedDate(notes))} from ${JSON.stringify(notes)}`);
    }
  }
  // Nullish notes must not throw (the tracker's Notes cell can be absent).
  if (cadence.parseAppliedDate(null) === null && cadence.parseAppliedDate(undefined) === null) {
    pass('parseAppliedDate returns null for nullish notes');
  } else {
    fail('parseAppliedDate should return null for null/undefined notes');
  }

  // resolveAppliedDate — reports WHICH date the cadence is measured from, so a
  // consumer can tell a real application date from the evaluation-date proxy.
  // Without it a fallback age is indistinguishable from a measured one.
  {
    const measured = cadence.resolveAppliedDate({ date: '2026-06-01', notes: 'Applied 2026-06-09 via Personio' });
    if (measured.appliedDate === '2026-06-09' && measured.appDateSource === 'notes') {
      pass('resolveAppliedDate reports source "notes" when the apply date is recorded');
    } else {
      fail(`resolveAppliedDate notes-case got ${JSON.stringify(measured)}`);
    }

    const inferred = cadence.resolveAppliedDate({ date: '2026-06-01', notes: 'On-archetype fit; no submission yet' });
    if (inferred.appliedDate === '2026-06-01' && inferred.appDateSource === 'evaluation-date-fallback') {
      pass('resolveAppliedDate flags the evaluation-date proxy as a fallback, not a measured date');
    } else {
      fail(`resolveAppliedDate fallback-case got ${JSON.stringify(inferred)}`);
    }

    const estimated = cadence.resolveAppliedDate({ date: '2026-06-01', notes: 'Applied ~2026-06-09' });
    if (estimated.appliedDate === '2026-06-09' && estimated.appDateSource === 'notes') {
      pass('resolveAppliedDate treats an estimated "~" apply date as a recorded date, not a fallback');
    } else {
      fail(`resolveAppliedDate estimated-case got ${JSON.stringify(estimated)}`);
    }

    // A malformed note must degrade to the honest fallback, not to a truncated
    // date wearing the "notes" provenance label.
    const malformed = cadence.resolveAppliedDate({ date: '2026-06-01', notes: 'Applied 2026-06-091 (typo)' });
    if (malformed.appliedDate === '2026-06-01' && malformed.appDateSource === 'evaluation-date-fallback') {
      pass('resolveAppliedDate falls back rather than trusting a truncated apply date');
    } else {
      fail(`resolveAppliedDate malformed-case got ${JSON.stringify(malformed)}`);
    }
  }

  // analyze() output contract: every emitted entry must carry appDateSource, and
  // the value must match how the date was actually obtained. The unit tests above
  // only cover the helper — this pins the field on the JSON consumers read, which
  // is where a silently-inferred age would actually do damage.
  cadenceAppDateSourceE2e: {
    // NOT realpathed, deliberately. This used to be, because followup-cadence's
    // hand-rolled CLI guard compared a realpath-resolved import.meta.url against
    // a lexical argv[1], so macOS's symlinked tmpdir silently suppressed main()
    // and yielded empty stdout. lib/is-main-module.mjs canonicalizes both sides
    // (#3170), so the workaround can go.
    //
    // Do NOT read this as coverage of that fix: whether a symlink is involved
    // at all depends on the platform's tmpdir (it is one on macOS, usually not
    // on Linux CI), so on most runs this proves nothing about #3170. The
    // deliberate coverage lives in tests/main-guard-convention.test.mjs, which
    // creates its own symlink. What this line buys is the absence of a
    // workaround that would otherwise outlive its reason and mislead a reader.
    const e2eTmp = mkdtempSync(join(tmpdir(), 'co-cadence-e2e-'));
    try {
      copyFileSync(join(ROOT, 'followup-cadence.mjs'), join(e2eTmp, 'followup-cadence.mjs'));
      copyFileSync(join(ROOT, 'owed-actions.mjs'), join(e2eTmp, 'owed-actions.mjs'));
      copyFileSync(join(ROOT, 'tracker-parse.mjs'), join(e2eTmp, 'tracker-parse.mjs'));
      copyFileSync(join(ROOT, 'tracker-aliases.json'), join(e2eTmp, 'tracker-aliases.json'));
      // followup-cadence now derives its status aliases from templates/states.yml
      // via tracker-utils, so the fixture has to carry both — same reason
      // tracker-aliases.json is copied for tracker-parse.mjs (#2704).
      copyFileSync(join(ROOT, 'tracker-utils.mjs'), join(e2eTmp, 'tracker-utils.mjs'));
      // ...and tracker-utils imports the shared lock-contention helpers
      // (#2777 fix), so the fixture carries that import too.
      copyFileSync(join(ROOT, 'pipeline-lock.mjs'), join(e2eTmp, 'pipeline-lock.mjs'));
      // ...and followup-cadence resolves user-layer paths via path-resolver.mjs
      // (CAREER_OPS_ROOT), so the fixture carries that too.
      copyFileSync(join(ROOT, 'path-resolver.mjs'), join(e2eTmp, 'path-resolver.mjs'));
      // ...and followup-cadence now resolves "today" as the LOCAL calendar day
      // via lib/local-today.mjs (#3070), so the fixture carries that too.
      mkdirSync(join(e2eTmp, 'lib'), { recursive: true });
      copyFileSync(join(ROOT, 'lib', 'local-today.mjs'), join(e2eTmp, 'lib', 'local-today.mjs'));
      // ...and followup-cadence now delegates flag validation to the shared
      // lib/cli-flags.mjs helper, so the fixture carries that too.
      copyFileSync(join(ROOT, 'lib', 'cli-flags.mjs'), join(e2eTmp, 'lib', 'cli-flags.mjs'));
      // ...and the rest of lib/ (yaml-document, dir-lock, ... reached through owed-actions and tracker-utils).
      cpSync(join(ROOT, 'lib'), join(e2eTmp, 'lib'), { recursive: true });
      // ...and its main-guard now comes from lib/is-main-module.mjs (#3170),
      // which is what lets the copy answer "am I main?" correctly from a
      // symlinked tmpdir in the first place.
      copyFileSync(join(ROOT, 'lib', 'is-main-module.mjs'), join(e2eTmp, 'lib', 'is-main-module.mjs'));
      mkdirSync(join(e2eTmp, 'templates'), { recursive: true });
      copyFileSync(join(ROOT, 'templates', 'states.yml'), join(e2eTmp, 'templates', 'states.yml'));
      // The sandbox resolves js-yaml (and the rest of followup-cadence's
      // package imports) through the repo's own installed tree. linkNodeModules
      // junction-links on Windows, where a directory symlink would need
      // SeCreateSymbolicLinkPrivilege and threw EPERM on an ordinary checkout.
      // It also refuses to link blind against a tree that was never installed:
      // symlinkSync succeeds on a missing target, the dangling link killed the
      // child with ERR_MODULE_NOT_FOUND, and the catch below reported that as a
      // crash of the appDateSource contract, which is innocent. This suite is
      // meant to run on a fresh clone with only Node, so an absent tree is a
      // skip that names itself.
      const depsReason = linkNodeModules(e2eTmp);
      if (depsReason) {
        warn(`analyze() appDateSource end-to-end check skipped: ${depsReason}`);
        break cadenceAppDateSourceE2e;
      }
      mkdirSync(join(e2eTmp, 'data'), { recursive: true });
      writeFileSync(join(e2eTmp, 'data', 'applications.md'), [
        '# Applications Tracker',
        '',
        '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
        '|---|------|---------|------|-------|--------|-----|--------|-------|',
        '| 901 | 2026-06-01 | ExactCo | Head of AI | 4.5/5 | Applied | ✅ | [901](reports/901-exactco-2026-06-01.md) | Applied 2026-06-09 via Personio |',
        '| 902 | 2026-06-02 | EstimateCo | Head of AI | 4.4/5 | Applied | ✅ | [902](reports/902-estimateco-2026-06-02.md) | Applied ~2026-06-10 (date estimated) |',
        '| 903 | 2026-06-03 | FallbackCo | Head of AI | 4.3/5 | Applied | ✅ | [903](reports/903-fallbackco-2026-06-03.md) | On-archetype fit; no apply date recorded |',
        '| 904 | 2026-06-04 | TypoCo | Head of AI | 4.2/5 | Applied | ✅ | [904](reports/904-typoco-2026-06-04.md) | Applied 2026-06-091 typo in the tracker |',
        '',
      ].join('\n'), 'utf-8');

      const e2eOut = execFileSync(NODE, [join(e2eTmp, 'followup-cadence.mjs')], {
        cwd: e2eTmp,
        encoding: 'utf-8',
        timeout: 30000,
        env: { ...process.env, CAREER_OPS_PROFILE: '' },
      });
      const e2e = JSON.parse(e2eOut.trim());
      const byNum = new Map((e2e.entries || []).map(entry => [entry.num, entry]));

      const e2eCases = [
        [901, '2026-06-09', 'notes', 'an exact "Applied YYYY-MM-DD" note'],
        [902, '2026-06-10', 'notes', 'an estimated "Applied ~YYYY-MM-DD" note'],
        [903, '2026-06-03', 'evaluation-date-fallback', 'notes with no apply date'],
        [904, '2026-06-04', 'evaluation-date-fallback', 'a malformed apply date in the notes'],
      ];
      for (const [num, expectedDate, expectedSource, label] of e2eCases) {
        const entry = byNum.get(num);
        if (entry && entry.appliedDate === expectedDate && entry.appDateSource === expectedSource) {
          pass(`analyze() emits appDateSource "${expectedSource}" for ${label}`);
        } else {
          fail(`analyze() entry #${num} (${label}) got ${JSON.stringify(entry && { appliedDate: entry.appliedDate, appDateSource: entry.appDateSource })}`);
        }
      }

      const missingSource = (e2e.entries || []).filter(entry => !['notes', 'evaluation-date-fallback'].includes(entry.appDateSource));
      if ((e2e.entries || []).length === 4 && missingSource.length === 0) {
        pass('analyze() stamps every emitted entry with a known appDateSource');
      } else {
        fail(`analyze() emitted ${(e2e.entries || []).length} entries, ${missingSource.length} without a known appDateSource`);
      }
    } catch (e2eErr) {
      fail(`analyze() appDateSource end-to-end check crashed: ${e2eErr.message}`);
    } finally {
      rmSync(e2eTmp, { recursive: true, force: true });
    }
  }

  // Status normalization (strips bold + trailing date, lowercases, maps aliases)
  if (cadence.normalizeStatus('**Applied** 2026-05-01') === 'applied') {
    pass('normalizeStatus strips bold + trailing date and lowercases');
  } else {
    fail(`normalizeStatus produced ${cadence.normalizeStatus('**Applied** 2026-05-01')}`);
  }

  const cadenceTmp = mkdtempSync(join(tmpdir(), 'co-cadence-'));
  const profilePath = join(cadenceTmp, 'profile.yml');
  writeFileSync(profilePath, [
    'followup_cadence:',
    '  applied_first_days: 11',
    '  applied_subsequent_days: 5',
    '  applied_max_followups: 4',
    '  responded_initial_days: 2',
    '  responded_subsequent_days: 6',
    '  interview_thankyou_days: 3',
  ].join('\n'));

  const profileCadence = cadence.resolveCadenceConfig({ profilePath });
  if (
    profileCadence.applied_first === 11 &&
    profileCadence.applied_subsequent === 5 &&
    profileCadence.applied_max_followups === 4 &&
    profileCadence.responded_initial === 2 &&
    profileCadence.responded_subsequent === 6 &&
    profileCadence.interview_thankyou === 3
  ) {
    pass('follow-up cadence reads profile.yml overrides');
  } else {
    fail(`profile cadence override failed: ${JSON.stringify(profileCadence)}`);
  }

  const cliCadence = cadence.resolveCadenceConfig({ profilePath, appliedDays: 9 });
  if (cliCadence.applied_first === 9 && cliCadence.applied_subsequent === 5) {
    pass('follow-up cadence CLI override wins over profile applied_first');
  } else {
    fail(`CLI cadence override failed: ${JSON.stringify(cliCadence)}`);
  }

  const malformedProfile = join(cadenceTmp, 'malformed.yml');
  writeFileSync(malformedProfile, 'followup_cadence: [');
  const fallbackCadence = cadence.resolveCadenceConfig({ profilePath: malformedProfile });
  if (fallbackCadence.applied_first === cadence.DEFAULT_CADENCE.applied_first) {
    pass('follow-up cadence ignores malformed optional profile config');
  } else {
    fail(`malformed profile did not fall back to defaults: ${JSON.stringify(fallbackCadence)}`);
  }

  rmSync(cadenceTmp, { recursive: true, force: true });

  // Urgency decision tree (CADENCE defaults: applied_first=7, max_followups=2, responded_initial=1, interview_thankyou=1)
  const urgencyCases = [
    [['applied', 7, null, 0], 'overdue', 'applied past applied_first → overdue'],
    [['applied', 3, null, 0], 'waiting', 'applied within window → waiting'],
    [['applied', 30, null, 2], 'cold', 'applied at max follow-ups → cold'],
    [['responded', 0, null, 0], 'urgent', 'responded before responded_initial → urgent'],
    [['interview', 1, null, 0], 'overdue', 'interview past thank-you window → overdue'],
  ];
  for (const [args, expected, label] of urgencyCases) {
    const got = cadence.computeUrgency(...args);
    if (got === expected) pass(`computeUrgency: ${label}`);
    else fail(`computeUrgency ${label}: expected ${expected}, got ${got}`);
  }

  // Next follow-up date scheduling
  const nextCases = [
    [['applied', '2026-05-01', null, 0], '2026-05-08', 'first applied follow-up = appDate + applied_first'],
    [['applied', '2026-05-01', null, 2], null, 'cold (max follow-ups) → null'],
    [['interview', '2026-05-01', null, 0], '2026-05-02', 'interview = appDate + interview_thankyou'],
  ];
  for (const [args, expected, label] of nextCases) {
    const got = cadence.computeNextFollowupDate(...args);
    if (got === expected) pass(`computeNextFollowupDate: ${label}`);
    else fail(`computeNextFollowupDate ${label}: expected ${expected}, got ${got}`);
  }
} catch (e) {
  fail(`follow-up cadence module crashed: ${e.message}`);
}

// ── 12. PROVIDERS — Workable ────────────────────────────────────────

console.log('\n12. Tracker report-link normalization');

try {
  const { normalizeReportLink } = await import(pathToFileURL(join(ROOT, 'tracker-links.mjs')).href);
  const repo = '/repo';
  const dataDir = join(repo, 'data');

  // data/ layout: root-relative TSV link → ../reports/...
  const fromTsv = normalizeReportLink('[12](reports/012-acme-2026-01-04.md)', dataDir, repo);
  if (fromTsv === '[12](../reports/012-acme-2026-01-04.md)') {
    pass('data/ layout: root-relative link rewritten to ../reports/...');
  } else {
    fail(`data/ layout normalization wrong: ${fromTsv}`);
  }

  // Idempotent: re-running on an already-normalized link must not double-prefix
  const twice = normalizeReportLink(fromTsv, dataDir, repo);
  if (twice === fromTsv) {
    pass('normalization is idempotent (no double-prefix on re-run)');
  } else {
    fail(`normalization not idempotent: ${twice}`);
  }

  // Root layout: tracker at repo root → link stays reports/...
  const atRoot = normalizeReportLink('[12](reports/012-acme-2026-01-04.md)', repo, repo);
  if (atRoot === '[12](reports/012-acme-2026-01-04.md)') {
    pass('root layout: link stays root-relative reports/...');
  } else {
    fail(`root layout normalization wrong: ${atRoot}`);
  }

  // Non-report links are left untouched — including external URLs that happen
  // to contain an embedded "/reports/" segment (must not be rewritten).
  const other = normalizeReportLink('[site](https://example.com/reports/foo.md)', dataDir, repo);
  if (other === '[site](https://example.com/reports/foo.md)') {
    pass('non-report links (incl. URLs with embedded /reports/) are left untouched');
  } else {
    fail(`non-report link altered: ${other}`);
  }

  // End-to-end migration against a fictional fixture tracker (no personal data)
  const tmpDir = mkdtempSync(join(tmpdir(), 'career-ops-migrate-'));
  try {
    mkdirSync(join(tmpDir, 'data'));
    mkdirSync(join(tmpDir, 'reports'));
    writeFileSync(join(tmpDir, 'reports', '012-acme-2026-01-04.md'), '# fixture\n');
    const tracker = join(tmpDir, 'data', 'applications.md');
    writeFileSync(tracker,
      '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
      '| 12 | 2026-01-04 | Acme | Engineer | 4.2/5 | Evaluated | ✅ | [12](reports/012-acme-2026-01-04.md) | ok |\n');

    // Migrate by pointing the script at the fixture tracker via env override.
    run(NODE, ['merge-tracker.mjs', '--migrate'], { env: { ...process.env, CAREER_OPS_TRACKER: tracker } });
    const after = readFileSync(tracker, 'utf-8');
    if (after.includes('[12](../reports/012-acme-2026-01-04.md)')) {
      pass('migration rewrites fixture tracker links to ../reports/...');
    } else {
      fail('migration did not rewrite fixture tracker link');
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
} catch (e) {
  fail(`tracker-link normalization tests crashed: ${e.message}`);
}

// ── SHARED ROLE MATCHER + DEDUP-TRACKER SAFETY (#947) ───────────
// dedup-tracker.mjs used to ship an older fuzzy role matcher than
// merge-tracker.mjs. That weaker matcher collapsed sibling roles at the same
// company when they shared generic title words such as "Full Stack Engineer",
// and could delete an already-Applied row because data/applications.md is
// normally gitignored. The matcher is now shared, and dedup protects advanced
// application states from fuzzy-only deletion.
console.log('\n🧪 Testing shared role matcher and dedup-tracker safety...');
try {
  const { roleFuzzyMatch } = await import(pathToFileURL(join(ROOT, 'role-matcher.mjs')).href);

  if (!roleFuzzyMatch('Full Stack Engineer, Foundation', 'Full Stack Engineer, Guarded Releases')) {
    pass('role matcher keeps Full Stack Engineer sibling teams distinct (#947)');
  } else {
    fail('role matcher still collapses distinct Full Stack Engineer sibling teams');
  }

  if (!roleFuzzyMatch('Staff Software Engineer, API', 'Staff Software Engineer, SDK')) {
    pass('role matcher keeps short-acronym sibling teams distinct');
  } else {
    fail('role matcher collapsed API and SDK sibling teams');
  }

  if (roleFuzzyMatch('Staff Software Engineer, API', 'Staff Software Engineer, API Platform')) {
    pass('role matcher still uses short specialty acronyms for true overlaps');
  } else {
    fail('role matcher ignored a real short-acronym overlap');
  }

  // A sub-baseline qualifier on ONE side is a level disagreement, not a loose
  // rewrite: the tokenizer drops seniority words as stopwords, so these pairs
  // otherwise tokenize identically and scored a perfect Jaccard ratio, silently
  // collapsing two genuinely different requisitions (#2009, PR #2107).
  for (const [lower, bare] of [
    ['Associate Product Manager, TeamName', 'Product Manager, TeamName'],
    ['Junior Product Manager, TeamName', 'Product Manager, TeamName'],
    ['Entry Level Data Engineer', 'Data Engineer'],
  ]) {
    if (!roleFuzzyMatch(lower, bare)) {
      pass(`role matcher keeps "${lower}" distinct from the bare title (#2009)`);
    } else {
      fail(`role matcher collapsed "${lower}" into the bare title "${bare}"`);
    }
  }

  // Direction must not matter — the lone qualifier can be on either side.
  if (!roleFuzzyMatch('Product Manager, TeamName', 'Associate Product Manager, TeamName')) {
    pass('role matcher applies the sub-baseline gate in both argument orders (#2009)');
  } else {
    fail('role matcher only applied the sub-baseline gate in one argument order');
  }

  // Both sides sub-baseline at the same level is still the same opening.
  if (roleFuzzyMatch('Associate Product Manager, TeamName', 'Associate Product Manager, TeamName')) {
    pass('role matcher still matches two same-level Associate reposts (#2009)');
  } else {
    fail('role matcher rejected a genuine Associate-level repost');
  }

  const dedupTmp = mkdtempSync(join(tmpdir(), 'career-ops-dedup-'));
  try {
    mkdirSync(join(dedupTmp, 'data'));
    const tracker = join(dedupTmp, 'data', 'applications.md');
    writeFileSync(tracker,
      '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
      '| 21 | 2026-01-08 | Acme | Full Stack Engineer, Foundation | 3.9/5 | Applied | ❌ | [21](../reports/021-foundation.md) | applied sibling |\n' +
      '| 22 | 2026-01-08 | Acme | Full Stack Engineer, Guarded Releases | 4.3/5 | Evaluated | ❌ | [22](../reports/022-guarded.md) | evaluated sibling |\n' +
      '| 23 | 2026-01-08 | Acme | Staff Software Engineer, API | 4.0/5 | Evaluated | ❌ | [23](../reports/023-api.md) | acronym sibling |\n' +
      '| 24 | 2026-01-08 | Acme | Staff Software Engineer, SDK | 4.2/5 | Evaluated | ❌ | [24](../reports/024-sdk.md) | acronym sibling |\n' +
      '| 25 | 2026-01-08 | Acme | Product Engineer, Growth | 3.8/5 | Evaluated | ❌ | [25](../reports/025-growth-old.md) | duplicate old |\n' +
      '| 26 | 2026-01-09 | Acme | Product Engineer, Growth | 4.0/5 | Evaluated | ❌ | [26](../reports/026-growth-new.md) | duplicate new |\n' +
      '| 27 | 2026-01-08 | Acme | Solutions Engineer, Revenue | 3.0/5 | Applied | ❌ | [27](../reports/027-revenue-applied.md) | applied exact-title row |\n' +
      '| 28 | 2026-01-09 | Acme | Solutions Engineer, Revenue | 4.6/5 | Evaluated | ❌ | [28](../reports/028-revenue-eval.md) | evaluated exact-title row |\n' +
      '| 29 | 2026-01-08 | Acme | Data Engineer, Search | 3.1/5 | Applied | ❌ | [29](../reports/029-search-old.md) | malformed duplicate-number old row |\n' +
      '| 29 | 2026-01-09 | Acme | Data Engineer, Search | 4.1/5 | Evaluated | ❌ | [30](../reports/030-search-new.md) | malformed duplicate-number new row |\n');

    const dedupResult = run(NODE, ['dedup-tracker.mjs'], { env: { ...process.env, CAREER_OPS_TRACKER: tracker } });
    if (dedupResult === null) {
      fail('dedup-tracker.mjs crashed during shared role matcher safety test');
    } else {
      const deduped = readFileSync(tracker, 'utf-8');

      if (deduped.includes('Full Stack Engineer, Foundation') && deduped.includes('Full Stack Engineer, Guarded Releases')) {
        pass('dedup-tracker preserves distinct Full Stack Engineer sibling rows');
      } else {
        fail('dedup-tracker removed a distinct Full Stack Engineer sibling row');
      }

      if (deduped.includes('Staff Software Engineer, API') && deduped.includes('Staff Software Engineer, SDK')) {
        pass('dedup-tracker preserves short-acronym sibling rows');
      } else {
        fail('dedup-tracker removed a short-acronym sibling row');
      }

      const growthRows = deduped.split('\n').filter(l => l.includes('Product Engineer, Growth'));
      if (growthRows.length === 1 && growthRows[0].includes('4.0/5')) {
        pass('dedup-tracker still removes a real duplicate evaluated row');
      } else {
        fail(`dedup-tracker duplicate handling broken: ${growthRows.length} Growth rows`);
      }

      const revenueRows = deduped.split('\n').filter(l => l.includes('Solutions Engineer, Revenue'));
      if (revenueRows.length === 2 && revenueRows.some(l => l.includes('Applied'))) {
        pass('dedup-tracker never removes Applied+ rows by fuzzy title match');
      } else {
        fail('dedup-tracker removed an Applied+ row by fuzzy title match');
      }

      const searchRows = deduped.split('\n').filter(l => l.includes('Data Engineer, Search'));
      if (searchRows.length === 1 && searchRows[0].includes('4.1/5') && searchRows[0].includes('Applied')) {
        pass('dedup-tracker handles duplicate tracker numbers using row-local line indexes');
      } else {
        fail(`dedup-tracker duplicate-number handling broken: ${searchRows.length} Search rows`);
      }
    }
  } finally {
    rmSync(dedupTmp, { recursive: true, force: true });
  }
} catch (e) {
  fail(`shared role matcher / dedup safety tests crashed: ${e.message}`);
}

// ── SET-STATUS.MJS CLI CONTRACT ─────────────────────────────────
// set-status.mjs is the canonical write path for tracker status updates but had
// zero test coverage despite being called from multiple modes. Covers: a clean
// single-row update, ambiguous company-name rejection (never guesses), --dry-run
// making no write, idempotent re-runs, and invalid-state rejection before any
// write. Only CAREER_OPS_TRACKER is overridden (matching the dedup-tracker /
// merge-tracker tests above) — states.yml and role-matcher.mjs still resolve
// from the real repo, which is exactly what set-status.mjs does in production.
console.log('\n🧪 Testing set-status.mjs CLI contract...');
try {
  /**
   * Run set-status.mjs against a fixture tracker, tolerating non-zero exit
   * codes (ambiguous match / invalid state are expected failures, not crashes).
   * Mirrors run()'s execFileSync usage but keeps stdout+exit code on failure —
   * run() itself discards both, which the ambiguous/invalid-state assertions need.
   *
   * @param {string[]} args
   * @param {string} tracker
   * @returns {{status: number, stdout: string}}
   */
  function runSetStatus(args, tracker) {
    try {
      const stdout = execFileSync(NODE, ['set-status.mjs', ...args], {
        cwd: ROOT, encoding: 'utf-8', timeout: 30000,
        env: { ...process.env, CAREER_OPS_TRACKER: tracker },
      });
      return { status: 0, stdout };
    } catch (e) {
      return { status: e.status ?? 1, stdout: e.stdout ?? '' };
    }
  }

  const statusTmp = mkdtempSync(join(tmpdir(), 'career-ops-set-status-'));
  try {
    mkdirSync(join(statusTmp, 'data'));
    const tracker = join(statusTmp, 'data', 'applications.md');
    const fixture =
      '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
      '| 41 | 2026-01-10 | Acme | Backend Engineer | 4.1/5 | Evaluated | ❌ | [41](../reports/041-acme.md) | first sibling |\n' +
      '| 42 | 2026-01-11 | Acme | Frontend Engineer | 4.0/5 | Evaluated | ❌ | [42](../reports/042-acme.md) | second sibling, same company |\n' +
      '| 43 | 2026-01-12 | Globex | Data Engineer | 3.7/5 | Evaluated | ❌ | [43](../reports/043-globex.md) | unambiguous row |\n';
    writeFileSync(tracker, fixture);

    // (a) single unambiguous report-number update succeeds and writes the status
    const byNum = runSetStatus(['43', 'Interview', '--json'], tracker);
    const afterByNum = readFileSync(tracker, 'utf-8');
    if (byNum.status === 0 && /\|\s*Interview\s*\|/.test(afterByNum.split('\n').find(l => l.startsWith('| 43')))) {
      pass('set-status: unambiguous report-number update writes the new status');
    } else {
      fail(`set-status: report-number update failed (exit ${byNum.status}): ${afterByNum}`);
    }

    // (b) ambiguous company match (2 rows, same company) is rejected, not guessed
    const beforeAmbiguous = readFileSync(tracker, 'utf-8');
    const ambiguous = runSetStatus(['Acme', 'Applied', '--json'], tracker);
    const afterAmbiguous = readFileSync(tracker, 'utf-8');
    let ambiguousJson = null;
    try { ambiguousJson = JSON.parse(ambiguous.stdout); } catch { /* leave null, checked below */ }
    if (ambiguous.status === 3 && ambiguousJson?.code === 'ambiguous' && afterAmbiguous === beforeAmbiguous) {
      pass('set-status: ambiguous company match exits 3 with a clear error and writes nothing');
    } else {
      fail(`set-status: ambiguous company match not rejected cleanly (exit ${ambiguous.status}, code ${ambiguousJson?.code}, tracker changed: ${afterAmbiguous !== beforeAmbiguous})`);
    }

    // (c) --dry-run makes no actual write to the fixture file
    const beforeDryRun = readFileSync(tracker, 'utf-8');
    const dryRun = runSetStatus(['41', 'Applied', '--dry-run', '--json'], tracker);
    const afterDryRun = readFileSync(tracker, 'utf-8');
    let dryRunJson = null;
    try { dryRunJson = JSON.parse(dryRun.stdout); } catch { /* leave null, checked below */ }
    if (dryRun.status === 0 && dryRunJson?.dryRun === true && dryRunJson?.changed === true && afterDryRun === beforeDryRun) {
      pass('set-status: --dry-run resolves+validates but writes nothing');
    } else {
      fail(`set-status: --dry-run mutated the tracker or misreported (exit ${dryRun.status}, changed ${dryRunJson?.changed}, tracker changed: ${afterDryRun !== beforeDryRun})`);
    }

    // (d) re-running the same update is idempotent — second run reports no change
    const firstRun = runSetStatus(['41', 'Applied', '--json'], tracker);
    const afterFirstRun = readFileSync(tracker, 'utf-8');
    const secondRun = runSetStatus(['41', 'Applied', '--json'], tracker);
    const afterSecondRun = readFileSync(tracker, 'utf-8');
    let firstJson = null, secondJson = null;
    try { firstJson = JSON.parse(firstRun.stdout); } catch { /* leave null, checked below */ }
    try { secondJson = JSON.parse(secondRun.stdout); } catch { /* leave null, checked below */ }
    if (firstJson?.changed === true && secondJson?.changed === false && afterFirstRun === afterSecondRun) {
      pass('set-status: re-running the same update is idempotent (second run reports no change)');
    } else {
      fail(`set-status: idempotency broken (first changed ${firstJson?.changed}, second changed ${secondJson?.changed}, tracker stable: ${afterFirstRun === afterSecondRun})`);
    }

    // (e) an invalid/unrecognized state value is rejected before any write happens
    const beforeInvalid = readFileSync(tracker, 'utf-8');
    const invalid = runSetStatus(['41', 'NotARealState', '--json'], tracker);
    const afterInvalid = readFileSync(tracker, 'utf-8');
    let invalidJson = null;
    try { invalidJson = JSON.parse(invalid.stdout); } catch { /* leave null, checked below */ }
    if (invalid.status === 1 && invalidJson?.code === 'invalid-state' && afterInvalid === beforeInvalid) {
      pass('set-status: unrecognized state is rejected before any write');
    } else {
      fail(`set-status: invalid state not rejected cleanly (exit ${invalid.status}, code ${invalidJson?.code}, tracker changed: ${afterInvalid !== beforeInvalid})`);
    }

    // (f) "--note --dry-run" must never swallow --dry-run as the note value —
    // that would silently turn a preview into a real write.
    const beforeFlagGuard = readFileSync(tracker, 'utf-8');
    const flagGuard = runSetStatus(['43', 'Applied', '--note', '--dry-run', '--json'], tracker);
    const afterFlagGuard = readFileSync(tracker, 'utf-8');
    if (flagGuard.status !== 0 && afterFlagGuard === beforeFlagGuard) {
      pass('set-status: "--note --dry-run" rejects the missing value instead of eating --dry-run');
    } else {
      fail(`set-status: --note flag-value guard (exit ${flagGuard.status}, tracker changed: ${afterFlagGuard !== beforeFlagGuard})`);
    }

    // (g) delimiter-aware note idempotency — a short note that is a bare
    // substring of an existing longer note must still be appended, and once
    // appended, re-applying the same note must not duplicate it.
    const noteRun1 = runSetStatus(['43', 'Applied', '--note', 'sent CV', '--json'], tracker);
    const afterNote1 = readFileSync(tracker, 'utf-8').split('\n').find(l => l.startsWith('| 43'));
    const noteRun2 = runSetStatus(['43', 'Applied', '--note', 'sent', '--json'], tracker);
    const afterNote2 = readFileSync(tracker, 'utf-8').split('\n').find(l => l.startsWith('| 43'));
    const noteRun3 = runSetStatus(['43', 'Applied', '--note', 'sent', '--json'], tracker);
    const afterNote3 = readFileSync(tracker, 'utf-8').split('\n').find(l => l.startsWith('| 43'));
    let noteJson2 = null, noteJson3 = null;
    try { noteJson2 = JSON.parse(noteRun2.stdout); } catch { /* leave null, checked below */ }
    try { noteJson3 = JSON.parse(noteRun3.stdout); } catch { /* leave null, checked below */ }
    if (afterNote1.includes('sent CV') && afterNote2.includes('sent CV; sent') && noteJson2?.changed === true) {
      pass('set-status: note that is a substring of an existing entry is still appended');
    } else {
      fail(`set-status: substring note not appended — after1 "${afterNote1}", after2 "${afterNote2}"`);
    }
    if (afterNote3 === afterNote2 && noteJson3?.changed === false) {
      pass('set-status: re-applying the identical note is idempotent (delimiter-aware match)');
    } else {
      fail(`set-status: note idempotency broken — after2 "${afterNote2}", after3 "${afterNote3}", changed ${noteJson3?.changed}`);
    }
  } finally {
    rmSync(statusTmp, { recursive: true, force: true });
  }
} catch (e) {
  fail(`set-status.mjs CLI contract tests crashed: ${e.message}`);
}

// dedup-tracker / normalize-statuses rebuilt promoted rows with
// `parts.slice(1, -1)`, which assumes the closing `|` produced a trailing empty
// cell. A valid row written WITHOUT a trailing pipe keeps its real last cell
// (the notes) at the end, so the old reconstruction silently dropped the notes
// when promoting a keeper's status during dedup. rebuildRow() now preserves it.
console.log('\n🧪 Testing dedup row rebuild preserves notes on no-trailing-pipe rows...');
try {
  const rebuildTmp = mkdtempSync(join(tmpdir(), 'career-ops-rebuild-'));
  try {
    mkdirSync(join(rebuildTmp, 'data'));
    const tracker = join(rebuildTmp, 'data', 'applications.md');
    // Keeper row #50 has the higher score AND no trailing pipe; dup #51 carries a
    // more-advanced status (both below Applied, so the advanced-status safety
    // guard doesn't block the collapse), so dedup promotes #50's status and
    // rewrites the row — exercising rebuildRow() on a no-trailing-pipe row.
    writeFileSync(tracker,
      '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
      '| 50 | 2026-02-01 | Globex | Widget Engineer | 4.5/5 | Rejected | ❌ | [50](../reports/050-widget.md) | KEEPER_NOTE_SENTINEL\n' +
      '| 51 | 2026-02-02 | Globex | Widget Engineer | 3.0/5 | Evaluated | ❌ | [51](../reports/051-widget.md) | dup row |\n');

    const r = run(NODE, ['dedup-tracker.mjs'], { env: { ...process.env, CAREER_OPS_TRACKER: tracker } });
    if (r === null) {
      fail('dedup-tracker.mjs crashed during notes-preservation test');
    } else {
      const out = readFileSync(tracker, 'utf-8');
      const keeperRow = out.split('\n').find(l => l.includes('| 50 |'));
      if (keeperRow && keeperRow.includes('KEEPER_NOTE_SENTINEL') && keeperRow.includes('Evaluated')) {
        pass('dedup row rebuild preserves the notes column on rows without a trailing pipe');
      } else {
        fail(`dedup row rebuild dropped notes / status on no-trailing-pipe row: "${keeperRow}"`);
      }
    }
  } finally {
    rmSync(rebuildTmp, { recursive: true, force: true });
  }
} catch (e) {
  fail(`dedup row-rebuild notes test crashed: ${e.message}`);
}

// ── MERGE-TRACKER FUZZY DEDUP (#751 / #721 family) ──────────────
// roleFuzzyMatch over-matched whenever the token overlap dominated the
// SMALLER side: two distinct roles sharing a long prefix ("Full-Stack
// Engineer 5, AI Insights & Visualizations" vs "Full Stack Engineer 5, Ads
// Reporting") or a brand token (#751: "UberEats Feed" vs "Consumer
// Fulfillment (UberEats)") collapsed onto one tracker row — silently
// dropping evaluations. The ratio now divides by the token UNION (true
// Jaccard): genuine reposts (identical token sets) still score 1.0, while
// distinct specialties fall below the 0.6 threshold.
console.log('\n🧪 Testing merge-tracker fuzzy dedup (distinct roles vs reposts)...');
try {
  const mergeTmp = mkdtempSync(join(tmpdir(), 'career-ops-merge-'));
  try {
    mkdirSync(join(mergeTmp, 'data'));
    mkdirSync(join(mergeTmp, 'reports'));
    const additionsDir = join(mergeTmp, 'additions');
    mkdirSync(additionsDir);
    const tracker = join(mergeTmp, 'data', 'applications.md');
    writeFileSync(tracker,
      '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
      '| 1 | 2026-01-04 | StreamCo | Full Stack Engineer 5, Ads Reporting | 4.4/5 | Evaluated | ❌ | [1](../reports/001-streamco-2026-01-04.md) | existing |\n' +
      '| 2 | 2026-01-04 | Uber | Senior Software Engineer, Consumer Fulfillment (UberEats) | 4.2/5 | Evaluated | ❌ | [2](../reports/002-uber-2026-01-04.md) | existing |\n');
    for (const n of ['001-streamco-2026-01-04', '002-uber-2026-01-04', '003-streamco-2026-01-05', '004-uber-2026-01-05', '005-streamco-2026-01-06']) {
      writeFileSync(join(mergeTmp, 'reports', `${n}.md`), '# fixture\n');
    }
    // Two DISTINCT roles (long shared prefix / shared brand token) + one true repost (score bump).
    writeFileSync(join(additionsDir, '003-streamco.tsv'),
      '3\t2026-01-05\tStreamCo\tFull-Stack Engineer 5, AI Insights & Visualizations\tEvaluated\t4.6/5\t❌\t[3](reports/003-streamco-2026-01-05.md)\tdistinct role\n');
    writeFileSync(join(additionsDir, '004-uber.tsv'),
      '4\t2026-01-05\tUber\tSenior Software Engineer, UberEats Feed\tEvaluated\t4.1/5\t❌\t[4](reports/004-uber-2026-01-05.md)\tdistinct team (#751)\n');
    writeFileSync(join(additionsDir, '005-streamco.tsv'),
      '5\t2026-01-06\tStreamCo\tFull Stack Engineer 5, Ads Reporting\tEvaluated\t4.5/5\t❌\t[5](reports/005-streamco-2026-01-06.md)\trepost\n');

    const mergeResult = run(NODE, ['merge-tracker.mjs'], { env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: additionsDir } });
    if (mergeResult === null) {
      fail('merge-tracker.mjs crashed during fuzzy dedup regression test');
    } else {
      const merged = readFileSync(tracker, 'utf-8');

      // Distinct role sharing a long prefix must be ADDED, not folded into the existing row.
      if (merged.includes('AI Insights & Visualizations') && merged.includes('Ads Reporting')) {
        pass('distinct roles with shared prefix kept as separate rows');
      } else {
        fail('distinct role with shared prefix was merged away (silent data loss)');
      }

      // #751 repro: different teams under one brand token must both survive.
      if (merged.includes('UberEats Feed') && merged.includes('Consumer Fulfillment')) {
        pass('brand-token roles (#751: UberEats Feed vs Consumer Fulfillment) kept separate');
      } else {
        fail('brand-token roles were deduped (#751 regression)');
      }

      // True repost (identical role tokens) must still UPDATE in place — exactly one row, score bumped.
      const adsRows = merged.split('\n').filter(l => l.includes('Ads Reporting'));
      if (adsRows.length === 1 && adsRows[0].includes('4.5/5')) {
        pass('true repost still updates the existing row in place (4.4 → 4.5, no duplicate)');
      } else {
        fail(`repost handling broken: ${adsRows.length} 'Ads Reporting' rows, expected 1 updated to 4.5/5`);
      }
    }
  } finally {
    rmSync(mergeTmp, { recursive: true, force: true });
  }
} catch (e) {
  fail(`merge-tracker fuzzy dedup tests crashed: ${e.message}`);
}

// ── MERGE-TRACKER REQ-ID GUARD (#1524/#1427) ──────────────────────
// A same-title posting at the same company can still be a genuinely distinct
// req when the Notes column carries a req/job number — broaden the guard's
// regex beyond bare numeric IDs to catch `R_…`, `JR…`, hyphenated `REQ-…`,
// and `Posting ID …` forms actually seen in the wild.
console.log('\n🧪 Testing merge-tracker req-ID guard (#1524/#1427)...');
try {
  const reqTmp = mkdtempSync(join(tmpdir(), 'career-ops-merge-reqid-'));
  try {
    mkdirSync(join(reqTmp, 'data'));
    mkdirSync(join(reqTmp, 'reports'));
    const additionsDir = join(reqTmp, 'additions');
    mkdirSync(additionsDir);
    const tracker = join(reqTmp, 'data', 'applications.md');
    writeFileSync(tracker,
      '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
      '| 1 | 2026-01-04 | TD Bank | L&D Specialist | 4.0/5 | Evaluated | ❌ | [1](../reports/001-td-bank-2026-01-04.md) | Req R_1488728 |\n');
    for (const n of ['001-td-bank-2026-01-04', '002-td-bank-2026-01-05']) {
      writeFileSync(join(reqTmp, 'reports', `${n}.md`), '# fixture\n');
    }
    // Identical title, but a DIFFERENT underscore-prefixed req id — must NOT collapse (#1524's exact repro).
    writeFileSync(join(additionsDir, '002-td-bank.tsv'),
      '2\t2026-01-05\tTD Bank\tL&D Specialist\tEvaluated\t4.1/5\t❌\t[2](reports/002-td-bank-2026-01-05.md)\tReq R_1494379\n');

    const reqResult = run(NODE, ['merge-tracker.mjs'], { env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: additionsDir } });
    if (reqResult === null) {
      fail('merge-tracker.mjs crashed during req-ID guard regression test');
    } else {
      const merged = readFileSync(tracker, 'utf-8');
      const ldRows = merged.split('\n').filter(l => l.includes('L&D Specialist'));
      if (ldRows.length === 2 && merged.includes('R_1488728') && merged.includes('R_1494379')) {
        pass('distinct R_-prefixed req IDs at same title/company kept as separate rows (#1524)');
      } else {
        fail(`distinct req IDs were collapsed — expected 2 rows, got ${ldRows.length}: ${JSON.stringify(ldRows)}`);
      }
    }
  } finally {
    rmSync(reqTmp, { recursive: true, force: true });
  }
} catch (e) {
  fail(`merge-tracker req-ID guard test crashed: ${e.message}`);
}

// ── MERGE-TRACKER REPORT-NUMBER COLLISION (#912) ─────────────────
// The report-number dedup check was not company-guarded: a TSV for NewCo
// with report [1] would find the existing tracker row [1] for OtherCo and
// update it in-place instead of appending NewCo as a new row.
console.log('\n🧪 Testing merge-tracker report-number cross-company collision (#912)...');
try {
  const col912Tmp = mkdtempSync(join(tmpdir(), 'career-ops-merge-912-'));
  try {
    mkdirSync(join(col912Tmp, 'data'));
    mkdirSync(join(col912Tmp, 'reports'));
    const col912Additions = join(col912Tmp, 'additions');
    mkdirSync(col912Additions);

    const col912Tracker = join(col912Tmp, 'data', 'applications.md');
    writeFileSync(col912Tracker,
      '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
      '| 1 | 2026-01-01 | OtherCo | Staff Engineer | 4.0/5 | Evaluated | ❌ | [1](../reports/001-otherco-2026-01-01.md) | original |\n');
    writeFileSync(join(col912Tmp, 'reports', '001-otherco-2026-01-01.md'), '# fixture\n');
    writeFileSync(join(col912Tmp, 'reports', '001-newco-2026-01-05.md'), '# fixture\n');

    // NewCo TSV also carries report number [1] — cross-company collision
    writeFileSync(join(col912Additions, '001-newco.tsv'),
      '1\t2026-01-05\tNewCo\tNew Role\tEvaluated\t2.7/5\t❌\t[1](reports/001-newco-2026-01-05.md)\tcollision\n');

    const col912Result = run(NODE, ['merge-tracker.mjs'], {
      env: { ...process.env, CAREER_OPS_TRACKER: col912Tracker, CAREER_OPS_ADDITIONS: col912Additions },
    });
    if (col912Result === null) {
      fail('merge-tracker crashed during report-number collision test (#912)');
    } else {
      const col912Merged = readFileSync(col912Tracker, 'utf-8');
      const col912Rows = col912Merged.split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| #') && !l.startsWith('|---'));
      const expectedOtherCoRow = '| 1 | 2026-01-01 | OtherCo | Staff Engineer | 4.0/5 | Evaluated | ❌ | [1](../reports/001-otherco-2026-01-01.md) | original |';

      if (col912Rows.length === 2) {
        pass('report-number collision (#912): merged tracker has exactly 2 rows');
      } else {
        fail(`report-number collision (#912): expected 2 rows, got ${col912Rows.length}`);
      }

      if (col912Rows.some(r => r.trim() === expectedOtherCoRow.trim())) {
        pass('report-number collision (#912): existing OtherCo row left untouched (exact match)');
      } else {
        fail('report-number collision (#912): OtherCo row was overwritten by NewCo addition');
      }

      const expectedNewCoRow = '| 2 | 2026-01-05 | NewCo | New Role | 2.7/5 | Evaluated | ❌ | [1](../reports/001-newco-2026-01-05.md) | collision |';
      if (col912Rows.some(r => r.trim() === expectedNewCoRow.trim())) {
        pass('report-number collision (#912): NewCo appended as a new entry with correct data');
      } else {
        fail('report-number collision (#912): NewCo entry was swallowed or has incorrect data');
      }
    }
  } finally {
    rmSync(col912Tmp, { recursive: true, force: true });
  }
} catch (e) {
  fail(`merge-tracker report-number collision test crashed: ${e.message}`);
}

// ── MERGE-TRACKER CONCURRENT WRITES (#781 follow-up) ─────────────────────
// Report-number reservation is atomic now (#803), but tracker merges are a
// separate read/modify/write step. If two merge-tracker processes read the same
// old applications.md snapshot and then write back independently, one process
// can erase the row added by the other. This fixture gives each process a
// different additions dir and pauses the first process after it has read the
// tracker, making the old race deterministic.
console.log('\n🧪 Testing merge-tracker concurrent writes...');
try {
  const mergeTmp = mkdtempSync(join(tmpdir(), 'career-ops-merge-lock-'));
  /**
   * Spawn one isolated `merge-tracker.mjs` process against the temporary fixture.
   *
   * Each spawned process receives the same tracker path and lock path but a
   * different additions directory. Without serialization, both processes can
   * read the same old tracker and the later write can lose the other row. The
   * first worker also sends an IPC readiness message after reading the tracker
   * and before its test hold, which lets the test launch the second worker at
   * the exact old race point instead of relying on scheduler timing.
   *
   * @param {string} additionsDir - Directory containing this process's TSV row.
   * @param {number} [holdMs=0] - Optional post-read delay injected into the merge.
   * @returns {{ready: Promise<void>, result: Promise<{code:number|null,stdout:string,stderr:string}>}}
   * Worker readiness and final process result promises.
   */
  function spawnMerge(additionsDir, holdMs = 0) {
    let markReady;
    let readyMarked = false;
    const ready = new Promise(resolve => { markReady = resolve; });
    const result = new Promise(resolve => {
      const child = spawn(NODE, ['merge-tracker.mjs'], {
        cwd: ROOT,
        env: {
          ...process.env,
          CAREER_OPS_TRACKER: join(mergeTmp, 'data', 'applications.md'),
          CAREER_OPS_ADDITIONS: additionsDir,
          CAREER_OPS_TRACKER_LOCK: join(mergeTmp, 'career-ops-merge-tracker-fixture.lock'),
          CAREER_OPS_MERGE_HOLD_MS: String(holdMs),
          CAREER_OPS_MERGE_READY_IPC: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      let stdout = '';
      let stderr = '';
      const resolveReady = () => {
        if (readyMarked) return;
        readyMarked = true;
        markReady();
      };
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('message', msg => {
        if (msg?.type === 'merge-tracker-ready') resolveReady();
      });
      child.on('error', err => {
        resolveReady();
        resolve({ code: -1, stdout, stderr: String(err) });
      });
      child.on('close', code => {
        resolveReady();
        resolve({ code, stdout, stderr });
      });
    });
    return { ready, result };
  }

  /**
   * Fail fast when a worker never reaches the deterministic race checkpoint.
   *
   * A missing readiness signal would otherwise hang the test suite. Timing out
   * turns that broken test contract into a normal assertion failure with a clear
   * message.
   *
   * @param {Promise<void>} ready - Worker readiness promise.
   * @param {number} timeoutMs - Maximum milliseconds to wait.
   * @returns {Promise<void>} Resolves when ready arrives before the timeout.
   */
  function waitForReady(ready, timeoutMs) {
    return Promise.race([
      ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('merge worker did not signal readiness')), timeoutMs)),
    ]);
  }

  try {
    mkdirSync(join(mergeTmp, 'data'));
    mkdirSync(join(mergeTmp, 'reports'));
    const additionsA = join(mergeTmp, 'additions-a');
    const additionsB = join(mergeTmp, 'additions-b');
    mkdirSync(additionsA);
    mkdirSync(additionsB);

    writeFileSync(join(mergeTmp, 'data', 'applications.md'),
      '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|-------|--------|-----|--------|-------|\n');
    writeFileSync(join(mergeTmp, 'reports', '010-alpha-2026-01-07.md'), '# fixture\n');
    writeFileSync(join(mergeTmp, 'reports', '011-beta-2026-01-07.md'), '# fixture\n');
    writeFileSync(join(additionsA, '010-alpha.tsv'),
      '10\t2026-01-07\tAlpha\tPlatform Engineer\tEvaluated\t4.1/5\t❌\t[10](reports/010-alpha-2026-01-07.md)\tfirst concurrent merge\n');
    writeFileSync(join(additionsB, '011-beta.tsv'),
      '11\t2026-01-07\tBeta\tData Engineer\tEvaluated\t4.2/5\t❌\t[11](reports/011-beta-2026-01-07.md)\tsecond concurrent merge\n');

    const first = spawnMerge(additionsA, 350);
    await waitForReady(first.ready, 2_000);
    const second = spawnMerge(additionsB, 0);
    const [firstResult, secondResult] = await Promise.all([first.result, second.result]);

    if (firstResult.code === 0 && secondResult.code === 0) {
      pass('concurrent merge processes both exited successfully');
    } else {
      fail(`concurrent merge process failed: first=${firstResult.code} second=${secondResult.code} stderr=${firstResult.stderr || secondResult.stderr}`);
    }

    const merged = readFileSync(join(mergeTmp, 'data', 'applications.md'), 'utf-8');
    if (merged.includes('Alpha') && merged.includes('Beta')) {
      pass('concurrent tracker merges preserve rows from both processes');
    } else {
      fail(`concurrent tracker merge lost a row: ${merged}`);
    }
  } finally {
    rmSync(mergeTmp, { recursive: true, force: true });
  }
} catch (e) {
  fail(`merge-tracker concurrent write test crashed: ${e.message}`);
}

// ── 12. COLD-START TRIGGER ──────────────────────────────────────

console.log('\n12. Cold-start trigger (deterministic onboarding state)');

try {
  // Virgin env: none of the 4 user-layer prerequisites present → must onboard.
  const virgin = mkdtempSync(join(tmpdir(), 'co-cold-'));
  const v = JSON.parse(run(NODE, ['doctor.mjs', '--json', '--target', virgin]) || '{}');
  if (
    v.onboardingNeeded === true &&
    Array.isArray(v.missing) &&
    v.missing.length === 4 &&
    Array.isArray(v.warnings)
  ) {
    pass('Virgin env → onboarding triggered (4 prerequisites missing)');
  } else {
    fail(`Virgin env not flagged for onboarding: ${JSON.stringify(v)}`);
  }
  rmSync(virgin, { recursive: true, force: true });

  // Fully provisioned env: all 4 present → must NOT onboard.
  const ready = mkdtempSync(join(tmpdir(), 'co-ready-'));
  mkdirSync(join(ready, 'config'), { recursive: true });
  mkdirSync(join(ready, 'modes'), { recursive: true });
  for (const f of ['cv.md', 'config/profile.yml', 'modes/_profile.md', 'portals.yml']) {
    writeFileSync(join(ready, f), 'x');
  }
  const r = JSON.parse(run(NODE, ['doctor.mjs', '--json', '--target', ready]) || '{}');
  if (r.onboardingNeeded === false && Array.isArray(r.warnings)) {
    pass('Provisioned env → no onboarding');
  } else {
    fail(`Provisioned env falsely flagged for onboarding: ${JSON.stringify(r)}`);
  }
  rmSync(ready, { recursive: true, force: true });

  // CLAUDE.md may itself carry the onboarding text, or (this fork's
  // established convention, matching CODEX.md/OPENCODE.md) be a bare
  // `@AGENTS.md` import — resolve the import before checking content.
  let claudeDoc = readFile('CLAUDE.md');
  if (claudeDoc.trim().startsWith('@AGENTS.md')) claudeDoc = readFile('AGENTS.md');
  if (
    /node\s+doctor\.mjs\s+--json/.test(claudeDoc) &&
    /"warnings"\s*:\s*\[\.\.\.\]/.test(claudeDoc) &&
    !/Does\s+`cv\.md`\s+exist\?/i.test(claudeDoc)
  ) {
    pass('CLAUDE.md delegates onboarding state to doctor --json');
  } else {
    fail('CLAUDE.md still duplicates onboarding prerequisite checks');
  }
} catch (e) {
  fail(`Cold-start trigger test crashed: ${e.message}`);
}

// ── 15. TRACKER DERIVED INDEX (#918 phase 1) ────────────────────
// applications.md is the source of truth; applications.db is a derived index
// rebuilt from it. Round-trip md → db → md must be lossless for clean input
// (a hard condition from #918 before any phase-2 work), sync must DETECT
// corruption without ever modifying the markdown, and reads must never be
// stale.

console.log('\n15. Tracker derived index (sync/query/export round-trip)');

const sqliteAvailable = run(NODE, ['--no-warnings', '-e', "import('node:sqlite').then(()=>process.exit(0),()=>process.exit(1))"]) !== null;
if (!sqliteAvailable) {
  warn('node:sqlite unavailable (Node < 22.5) — tracker index tests skipped');
} else {
  try {
    const idxTmp = mkdtempSync(join(tmpdir(), 'career-ops-index-'));
    try {
      const md = join(idxTmp, 'applications.md');
      const env = { ...process.env, CAREER_OPS_TRACKER: md };
      const trackerRun = (args) => run(NODE, ['tracker.mjs', ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });

      // 1. Round trip: clean canonical input must export byte-identical.
      const clean =
        '# Applications Tracker\n\n' +
        '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
        '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
        '| 2 | 2026-01-05 | Beta | Designer | 4.0/5 | Applied | ✅ | [2](../reports/002-beta-2026-01-05.md) | second |\n' +
        '| 1 | 2026-01-04 | Acme | Engineer | 4.2/5 | Evaluated | ❌ | [1](../reports/001-acme-2026-01-04.md) | first |\n';
      writeFileSync(md, clean);
      if (trackerRun(['sync']) === null) {
        fail('tracker sync crashed on clean fixture');
      } else {
        const exported = trackerRun(['export']);
        if (exported === clean.trim()) {
          pass('round trip md → db → md is lossless on clean input');
        } else {
          fail('round trip is NOT lossless on clean input');
        }
        if (readFileSync(md, 'utf-8') === clean) {
          pass('sync/export never modify the source markdown');
        } else {
          fail('sync/export modified applications.md (source of truth violated)');
        }
      }

      // 2. Corruption is detected and normalized in the index ONLY.
      const corrupted = clean +
        '| 1 | 2026-01-06 | Gamma | PM | — | 3.5/5 | ❌ | 鈥? | drifted |\n'; // dup id + score in status + mojibake
      writeFileSync(md, corrupted);
      if (trackerRun(['sync', '--check']) === null) {
        pass('sync --check exits non-zero when corruption is present');
      } else {
        fail('sync --check did not flag corrupted fixture');
      }
      const queried = JSON.parse(trackerRun(['query', '--company', 'Gamma', '--json']) || '[]');
      if (queried.length === 1 && queried[0].status === 'Evaluated' && queried[0].score === '3.5/5' && queried[0].id === 3) {
        pass('corrupted row is normalized in the index (status/score/id repaired)');
      } else {
        fail(`corrupted row not normalized in index: ${JSON.stringify(queried)}`);
      }
      if (readFileSync(md, 'utf-8') === corrupted) {
        pass('corruption repair never touches the markdown itself');
      } else {
        fail('sync modified the corrupted markdown (must only diagnose)');
      }

      // 3. Staleness: query after an md edit must auto-resync (no stale reads).
      writeFileSync(md, clean +
        '| 3 | 2026-01-07 | Delta | Analyst | 4.5/5 | Applied | ✅ | [3](../reports/003-delta-2026-01-07.md) | new |\n');
      const fresh = JSON.parse(trackerRun(['query', '--company', 'Delta', '--json']) || '[]');
      if (fresh.length === 1) {
        pass('query auto-resyncs when applications.md changed since last sync');
      } else {
        fail('query served a stale index after the markdown changed');
      }

      // 4. Status transitions across syncs accumulate in status_events.
      writeFileSync(md, readFileSync(md, 'utf-8').replace('| 4.0/5 | Applied |', '| 4.0/5 | Interview |'));
      const log = trackerRun(['history', '--id', '2']);
      if (log && log.includes('Applied') && log.includes('Interview')) {
        pass('history records the Applied → Interview transition across syncs');
      } else {
        fail(`history missing status transition: ${log}`);
      }
    } finally {
      rmSync(idxTmp, { recursive: true, force: true });
    }
  } catch (e) {
    fail(`tracker derived-index tests crashed: ${e.message}`);
  }
}

// ── 12b. PLAYWRIGHT MCP DETECTION WARNING (#522) ────────────────

console.log('\n12b. Playwright MCP detection warning');

try {
  const doctorScript = readFile('doctor.mjs');
  if (
    !/Claude Code config/i.test(doctorScript) &&
    /project-level MCP config/i.test(doctorScript) &&
    /\.mcp\.json/.test(doctorScript) &&
    /\.claude\/settings\.json/.test(doctorScript) &&
    /\.claude\/settings\.local\.json/.test(doctorScript)
  ) {
    pass('doctor Playwright MCP guidance is agent-neutral and keeps conservative config detection');
  } else {
    fail('doctor Playwright MCP guidance is still Claude-specific or lost config detection');
  }

  // doctor also accepts a Playwright MCP server provided by an installed Claude
  // Code plugin, which lives in the user's config dir rather than the --target
  // project (#2752). Pin CLAUDE_CONFIG_DIR at an empty dir so these assertions
  // describe the fixture and not whichever plugins the developer happens to
  // have enabled; without it "no MCP config" is false on a real machine and the
  // warning assertion below fails. Same reasoning as the GIT_CONFIG_* pinning
  // in section 12c.
  const emptyClaudeCfg = mkdtempSync(join(tmpdir(), 'co-emptycfg-'));
  const doctorEnv = { env: { ...process.env, CLAUDE_CONFIG_DIR: emptyClaudeCfg } };

  // No project MCP config → doctor surfaces a (non-fatal) warning instead of
  // letting SPA job boards fail silently. doctor reads project MCP config from
  // its launch directory, not --target, so this runs from the empty fixture:
  // run()'s default cwd is the checkout, whose own .mcp.json would answer.
  const noMcp = mkdtempSync(join(tmpdir(), 'co-nomcp-'));
  const a = JSON.parse(run(NODE, [join(ROOT, 'doctor.mjs'), '--json', '--target', noMcp], { ...doctorEnv, cwd: noMcp }) || '{}');
  if (Array.isArray(a.warnings) && a.warnings.some((w) => /playwright mcp/i.test(w))) {
    pass('No Playwright MCP config → warning surfaced');
  } else {
    fail(`Expected a Playwright MCP warning, got: ${JSON.stringify(a.warnings)}`);
  }
  rmSync(noMcp, { recursive: true, force: true });

  // A project that registers a Playwright MCP server → no warning.
  const withMcp = mkdtempSync(join(tmpdir(), 'co-mcp-'));
  mkdirSync(join(withMcp, '.claude'), { recursive: true });
  writeFileSync(
    join(withMcp, '.claude', 'settings.json'),
    JSON.stringify({ mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp', '--headless'] } } }),
  );
  const b = JSON.parse(execFileSync(
    NODE,
    [join(ROOT, 'doctor.mjs'), '--json', '--target', withMcp],
    { ...doctorEnv, cwd: withMcp, encoding: 'utf8' },
  ) || '{}');
  if (Array.isArray(b.warnings) && !b.warnings.some((w) => /playwright mcp/i.test(w))) {
    pass('Playwright MCP configured → no warning');
  } else {
    fail(`Did not expect a Playwright MCP warning, got: ${JSON.stringify(b.warnings)}`);
  }
  rmSync(withMcp, { recursive: true, force: true });

  // Local Claude settings should also count as a valid MCP registration.
  const withLocalMcp = mkdtempSync(join(tmpdir(), 'co-local-mcp-'));
  mkdirSync(join(withLocalMcp, '.claude'), { recursive: true });
  writeFileSync(
    join(withLocalMcp, '.claude', 'settings.local.json'),
    JSON.stringify({ mcpServers: { browser: { command: 'npx', args: ['@playwright/mcp'] } } }),
  );
  const c = JSON.parse(execFileSync(
    NODE,
    [join(ROOT, 'doctor.mjs'), '--json', '--target', withLocalMcp],
    { ...doctorEnv, cwd: withLocalMcp, encoding: 'utf8' },
  ) || '{}');
  if (Array.isArray(c.warnings) && !c.warnings.some((w) => /playwright mcp/i.test(w))) {
    pass('Playwright MCP configured via .claude/settings.local.json → no warning');
  } else {
    fail(`Did not expect a Playwright MCP warning for settings.local.json, got: ${JSON.stringify(c.warnings)}`);
  }
  rmSync(withLocalMcp, { recursive: true, force: true });
  rmSync(emptyClaudeCfg, { recursive: true, force: true });
} catch (e) {
  fail(`Playwright MCP detection test crashed: ${e.message}`);
}

// ── 15. PROVIDERS — SolidJobs ─────────────────────────────────────

console.log('\n15. URL rediscovery fallback');

try {
  const { extractCareersUrlDomain, pickRediscoveredUrl } = await import(
    pathToFileURL(join(ROOT, 'scan.mjs')).href
  );

  // extractCareersUrlDomain — pure hostname extraction, null on missing/invalid
  if (extractCareersUrlDomain('https://job-boards.greenhouse.io/anthropic') === 'job-boards.greenhouse.io') {
    pass('extractCareersUrlDomain pulls hostname from a careers URL');
  } else {
    fail('extractCareersUrlDomain failed on a valid URL');
  }
  if (extractCareersUrlDomain(null) === null) {
    pass('extractCareersUrlDomain returns null for missing careers_url');
  } else {
    fail('extractCareersUrlDomain did not return null for null input');
  }
  if (extractCareersUrlDomain('not-a-url') === null) {
    pass('extractCareersUrlDomain returns null for an unparseable URL');
  } else {
    fail('extractCareersUrlDomain did not return null for a bad URL');
  }

  // pickRediscoveredUrl — first search hit whose hostname exactly matches domain
  const domain = 'job-boards.greenhouse.io';
  const hrefs = [
    'https://duckduckgo.com/l/?uddg=ad',          // search-engine chrome / noise
    'https://other-board.lever.co/acme/123',      // wrong domain
    'https://job-boards.greenhouse.io/acme/456',  // first real match
    'https://job-boards.greenhouse.io/acme/789',  // later match
  ];
  if (pickRediscoveredUrl(hrefs, domain) === 'https://job-boards.greenhouse.io/acme/456') {
    pass('pickRediscoveredUrl returns the first same-domain result');
  } else {
    fail(`pickRediscoveredUrl picked the wrong URL: ${pickRediscoveredUrl(hrefs, domain)}`);
  }
  if (pickRediscoveredUrl(['https://elsewhere.com/x'], domain) === null) {
    pass('pickRediscoveredUrl returns null when no result matches the domain');
  } else {
    fail('pickRediscoveredUrl did not return null for no domain match');
  }
  if (pickRediscoveredUrl([], domain) === null) {
    pass('pickRediscoveredUrl returns null for an empty result set');
  } else {
    fail('pickRediscoveredUrl did not return null for empty input');
  }
  // Redirect unwrapping is restricted to real DuckDuckGo hosts: a look-alike
  // host must not get its uddg target unwrapped (and its own hostname does not
  // match the careers domain, so the result is null).
  const lookAlike = `https://evil-duckduckgo.com/l/?uddg=${encodeURIComponent('https://job-boards.greenhouse.io/acme/456')}`;
  if (pickRediscoveredUrl([lookAlike], domain) === null) {
    pass('pickRediscoveredUrl ignores uddg redirects from look-alike hosts');
  } else {
    fail('pickRediscoveredUrl unwrapped a redirect from a look-alike host');
  }
  // DuckDuckGo HTML wraps each result in a /l/?uddg= redirect — must be
  // unwrapped, otherwise every hostname looks like duckduckgo.com and nothing
  // ever matches the careers domain (the fallback would silently never fire).
  const ddg = ['//duckduckgo.com/l/?uddg=' + encodeURIComponent('https://job-boards.greenhouse.io/acme/999')];
  if (pickRediscoveredUrl(ddg, domain) === 'https://job-boards.greenhouse.io/acme/999') {
    pass('pickRediscoveredUrl unwraps DuckDuckGo redirect links');
  } else {
    fail(`pickRediscoveredUrl did not unwrap DDG redirect: ${pickRediscoveredUrl(ddg, domain)}`);
  }
  // A look-alike host that merely contains the domain as a substring must not match.
  if (pickRediscoveredUrl(['https://job-boards.greenhouse.io.attacker.com/x'], domain) === null) {
    pass('pickRediscoveredUrl rejects look-alike hostnames');
  } else {
    fail('pickRediscoveredUrl accepted a look-alike hostname');
  }
} catch (e) {
  fail(`URL rediscovery tests crashed: ${e.message}`);
}

// ── 13. BATCH RATE-LIMIT PAUSE ──────────────────────────────────

console.log('\n13. Batch rate-limit pause');

try {
  const tmp = mkdtempSync(join(tmpdir(), 'co-batch-rate-'));
  const batchDir = join(tmp, 'batch');
  const fakeBin = join(tmp, 'bin');
  mkdirSync(batchDir, { recursive: true });
  mkdirSync(join(tmp, 'reports'), { recursive: true });
  mkdirSync(join(tmp, 'data'), { recursive: true });
  mkdirSync(fakeBin, { recursive: true });

  writeFileSync(join(batchDir, 'batch-runner.sh'), readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n'));
  if (process.platform === 'win32') {
    try { execFileSync('bash', ['-c', 'chmod +x batch/batch-runner.sh'], { cwd: tmp }); } catch {}
  } else {
    execFileSync('chmod', ['+x', join(batchDir, 'batch-runner.sh')]);
  }
  writeFileSync(join(tmp, 'merge-tracker.mjs'), 'console.log("merge fixture");\n');
  writeFileSync(join(tmp, 'verify-pipeline.mjs'), 'console.log("verify fixture");\n');
  // The runner stops an offer whose report-number reservation returns nothing,
  // so the fixture has to hand out a number for the worker to be launched.
  writeFileSync(join(tmp, 'reserve-report-num.mjs'), 'console.log("001");\n');
  writeFileSync(join(batchDir, 'batch-prompt.md'), 'URL={{URL}}\nJD={{JD_FILE}}\nREPORT={{REPORT_NUM}}\n');
  writeFileSync(join(batchDir, 'batch-input.tsv'), [
    'id\turl\tsource\tnotes',
    '1\thttps://example.com/one\tfixture\t-',
    '2\thttps://example.com/two\tfixture\t-',
    '3\thttps://example.com/three\tfixture\t-',
  ].join('\n') + '\n');
  writeFileSync(join(fakeBin, 'claude'), [
    '#!/usr/bin/env bash',
    'echo "You\\x27ve hit your session limit · resets 12:30pm (Asia/Taipei)"',
    'exit 1',
  ].join('\n') + '\n');
  // The runner prefetches JDs with curl. Keep this offline fixture deterministic
  // and exercise the WebFetch fallback instead of waiting on a public request.
  writeFileSync(join(fakeBin, 'curl'), '#!/usr/bin/env bash\nexit 1\n');
  if (process.platform === 'win32') {
    try { execFileSync('bash', ['-c', 'chmod +x bin/claude bin/curl'], { cwd: tmp }); } catch {}
  } else {
    execFileSync('chmod', ['+x', join(fakeBin, 'claude'), join(fakeBin, 'curl')]);
  }

  const env = { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH}` };
  const out = run('bash', [toBashPath(join(batchDir, 'batch-runner.sh')), '--parallel', '1', '--max-retries', '3', '--rate-limit-sleep', '0'], {
    cwd: tmp,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) || '';
  const state = readFileSync(join(batchDir, 'batch-state.tsv'), 'utf-8').trim().split('\n');
  const first = state[1]?.split('\t') || [];

  if (state.length === 2 && first[0] === '1' && first[2] === 'paused_rate_limit' && first[8] === '0' && out.includes('pausing batch')) {
    pass('session-limit pauses batch without consuming retry budget or scheduling more jobs');
  } else {
    fail(`session-limit pause wrong: lines=${state.length}, first=${JSON.stringify(first)}, out=${JSON.stringify(out.slice(-240))}`);
  }

  writeFileSync(join(batchDir, 'batch-state.tsv'), [
    'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries',
    '1\thttps://example.com/one\tpaused_rate_limit\t2026-01-01T00:00:00Z\t2026-01-01T00:00:01Z\t001\t-\tsession-limit; paused\t0',
    '2\thttps://example.com/two\tfailed\t2026-01-01T00:00:00Z\t2026-01-01T00:00:01Z\t002\t-\tworker-crash\t1',
  ].join('\n') + '\n');
  const dry = run('bash', [toBashPath(join(batchDir, 'batch-runner.sh')), '--resume-paused', '--dry-run'], {
    cwd: tmp,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) || '';
  if (dry.includes('#1: https://example.com/one') && !dry.includes('#2: https://example.com/two')) {
    pass('--resume-paused dry-run selects paused jobs only');
  } else {
    fail(`--resume-paused selection wrong: ${dry}`);
  }

  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
} catch (e) {
  fail(`Batch rate-limit pause test crashed: ${e.message}`);
}

// ── 15. BATCH RUNNER MCP ISOLATION (#506) ───────────────────────

console.log('\n15. Batch runner MCP isolation');

try {
  const batchRunner = readFileSync(join(ROOT, 'batch', 'batch-runner.sh'), 'utf-8');
  // Workers must be spawned with --strict-mcp-config so they don't inherit the
  // parent session's MCP servers (e.g. Playwright) and deadlock fighting over a
  // single browser when --parallel > 1 (issue #506).
  const claudeArgsLine = batchRunner
    .split('\n')
    .find(l => l.includes('claude_args=('));
  if (claudeArgsLine && claudeArgsLine.includes('--strict-mcp-config')) {
    pass('batch workers spawn with --strict-mcp-config (no inherited MCP)');
  } else {
    fail('batch-runner.sh worker spawn missing --strict-mcp-config (issue #506 regression)');
  }
} catch (e) {
  fail(`Batch runner MCP isolation test crashed: ${e.message}`);
}

// ── 17. COVER LETTER GREETING BLOCK ─────────────────────────────

console.log('\n17. Cover letter greeting block');

try {
  const { buildHtml } = await import(pathToFileURL(join(ROOT, 'generate-cover-letter.mjs')).href);

  const basePayload = {
    candidate: { name: 'Jane Doe' },
    letter: {
      role_title: 'Head of Applied AI',
      opening: 'OPENING_MARKER sentence.',
      profile_intro: 'Profile intro.',
    },
  };

  // (a) greeting present → renders <p class="greeting"> above the opening
  const withGreeting = buildHtml({
    ...basePayload,
    letter: { ...basePayload.letter, greeting: 'Dear Hiring Manager,' },
  });
  const greetingTag = '<p class="greeting">Dear Hiring Manager,</p>';
  const greetingIdx = withGreeting.indexOf(greetingTag);
  const openingIdx = withGreeting.indexOf('OPENING_MARKER');
  if (greetingIdx !== -1 && openingIdx !== -1 && greetingIdx < openingIdx) {
    pass('Greeting renders as <p class="greeting"> above the opening');
  } else {
    fail(`Greeting block missing or misordered (greeting=${greetingIdx}, opening=${openingIdx})`);
  }

  // greeting text is HTML-escaped
  const escaped = buildHtml({
    ...basePayload,
    letter: { ...basePayload.letter, greeting: 'Dear <O\'Brien> & "Co",' },
  });
  if (escaped.includes('Dear &lt;O&#39;Brien&gt; &amp; &quot;Co&quot;,') && !escaped.includes('Dear <O\'Brien>')) {
    pass('Greeting text is HTML-escaped');
  } else {
    fail('Greeting text was not HTML-escaped');
  }

  // (b) greeting omitted → no salutation, no leftover token (backward compatible)
  const withoutGreeting = buildHtml(basePayload);
  if (!withoutGreeting.includes('class="greeting"')
      && !withoutGreeting.includes('{{GREETING_BLOCK}}')
      && withoutGreeting.includes('OPENING_MARKER')) {
    pass('Omitted greeting leaves no salutation and no leftover token (backward compatible)');
  } else {
    fail('Omitted greeting did not render cleanly (stray greeting markup or unreplaced token)');
  }
} catch (e) {
  fail(`Cover letter greeting test crashed: ${e.message}`);
}

// ── 18. COVER LETTER SINGLE-PASS SUBSTITUTION ───────────────────

console.log('\n18. Cover letter single-pass substitution');

try {
  const { buildHtml } = await import(pathToFileURL(join(ROOT, 'generate-cover-letter.mjs')).href);

  // A field value that itself contains literal {{TOKEN}} sequences must NOT be
  // re-substituted. The old iterative split/join loop would have blanked these
  // (no footnotes/closing in the payload → replaced with ""). Single-pass leaves
  // them verbatim because replacement output is never re-scanned.
  const injected = buildHtml({
    candidate: { name: 'Jane Doe' },
    letter: {
      role_title: 'Engineer',
      opening: 'See {{FOOTNOTES_BLOCK}} and {{CLOSING_BLOCK}} markers.',
      profile_intro: 'Intro.',
    },
  });

  if (injected.includes('See {{FOOTNOTES_BLOCK}} and {{CLOSING_BLOCK}} markers.')) {
    pass('Field values containing {{TOKEN}} are left literal (single-pass, not re-substituted)');
  } else {
    fail('A field value containing {{TOKEN}} was re-substituted');
  }

  // Known template tokens still resolve, and no unreplaced tokens leak through.
  if (injected.includes('Jane Doe') && !injected.includes('{{NAME}}') && !injected.includes('{{ROLE_TITLE}}')) {
    pass('Known template tokens still substitute under single-pass');
  } else {
    fail('Single-pass substitution left a known token unreplaced');
  }
} catch (e) {
  fail(`Cover letter single-pass substitution test crashed: ${e.message}`);
}

// ── 19. FONT INLINING (#951) ────────────────────────────────────

console.log('\n19. Font inlining (data: URLs, #951)');

try {
  // Importing must not trigger the CLI (the import.meta.url guard); it
  // exposes inlineLocalFonts, which renderHtmlToPdf runs before setContent.
  const { inlineLocalFonts } = await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);

  // Chromium blocks file:// subresources from setContent() pages (the page
  // stays at about:blank), so ./fonts refs must become data: URLs (#951).
  const fontFile = readdirSync(join(ROOT, 'fonts')).find(f => f.endsWith('.woff2'));
  const inlined = await inlineLocalFonts(
    `<style>@font-face { src: url('./fonts/${fontFile}') format('woff2'); }</style>`
  );
  if (inlined.includes('data:font/woff2;base64,') && !inlined.includes('./fonts/')) {
    pass('local ./fonts references are inlined as data: URLs');
  } else {
    fail('./fonts reference was not inlined as a data: URL — fonts will silently fall back (#951)');
  }

  // A missing font file must not corrupt the HTML or throw.
  const missing = await inlineLocalFonts(`<style>src: url('./fonts/does-not-exist.woff2');</style>`);
  if (missing.includes(`url('./fonts/does-not-exist.woff2')`)) {
    pass('missing font files keep their original reference');
  } else {
    fail('missing font file mangled the url() reference');
  }

  // Traversal outside fonts/ must never be inlined — neither via ".."
  // segments nor via absolute names (resolve() returns those verbatim).
  const traversal = await inlineLocalFonts(`<style>src: url('./fonts/../cv.md');</style>`);
  if (traversal.includes(`url('./fonts/../cv.md')`)) {
    pass('path traversal outside fonts/ is not inlined');
  } else {
    fail('path traversal escaped the fonts/ directory');
  }
  const absolute = await inlineLocalFonts(`<style>src: url('./fonts//etc/passwd');</style>`);
  if (absolute.includes(`url('./fonts//etc/passwd')`)) {
    pass('absolute-path escape (./fonts//etc/passwd) is not inlined');
  } else {
    fail('absolute-path reference escaped the fonts/ directory');
  }
} catch (e) {
  fail(`font inlining test crashed: ${e.message}`);
}

// ── 20. LATEX VALIDATOR I18N ────────────────────────────────────

console.log('\n20. LaTeX validator i18n (localized sections + CJK guard)');

// Run generate-latex.mjs and return its JSON report, capturing stdout even
// when it exits non-zero (validation issues exit 1 but still print the report).
function latexValidate(tex) {
  const dir = mkdtempSync(join(tmpdir(), 'latex-i18n-'));
  const texPath = join(dir, 'cv.tex');
  writeFileSync(texPath, tex, 'utf-8');
  let out;
  try {
    out = execFileSync(NODE, ['generate-latex.mjs', texPath], { cwd: ROOT, encoding: 'utf-8', timeout: 30000 });
  } catch (e) {
    out = (e.stdout || '').toString();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  try { return JSON.parse(out); } catch { return null; }
}

const baseTex = (sectionTitle) => `\\documentclass{article}
\\pdfgentounicode=1
\\begin{document}
\\section{${sectionTitle}}
\\section{Experiencia}
\\section{Proyectos}
\\section{Habilidades}
\\resumeSubheading
\\resumeItem
\\resumeProjectHeading
\\end{document}
`;

try {
  // Localized (Spanish) section titles must not trigger a "Missing section".
  const localized = latexValidate(baseTex('Educación'));
  if (localized && !localized.issues.some((i) => /section/i.test(i))) {
    pass('localized section titles validate (no spurious "Missing section")');
  } else {
    fail(`localized section titles wrongly flagged: ${JSON.stringify(localized && localized.issues)}`);
  }

  // Too few sections must still be flagged.
  const tooFew = latexValidate(`\\documentclass{article}
\\pdfgentounicode=1
\\begin{document}
\\section{Education}
\\resumeSubheading
\\resumeItem
\\resumeProjectHeading
\\end{document}
`);
  if (tooFew && tooFew.issues.some((i) => /at least 4/i.test(i))) {
    pass('fewer than 4 sections is still flagged');
  } else {
    fail('section-count check did not flag a CV with too few sections');
  }

  // CJK content must be rejected with actionable guidance.
  const cjk = latexValidate(baseTex('職務経歴'));
  if (cjk && cjk.issues.some((i) => /CJK/.test(i)) && cjk.valid === false) {
    pass('CJK content is rejected with guidance to use pdf mode');
  } else {
    fail(`CJK content was not rejected with guidance: ${JSON.stringify(cjk && cjk.issues)}`);
  }
} catch (e) {
  fail(`LaTeX validator i18n test crashed: ${e.message}`);
}

// ── 21. CJK CV RENDERING (Japanese + Simplified Chinese) ─────────

console.log('\n21. CJK CV rendering (lang="ja" font fallback)');

try {
  // The bundled webfonts are Latin-only, so a Japanese CV (html lang="ja")
  // needs a CJK system-font fallback or it renders as tofu (□) in headless
  // Chromium. This mirrors the existing lang="ar" handling.
  const template = readFileSync(join(ROOT, 'templates', 'cv-template.html'), 'utf-8');

  if (/html\[lang="ja"\]\s+body/.test(template)) {
    pass('cv-template.html has a lang="ja" body rule for CJK text');
  } else {
    fail('cv-template.html is missing a lang="ja" font fallback — Japanese CVs render as tofu (□)');
  }

  // The fallback must name a real CJK font family, not just rely on sans-serif
  // (the generic sans-serif has no CJK glyphs on minimal/CI environments).
  const cjkFonts = ['Hiragino Sans', 'Yu Gothic', 'Noto Sans CJK JP', 'Noto Sans JP', 'Meiryo', 'MS PGothic'];
  const jaBlock = template.slice(template.indexOf('html[lang="ja"]'));
  if (cjkFonts.some((f) => jaBlock.includes(f))) {
    pass('lang="ja" rules name a concrete CJK font family');
  } else {
    fail('lang="ja" rules do not name any CJK font family — CJK fallback will not work');
  }

  for (const templateName of ['cv-template.html', 'resume-template.html']) {
    const zhTemplate = readFileSync(join(ROOT, 'templates', templateName), 'utf-8');
    const zhStart = zhTemplate.indexOf('html[lang="zh-CN"] body');
    const zhBlock = zhStart >= 0 ? zhTemplate.slice(zhStart) : '';
    const zhFonts = ['PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC'];

    if (zhStart >= 0 && zhFonts.some((font) => zhBlock.includes(font))) {
      pass(`${templateName} has concrete zh-CN font fallbacks`);
    } else {
      fail(`${templateName} is missing concrete zh-CN font fallbacks`);
    }

    if (/line-break:\s*strict/.test(zhBlock) && /overflow-wrap:\s*break-word/.test(zhBlock)) {
      pass(`${templateName} applies strict Chinese line breaking without clipping long mixed tokens`);
    } else {
      fail(`${templateName} is missing zh-CN line-breaking safeguards`);
    }

    if (/html\[lang="zh-CN"\]\s+\.contact-row/.test(zhBlock)) {
      pass(`${templateName} applies an explicit zh-CN fallback to contact details`);
    } else {
      fail(`${templateName} is missing an explicit zh-CN contact-row fallback`);
    }
  }

  const resumeHtml = readFileSync(join(ROOT, 'templates', 'resume-template.html'), 'utf-8');
  const resumeZhBlock = resumeHtml.slice(resumeHtml.indexOf('html[lang="zh-CN"] body'));
  const headingGroup = resumeZhBlock.slice(resumeZhBlock.indexOf('html[lang="zh-CN"] .header h1'), resumeZhBlock.indexOf('html[lang="zh-CN"] .summary-text'));
  if (!/\.competency-tag|\.skill-category/.test(headingGroup)) {
    pass('resume-template.html keeps competency and skill labels out of the zh-CN heading-font group');
  } else {
    fail('resume-template.html assigns competency or skill labels to the zh-CN heading font');
  }
} catch (e) {
  fail(`CJK rendering test crashed: ${e.message}`);
}

// ── 21b. CV PHOTO STYLE (rounded/circle/square framing, #1991) ──

console.log('\n21b. CV photo style framing');

try {
  for (const name of ['cv-template.html', 'resume-template.html']) {
    const html = readFileSync(join(ROOT, 'templates', name), 'utf-8');
    if (/\.cv-photo--square\s*\{[^}]*aspect-ratio:\s*1;[^}]*height:\s*80px;/s.test(html)) {
      pass(`${name} square photo style enforces equal dimensions`);
    } else {
      fail(`${name} is missing the square cv-photo aspect-ratio rule`);
    }
    if (html.includes('.cv-photo--rounded') && html.includes('.cv-photo--circle')) {
      pass(`${name} defines rounded and circle photo styles`);
    } else {
      fail(`${name} is missing rounded/circle cv-photo style rules`);
    }
  }
} catch (e) {
  fail(`CV photo style test crashed: ${e.message}`);
}

// ── 22. PROVIDERS — Jobstreet ──────────────────────────────────────

console.log('\n30. Plugin manifest path containment (symlink traversal)');

try {
  const { validateManifest } = await import(pathToFileURL(join(ROOT, 'plugins/_engine.mjs')).href);

  const base = { id: 'x', apiVersion: 1, description: 'one line', hooks: ['ingest'], requiredEnv: [], allowedHosts: [], humanInTheLoop: true };
  const tmp = mkdtempSync(join(tmpdir(), 'co-plugin-manifest-'));
  const pluginDir = join(tmp, 'x');
  mkdirSync(pluginDir, { recursive: true });
  const vm = (m) => validateManifest(m, pluginDir, 'x');

  writeFileSync(join(pluginDir, 'index.mjs'), 'export default {};');
  if (vm(base) !== null) pass('a well-formed manifest with a real entry file is accepted');
  else fail('a well-formed manifest should be accepted');

  // Literal ../ traversal (no symlink involved) — already guarded pre-existing.
  if (vm({ ...base, entry: '../../scan.mjs' }) === null) pass('entry escaping the plugin directory via literal .. is rejected');
  else fail('literal .. entry traversal should be rejected');

  // Symlink traversal — a symlink INSIDE the plugin dir pointing to a real file
  // OUTSIDE it. A naive startsWith() on the unresolved path would accept this
  // (the symlink's own path textually starts with the plugin dir); isContainedIn
  // must resolve both sides with realpathSync first and reject it.
  writeFileSync(join(tmp, 'outside.mjs'), 'export default {};');
  writeFileSync(join(tmp, 'outside.md'), '# outside\n');
  mkdirSync(join(tmp, 'outside-dir'), { recursive: true });
  try {
    symlinkSync(join(tmp, 'outside.mjs'), join(pluginDir, 'linked-entry.mjs'));
    symlinkSync(join(tmp, 'outside.md'), join(pluginDir, 'linked-skill.md'));
    symlinkSync(join(tmp, 'outside-dir'), join(pluginDir, 'linked-dir'), 'dir');

    if (vm({ ...base, entry: 'linked-entry.mjs' }) === null) pass('an entry symlink escaping the plugin directory is rejected');
    else fail('entry symlink traversal should be rejected');

    if (vm({ ...base, skill: 'linked-skill.md' }) === null) pass('a skill symlink escaping the plugin directory is rejected');
    else fail('skill symlink traversal should be rejected');

    if (vm({ ...base, entry: 'linked-dir/missing-entry.mjs' }) === null) pass('a missing entry under an escaping symlink directory is rejected');
    else fail('a missing entry under symlink traversal should be rejected');
  } catch (e) {
    warn(`symlink traversal test skipped (platform/filesystem does not support symlinks): ${e.message}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
} catch (e) {
  fail(`plugin manifest path-containment tests crashed: ${e.message}`);
}

console.log('\n30b. Plugin registry split (#1401)');
try {
  const { loadRegistry, loadRegistryFiles, successorFor } = await import(pathToFileURL(join(ROOT, 'plugins/_registry.mjs')).href);
  const { discoverPlugins, resolveSuccessorIds } = await import(pathToFileURL(join(ROOT, 'plugins/_engine.mjs')).href);
  const { validateRegistry } = await import(pathToFileURL(join(ROOT, 'validate-plugin-registry.mjs')).href);

  // Real registry: per-plugin files load, each filename matches its own id, shape is valid.
  const realFiles = loadRegistryFiles(ROOT);
  if (realFiles.length >= 8 && realFiles.every(({ file, entry }) => entry?.id && `${entry.id}.json` === file)) {
    pass('loadRegistryFiles reads plugins-registry/*.json with filename === "<id>.json"');
  } else {
    fail(`loadRegistryFiles mismatch: ${JSON.stringify(realFiles.map(f => f.file))}`);
  }
  const realProblems = validateRegistry(ROOT);
  if (realProblems.length === 0) {
    pass('validateRegistry finds no problems in the real plugins-registry/');
  } else {
    fail(`validateRegistry found problems in the real registry: ${realProblems.join('; ')}`);
  }

  // Sandboxed fixture: a bundled "greeter" plugin + a registry entry declaring
  // a supersedesBundled successor, to exercise resolveSuccessorIds/discoverPlugins
  // end-to-end without touching the real plugins/ or plugins-registry/.
  const fixTmp = mkdtempSync(join(tmpdir(), 'career-ops-plugin-registry-'));
  try {
    const bundledDir = join(fixTmp, 'plugins', 'greeter');
    mkdirSync(bundledDir, { recursive: true });
    writeFileSync(join(bundledDir, 'manifest.json'), JSON.stringify({
      id: 'greeter', apiVersion: 1, description: 'bundled reference', hooks: ['export'],
      requiredEnv: [], optionalEnv: [], allowedHosts: [], entry: 'index.mjs', humanInTheLoop: true,
    }));
    writeFileSync(join(bundledDir, 'index.mjs'), 'export default {};\n');

    const localDir = join(fixTmp, 'plugins.local', 'greeter');
    mkdirSync(localDir, { recursive: true });
    writeFileSync(join(localDir, 'manifest.json'), JSON.stringify({
      id: 'greeter', apiVersion: 1, description: 'community successor', hooks: ['export'],
      requiredEnv: [], optionalEnv: [], allowedHosts: [], entry: 'index.mjs', humanInTheLoop: true,
    }));
    writeFileSync(join(localDir, 'index.mjs'), 'export default {};\n');

    const registryDir = join(fixTmp, 'plugins-registry');
    mkdirSync(registryDir, { recursive: true });
    const sha = 'a'.repeat(40);
    writeFileSync(join(registryDir, 'greeter.json'), JSON.stringify({
      id: 'greeter', name: 'career-ops-plugin-greeter', version: '0.1.0', license: 'MIT',
      description: 'community successor', repo: 'https://github.com/example/career-ops-plugin-greeter',
      sha, hooks: ['export'], requiredEnv: [], allowedHosts: [], supersedesBundled: true,
    }));

    const lockDir = join(fixTmp, '.career-ops');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(fixTmp, 'plugins.lock'), JSON.stringify({ plugins: { greeter: { sha } } }));

    if (successorFor(fixTmp, 'greeter')?.sha === sha) {
      pass('successorFor finds the registry entry declaring supersedesBundled for the bundled id');
    } else {
      fail('successorFor should find the greeter successor entry');
    }

    const overridden = resolveSuccessorIds(fixTmp);
    if (overridden.has('greeter')) {
      pass('resolveSuccessorIds approves the successor: installed + sha matches the pinned registry sha');
    } else {
      fail('resolveSuccessorIds should approve greeter (installed at the exact pinned sha)');
    }

    const manifests = discoverPlugins([join(fixTmp, 'plugins'), join(fixTmp, 'plugins.local')], overridden);
    const greeter = manifests.find(m => m.id === 'greeter');
    if (greeter?.description === 'community successor') {
      pass('discoverPlugins lets an approved successor override the bundled reference');
    } else {
      fail(`discoverPlugins should have returned the local successor manifest, got: ${JSON.stringify(greeter)}`);
    }

    // Without an approved override, first-root-wins still holds (no regression).
    const noOverride = discoverPlugins([join(fixTmp, 'plugins'), join(fixTmp, 'plugins.local')]);
    const greeterDefault = noOverride.find(m => m.id === 'greeter');
    if (greeterDefault?.description === 'bundled reference') {
      pass('discoverPlugins defaults to bundled-wins when no overrideIds are passed');
    } else {
      fail('discoverPlugins default behavior (no overrideIds) regressed');
    }
  } finally {
    rmSync(fixTmp, { recursive: true, force: true });
  }
} catch (e) {
  fail(`plugin registry split tests crashed: ${e.message}`);
}

console.log('\n31. scan.mjs --doctor (read-only health sweep)');

try {
  const tmp = mkdtempSync(join(tmpdir(), 'co-scan-doctor-'));

  // No portals file at all — must no-op gracefully (fresh setup / CI), same
  // contract as verify-portals.mjs's own found:false branch.
  const missingPortals = join(tmp, 'missing-portals.yml');
  const missingOut = run(NODE, ['scan.mjs', '--doctor'], {
    env: { ...process.env, CAREER_OPS_PORTALS: missingPortals },
  });
  if (missingOut && missingOut.includes('no portals file at') && missingOut.includes('nothing to verify')) {
    pass('scan --doctor no-ops gracefully when portals.yml is missing');
  } else {
    fail(`scan --doctor missing-file output wrong: ${JSON.stringify(missingOut)}`);
  }

  // Empty tracked_companies — exercises the real CLI wiring (flag parsing,
  // provider loading, verifyPortalsFile call, report formatting) with zero
  // network calls, since there's nothing to probe.
  const emptyPortals = join(tmp, 'portals.yml');
  writeFileSync(emptyPortals, 'tracked_companies: []\n');
  const emptyOut = run(NODE, ['scan.mjs', '--doctor'], {
    env: { ...process.env, CAREER_OPS_PORTALS: emptyPortals },
  });
  if (
    emptyOut &&
    emptyOut.includes('scan --doctor:') &&
    emptyOut.includes('0 live, 0 live-but-empty, 0 unresolved, 0 no-provider (skipped)')
  ) {
    pass('scan --doctor runs the CLI-wired health sweep and reports zero tracked companies');
  } else {
    fail(`scan --doctor empty-companies output wrong: ${JSON.stringify(emptyOut)}`);
  }

  rmSync(tmp, { recursive: true, force: true });
} catch (e) {
  fail(`scan --doctor tests crashed: ${e.message}`);
}

console.log('\nTest layout guard (provider tests live in tests/providers/)');
try {
  const src = readFileSync(join(ROOT, 'test-all.mjs'), 'utf-8');
  // Split markers so this guard never matches its own source.
  const emDash = 'Provider ' + '—';
  const hyphen = 'Provider ' + '- ';
  if (!src.includes(emDash) && !src.includes(hyphen)) {
    pass('no provider sections re-added to test-all.mjs');
  } else {
    fail('provider test section found in test-all.mjs — add a tests/providers/{name}.test.mjs file instead (auto-discovered, no registration)');
  }
} catch (e) {
  fail(`test layout guard: ${e.message}`);
}

console.log('\n40. LaTeX-tex tailoring round-trip (extract → patch, #695)');
try {
  const dir = mkdtempSync(join(tmpdir(), 'latex-tex-'));
  const manifestOut = join(dir, 'manifest.json');
  const srcTex = join(ROOT, 'examples/latex-tex/resume-subheading.tex');
  execFileSync(NODE, ['extract-latex-content.mjs', srcTex, '--out', manifestOut], { cwd: ROOT, encoding: 'utf-8' });
  const extracted = JSON.parse(readFileSync(manifestOut, 'utf-8'));
  if (extracted.supported && Array.isArray(extracted.slots) && extracted.slots.length > 0) {
    pass('extract-latex-content.mjs produces a slot manifest');
  } else {
    fail('extract-latex-content.mjs manifest missing slots');
  }
  const patchJson = join(dir, 'patches.json');
  const patchedTex = join(dir, 'out.tex');
  writeFileSync(patchJson, JSON.stringify({
    slots: extracted.slots,
    patches: [{ id: extracted.slots[0].id, text: 'CLI patch path works.' }],
  }));
  execFileSync(NODE, ['patch-latex-content.mjs', srcTex, patchJson, patchedTex], { cwd: ROOT, encoding: 'utf-8' });
  if (readFileSync(patchedTex, 'utf-8').includes('CLI patch path works.')) {
    pass('extract-latex-content.mjs + patch-latex-content.mjs CLI round-trip');
  } else {
    fail('CLI patch round-trip did not update the .tex file');
  }
  rmSync(dir, { recursive: true, force: true });
} catch (e) {
  fail(`LaTeX-tex tailoring test crashed: ${e.message}`);
}

console.log('\n41. CV template resolver (cv-templates.mjs, #1690)');
try {
  const listed = run(NODE, ['cv-templates.mjs', 'list', 'cv']);
  if (listed !== null) pass('cv-templates.mjs list cv exits 0'); else fail('cv-templates.mjs list cv crashed');
  const resolved = run(NODE, ['cv-templates.mjs', 'resolve', 'cv'], { env: { ...process.env, CAREER_OPS_ROOT: mkdtempSync(join(tmpdir(), 'cvt-')) } });
  if (resolved !== null) pass('cv-templates.mjs resolve cv falls back to default without a profile'); else fail('cv-templates.mjs resolve cv crashed');
} catch (e) {
  fail(`cv-templates resolver test crashed: ${e.message}`);
}

console.log('\n42. Headless evaluator prompt-cache wiring (#1709, #1842)');
try {
  // openai-eval.mjs, gemini-eval.mjs, and ollama-eval.mjs all parse argv and can
  // process.exit() at module-top-level on import (no invokedDirectly guard like
  // openrouter-runner.mjs has) — importing them in-process would kill this whole
  // test run (the exact #1916/32dcee0 class of bug). Assert their wiring at the
  // source level instead, same approach the upstream commits used.
  const openaiSrc = readFileSync(join(ROOT, 'openai-eval.mjs'), 'utf-8');
  const openaiGatesOff = /host === 'api\.openai\.com'\)\s*return\s*\{\s*role:\s*'system',\s*content:\s*prompt\s*\}/.test(openaiSrc);
  const openaiSendsBreakpoint = /text:\s*prompt,\s*cache_control:\s*\{\s*type:\s*'ephemeral'\s*\}/.test(openaiSrc);
  const openaiWiresIt = /buildSystemMessage\(systemPrompt,\s*endpointHost\)/.test(openaiSrc);
  if (openaiGatesOff && openaiSendsBreakpoint && openaiWiresIt) {
    pass('openai-eval host-gates the #1709 prompt-cache breakpoint and wires it into the request');
  } else {
    fail(`openai-eval prompt-cache wiring missing: gatesOff=${openaiGatesOff} sendsBreakpoint=${openaiSendsBreakpoint} wired=${openaiWiresIt}`);
  }

  const geminiSrc = readFileSync(join(ROOT, 'gemini-eval.mjs'), 'utf-8');
  const geminiUsesSystemInstruction = /getGenerativeModel\(\{[\s\S]*?systemInstruction:\s*systemPrompt/.test(geminiSrc);
  const geminiCarriesJdTurn = /generateContent\(`JOB DESCRIPTION TO EVALUATE/.test(geminiSrc);
  if (geminiUsesSystemInstruction && geminiCarriesJdTurn) {
    pass('gemini-eval moves the static prefix to systemInstruction and sends only the JD turn (#1709)');
  } else {
    fail(`gemini-eval systemInstruction wiring missing: sys=${geminiUsesSystemInstruction} jd=${geminiCarriesJdTurn}`);
  }

  const ollamaSrc = readFileSync(join(ROOT, 'ollama-eval.mjs'), 'utf-8');
  const ollamaInOptions = /options:\s*\{\s*temperature:\s*0\.4[^}]*num_ctx/.test(ollamaSrc);
  const ollamaNoTopLevel = !/\n\s*temperature:\s*0\.4,\s*\n\s*options:/.test(ollamaSrc);
  if (ollamaInOptions && ollamaNoTopLevel) {
    pass('ollama-eval sets temperature inside options (not silently ignored at the top level, #1842)');
  } else {
    fail(`ollama-eval temperature placement: inOptions=${ollamaInOptions} noTopLevel=${ollamaNoTopLevel}`);
  }
} catch (e) {
  fail(`Headless evaluator prompt-cache wiring test crashed: ${e.message}`);
}

console.log('\n74. gmail: isCleanUrl() drops page assets');
try {
  const { isCleanUrl } = await import(pathToFileURL(join(ROOT, 'plugins', 'gmail', '_helpers.mjs')).href);

  // The bug: job-alert emails embed a company logo per job. These reached the
  // pipeline as untitled "job leads" because they are https, carry no tracker
  // keyword, and sit on the board's own domain.
  const assets = [
    'https://80000hours.org/wp-content/uploads/2023/11/acme-160x160.jpeg',
    'https://example.com/logo.svg?v=2',              // cache-buster after the extension
    'https://example.com/hero.PNG',                  // extension case is not significant
    'https://cdn.example.com/anything',              // asset subdomain, no extension
    'https://images.example.com/x',
    'https://fonts.googleapis.com/css2?family=Inter', // webfont CSS has no extension
    'https://example.com/wp-includes/js/x',
  ];
  const bad = assets.filter(isCleanUrl);
  if (bad.length === 0) pass('isCleanUrl() rejects logos, webfonts and asset hosts');
  else fail(`isCleanUrl() let ${bad.length} asset URL(s) through: ${bad.join(', ')}`);

  // Regression guard: real postings must survive. "gh_src=js" and "/static-site/"
  // are the shapes most likely to trip a naive asset filter.
  const postings = [
    'https://boards.greenhouse.io/acme/jobs/4384681009?gh_src=js',
    'https://jobs.ashbyhq.com/acme/abc-123',
    'https://jobs.lever.co/acme/b71cd010-d3cf-446c-80fa',
    'https://careers.example.com/static-site-engineer',
    'https://example.com/jobs/senior-media-buyer',
  ];
  const lost = postings.filter(u => !isCleanUrl(u));
  if (lost.length === 0) pass('isCleanUrl() still accepts real job postings');
  else fail(`isCleanUrl() wrongly rejected: ${lost.join(', ')}`);

  // Pre-existing behaviour must not regress.
  if (!isCleanUrl('http://example.com/jobs/1') && !isCleanUrl('https://example.com/click/track')
      && !isCleanUrl('not a url')) {
    pass('isCleanUrl() keeps rejecting http, trackers and malformed input');
  } else {
    fail('isCleanUrl() regressed on http / tracker / malformed input');
  }
} catch (e) {
  fail(`gmail isCleanUrl tests crashed: ${e.message}`);
}

// check-jd-archive.mjs's own --self-test (invoked above via the CLI-check
// table) covers the finding logic on synthetic fixtures. This section pins
// the wiring: the script ships, updates, is documented, the mode files state
// the archival step as required (not conditional), and the checker stays
// strictly read-only — it reports missing archives; it must never be able to
// "fix" one itself by writing a report or a jds/ file.

console.log('\n75. JD-archive validator wiring + read-only boundary (#2789)');

try {
  const jdArchiveSrc = readFile('check-jd-archive.mjs');

  // Upstream also asserts check-jd-archive.mjs is listed in update-system.mjs's
  // SYSTEM_PATHS, so its updater ships the file. This fork has no updater — it
  // syncs from upstream explicitly — so there is no SYSTEM_PATHS to be in, and
  // reading update-system.mjs here threw ENOENT and took the whole block (and
  // the test run after it) down with it.
  if (fileExists('update-system.mjs')) {
    const updaterSrc = readFile('update-system.mjs');
    const jdArchiveSysBlock = (updaterSrc.match(/SYSTEM_PATHS\s*=\s*\[([\s\S]*?)\]/) || [, ''])[1];
    if (jdArchiveSysBlock.includes("'check-jd-archive.mjs'")) {
      pass('check-jd-archive.mjs is in update-system.mjs SYSTEM_PATHS (shipped + updatable)');
    } else {
      fail('check-jd-archive.mjs is NOT in SYSTEM_PATHS — updates would never deliver it');
    }
  }

  const pkg = JSON.parse(readFile('package.json'));
  if (pkg.scripts && pkg.scripts['jd-archive'] === 'node check-jd-archive.mjs') {
    pass('package.json exposes npm run jd-archive');
  } else {
    fail('package.json missing the jd-archive script entry');
  }

  const scriptsDoc = readFile('docs/SCRIPTS.md');
  if (scriptsDoc.includes('## check-jd-archive') && scriptsDoc.includes('missing-jd-archive')) {
    pass('docs/SCRIPTS.md documents check-jd-archive (section + finding type)');
  } else {
    fail('docs/SCRIPTS.md missing the check-jd-archive section');
  }

  const agentsDoc = readFile('AGENTS.md');
  if (agentsDoc.includes('`check-jd-archive.mjs`')) {
    pass('AGENTS.md Main Files table lists check-jd-archive.mjs');
  } else {
    fail('AGENTS.md Main Files table missing check-jd-archive.mjs');
  }
  if (/REQUIRED.*Job Description \(archived verbatim\)|Job Description \(archived verbatim\).*REQUIRED/.test(agentsDoc)) {
    pass('AGENTS.md states the JD-archive section as required, not conditional');
  } else {
    fail('AGENTS.md does not state the JD-archive section as required');
  }

  const ofertaDoc = readFile('modes/oferta.md');
  if (ofertaDoc.includes('## Job Description (archived verbatim)')) {
    pass('modes/oferta.md report template carries a Job Description (archived verbatim) section');
  } else {
    fail('modes/oferta.md report template missing the Job Description (archived verbatim) section');
  }
  if (/JD archival \(required, #2789\)/.test(ofertaDoc)) {
    pass('modes/oferta.md states JD archival as required (matches the Machine Summary "required" phrasing style)');
  } else {
    fail('modes/oferta.md does not state JD archival as a required step');
  }

  const pdfDoc = readFile('modes/pdf.md');
  if (!/write the JD to a scratch file[\s\S]{0,20}if it isn't already one/.test(pdfDoc)) {
    pass('modes/pdf.md no longer phrases JD archival as conditional ("if it isn\'t already one")');
  } else {
    fail('modes/pdf.md still phrases JD archival as conditional, not required');
  }
  if (pdfDoc.includes('JD archival (required, #2789)')) {
    pass('modes/pdf.md states JD archival as a required step');
  } else {
    fail('modes/pdf.md does not state JD archival as a required step');
  }

  // Read-only import boundary: the ONLY fs capabilities check-jd-archive.mjs
  // may hold for scanning reports/jds are readFileSync/readdirSync/existsSync.
  // It also imports mkdtempSync/mkdirSync/writeFileSync/rmSync — but ONLY for
  // building its own self-test fixtures in a temp dir, never for reports/ or
  // jds/. The boundary check below allows the self-test-fixture write APIs by
  // name but asserts they never appear outside the self-test function body.
  const SELF_TEST_ONLY_FS = new Set(['mkdtempSync', 'mkdirSync', 'writeFileSync', 'rmSync']);
  const READ_ONLY_FS = new Set(['readFileSync', 'readdirSync', 'existsSync']);
  const fsImportMatch = jdArchiveSrc.match(/import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?fs['"]/);
  const fsNames = fsImportMatch ? fsImportMatch[1].split(',').map(s => s.trim()).filter(Boolean) : [];
  const unexpected = fsNames.filter(n => !READ_ONLY_FS.has(n) && !SELF_TEST_ONLY_FS.has(n));
  if (fsNames.length > 0 && unexpected.length === 0) {
    pass('check-jd-archive.mjs fs imports are limited to read-only scanning APIs plus self-test-fixture builders');
  } else {
    fail(`check-jd-archive.mjs fs import boundary violated: ${unexpected.join(', ') || 'no fs import matched'}`);
  }

  // The self-test-only write APIs must never be called from checkJdArchive,
  // hasEmbeddedJdArchive, or parseReportFilename — only from runSelfTest.
  // Extracting that function's body needs brace-counting, not a greedy
  // regex: `[\s\S]*` backtracks to the LAST `\n}` in the whole file (e.g. the
  // CLI-invocation block at the end), so `.replace(selfTestBody, '')` could
  // strip out everything from runSelfTest onward — including real code after
  // it — and a stray write call there would never get scanned, silently
  // passing the very boundary check this is meant to enforce (CodeRabbit,
  // PR #2791). Walk brace depth from the opening `{` instead, so nested
  // blocks/arrow functions inside runSelfTest don't end the match early
  // either.
  const runSelfTestStart = jdArchiveSrc.indexOf('function runSelfTest()');
  let selfTestBody = '';
  if (runSelfTestStart !== -1) {
    const openBrace = jdArchiveSrc.indexOf('{', runSelfTestStart);
    let depth = 0;
    let i = openBrace;
    for (; i < jdArchiveSrc.length; i += 1) {
      if (jdArchiveSrc[i] === '{') depth += 1;
      else if (jdArchiveSrc[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    selfTestBody = jdArchiveSrc.slice(openBrace, i + 1);
  }
  const outsideSelfTest = jdArchiveSrc
    .replace(selfTestBody, '')
    .split('\n')
    .filter(line => [...SELF_TEST_ONLY_FS].some(fn => line.includes(`${fn}(`)) && !/^\s*import\b/.test(line));
  if (outsideSelfTest.length === 0) {
    pass('check-jd-archive.mjs never calls a write-capable fs API outside its own self-test fixtures');
  } else {
    fail(`check-jd-archive.mjs calls a write-capable fs API outside runSelfTest: ${outsideSelfTest.join(' | ')}`);
  }

  if (!/from\s*['"](?:node:)?fs\/promises['"]/.test(jdArchiveSrc)) {
    pass('check-jd-archive.mjs does not import fs/promises');
  } else {
    fail('check-jd-archive.mjs imports fs/promises — write-capable API surface');
  }
  if (!/\brequire\s*\(/.test(jdArchiveSrc)) {
    pass('check-jd-archive.mjs has no require() escape hatch');
  } else {
    fail('check-jd-archive.mjs uses require() — bypasses the import whitelist');
  }
} catch (e) {
  fail(`jd-archive wiring check: ${e.message}`);
}

await runDiscovered();

finish();
