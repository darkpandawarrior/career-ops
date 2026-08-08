// tests/set-status-candidate-resolution.test.mjs — regression coverage for
// set-status.mjs's shared candidate-resolution contract (career-ops #2348).
// Same shape and placement rationale as tests/set-status-mismatch.test.mjs,
// tests/set-status-selectors.test.mjs, and tests/set-status-role-mismatch.test.mjs:
// the fork keeps its set-status CLI contract in tests/ rather than upstream's
// root set-status-tests.mjs.
//
// Upstream consolidated the numeric/--row/--report/company selector paths'
// ambiguity handling into a single resolveCandidates() helper so the
// fail-closed-on-2+-candidates property (#1704) is enforced in one place
// instead of three separate copies. This fork's set-status.mjs still
// implements that guard per-path rather than through a shared helper, but the
// CLI-level contract is identical — these tests exercise the CLI as a black
// box (subprocess + JSON output), so they hold regardless of which
// implementation shape is behind it.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nset-status shared candidate resolution (#2348)');

function runSetStatus(args, tracker) {
  try {
    const stdout = execFileSync(NODE, [join(ROOT, 'set-status.mjs'), ...args], {
      cwd: ROOT, encoding: 'utf-8', timeout: 30000,
      env: { ...process.env, CAREER_OPS_TRACKER: tracker },
    });
    return { status: 0, stdout };
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout ?? '' };
  }
}

function makeTracker(content) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-set-status-candidates-'));
  mkdirSync(join(dir, 'data'));
  const tracker = join(dir, 'data', 'applications.md');
  writeFileSync(tracker, content);
  return { dir, tracker };
}

const HEADER =
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|-------|\n';

// Two rows link the SAME report — reachable when a re-evaluation is filed
// against an existing report, or a report link is copied between rows.
const TRACKER_DUP_REPORT = HEADER +
  '| 1 | 2026-06-01 | Acme | Backend Engineer | 4.2/5 | Evaluated | ✅ | [9](../reports/009-acme-2026-06-01.md) | — |\n' +
  '| 2 | 2026-06-02 | Globex | Data Engineer | 4.0/5 | Evaluated | ✅ | [9](../reports/009-globex-2026-06-02.md) | — |\n';

// Previously untested: the --report path had no 2+ coverage at all, so a
// regression to first-match-wins there would have gone unnoticed.
{
  const { dir, tracker } = makeTracker(TRACKER_DUP_REPORT);
  try {
    const before = readFileSync(tracker, 'utf-8');
    const r = runSetStatus(['--report', '9', 'Applied', '--json'], tracker);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch {}
    if (r.status === 3 && parsed?.code === 'ambiguous' && parsed.candidates?.length === 2
        && readFileSync(tracker, 'utf-8') === before) {
      pass('#2348: --report fails closed on 2+ linking rows, with candidates');
    } else {
      fail(`#2348: --report dup → status=${r.status} json=${JSON.stringify(parsed)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --role narrowing must serve the --report path too, not just the numeric
// and company paths that already had coverage.
{
  const { dir, tracker } = makeTracker(TRACKER_DUP_REPORT);
  try {
    const r = runSetStatus(['--report', '9', 'Applied', '--role', 'Data Engineer', '--json'], tracker);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch {}
    if (r.status === 0 && parsed?.company === 'Globex') {
      pass('#2348: --role narrows a --report match to the intended row');
    } else {
      fail(`#2348: --report + --role → status=${r.status} company=${parsed?.company}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A --role that matches NEITHER candidate must not silently pick one; the
// guard falls through with the original list so both stay visible.
{
  const { dir, tracker } = makeTracker(TRACKER_DUP_REPORT);
  try {
    const before = readFileSync(tracker, 'utf-8');
    const r = runSetStatus(['--report', '9', 'Applied', '--role', 'Site Reliability Engineer', '--json'], tracker);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch {}
    if (r.status === 3 && parsed?.candidates?.length === 2 && readFileSync(tracker, 'utf-8') === before) {
      pass('#2348: a --role matching neither candidate still fails closed with both listed');
    } else {
      fail(`#2348: --report + unmatched --role → status=${r.status} json=${JSON.stringify(parsed)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Parity: the fail-closed contract must hold identically from every entry
// point — the test that would catch a future edit to one path's guard that
// regressed it relative to the others.
{
  const TRACKER_ALL_AMBIGUOUS = HEADER +
    '| 7 | 2026-06-01 | Initech | Backend Engineer | 4.2/5 | Evaluated | ✅ | [3](../reports/003-initech-2026-06-01.md) | — |\n' +
    '| 7 | 2026-06-02 | Initech | Data Engineer | 4.0/5 | Evaluated | ✅ | [3](../reports/003-initech-2026-06-02.md) | — |\n';
  const paths = [
    ['bare numeric', ['7', 'Applied', '--json']],
    ['--row', ['--row', '7', 'Applied', '--json']],
    ['--report', ['--report', '3', 'Applied', '--json']],
    ['company', ['Initech', 'Applied', '--json']],
  ];
  const failures = [];
  for (const [label, args] of paths) {
    const { dir, tracker } = makeTracker(TRACKER_ALL_AMBIGUOUS);
    try {
      const before = readFileSync(tracker, 'utf-8');
      const r = runSetStatus(args, tracker);
      let parsed = null;
      try { parsed = JSON.parse(r.stdout); } catch {}
      const ok = r.status === 3 && parsed?.candidates?.length === 2 && readFileSync(tracker, 'utf-8') === before;
      if (!ok) failures.push(`${label} (status=${r.status}, candidates=${parsed?.candidates?.length})`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  if (failures.length === 0) {
    pass('#2348: all four selector paths fail closed on 2+ candidates, none written');
  } else {
    fail(`#2348: paths that did not fail closed: ${failures.join('; ')}`);
  }
}
