// tests/set-status-selectors.test.mjs — regression coverage for set-status.mjs's
// explicit --row / --report selectors and the report-less-row blind spot
// (career-ops #2347). Same shape and placement rationale as
// tests/set-status-mismatch.test.mjs: the fork keeps its set-status CLI contract
// in tests/ rather than upstream's root set-status-tests.mjs.
//
// Tracker row IDs and report IDs are separate counters. Once any row exists
// without a report they diverge permanently, so a bare "7" genuinely names two
// different applications. --row/--report answer that question instead of
// suppressing it the way --force does.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nset-status explicit --row / --report selectors');

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

const HEADER =
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|-------|\n';

// Row #7 is a backfilled row with NO report link; row #12 links report #7.
// This is exactly what merge-tracker's "#N already used; assigning #M"
// fallback produces, and it is the case the old guard could not see.
const FIXTURE = HEADER +
  '| 7 | 2026-06-02 | Backfilled Co | Platform Engineer | 4.0/5 | Evaluated | ✅ |  | backfilled, no report |\n' +
  '| 12 | 2026-06-04 | Reported Co | Data Engineer | 4.2/5 | Evaluated | ✅ | [7](../reports/007-reported-co-2026-06-04.md) | has the report |\n';

const tmp = mkdtempSync(join(tmpdir(), 'career-ops-set-status-selectors-'));
try {
  mkdirSync(join(tmp, 'data'));
  const tracker = join(tmp, 'data', 'applications.md');

  // 1. The blind spot: a bare "7" is ambiguous and must write nothing.
  writeFileSync(tracker, FIXTURE);
  const before = readFileSync(tracker, 'utf-8');
  const bare = runSetStatus(['7', 'Applied', '--json'], tracker);
  let bareJson = null;
  try { bareJson = JSON.parse(bare.stdout); } catch { /* checked below */ }
  if (bare.status === 3 && bareJson?.code === 'report-number-ambiguous'
      && bareJson.reportNum === 7 && readFileSync(tracker, 'utf-8') === before) {
    pass('bare "7" fails closed when row #7 has no report but another row links report #7');
  } else {
    fail(`report-less blind spot: exit ${bare.status} json=${JSON.stringify(bareJson)}`);
  }

  // 2. --row 7 answers the question: it must update the backfilled row.
  writeFileSync(tracker, FIXTURE);
  const byRow = runSetStatus(['--row', '7', 'Applied'], tracker);
  const afterRow = readFileSync(tracker, 'utf-8');
  if (byRow.status === 0 && /\| 7 \|[^\n]*\| Applied \|/.test(afterRow)
      && /\| 12 \|[^\n]*\| Evaluated \|/.test(afterRow)) {
    pass('--row 7 updates the tracker row, not the report-linking row');
  } else {
    fail(`--row 7: exit ${byRow.status}; wrong row updated`);
  }

  // 3. --report 7 resolves through the Report cell → row #12.
  writeFileSync(tracker, FIXTURE);
  const byReport = runSetStatus(['--report', '7', 'Applied'], tracker);
  const afterReport = readFileSync(tracker, 'utf-8');
  if (byReport.status === 0 && /\| 12 \|[^\n]*\| Applied \|/.test(afterReport)
      && /\| 7 \|[^\n]*\| Evaluated \|/.test(afterReport)) {
    pass('--report 7 updates the row whose Report cell links report #7');
  } else {
    fail(`--report 7: exit ${byReport.status}; wrong row updated`);
  }

  // 4. --report with no linking row is not-found, not a silent no-op.
  writeFileSync(tracker, FIXTURE);
  const missing = runSetStatus(['--report', '99', 'Applied', '--json'], tracker);
  let missingJson = null;
  try { missingJson = JSON.parse(missing.stdout); } catch { /* checked below */ }
  if (missing.status === 2 && missingJson?.code === 'not-found') {
    pass('--report 99 exits not-found when no row links that report');
  } else {
    fail(`--report 99: exit ${missing.status} json=${JSON.stringify(missingJson)}`);
  }

  // 5. The two selectors name different number spaces — never both at once.
  const both = runSetStatus(['--row', '7', '--report', '7', 'Applied'], tracker);
  if (both.status === 1) {
    pass('--row and --report together is a usage error');
  } else {
    fail(`--row + --report: exit ${both.status}, expected 1`);
  }

  // 6. A non-numeric value is a typo, not "no match".
  const typo = runSetStatus(['--row', 'seven', 'Applied'], tracker);
  if (typo.status === 1) {
    pass('--row with a non-numeric value is a usage error');
  } else {
    fail(`--row seven: exit ${typo.status}, expected 1`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
