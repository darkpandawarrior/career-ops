// tests/set-status-mismatch.test.mjs — regression coverage for set-status.mjs's
// numeric-selector/report-link mismatch guard, ported from upstream career-ops
// set-status-tests.mjs (career-ops-v1.21.0). The fork's existing set-status
// coverage lives inline in test-all.mjs ("SET-STATUS.MJS CLI CONTRACT") rather
// than a standalone root set-status-tests.mjs, so this new check is added here
// instead — auto-discovered by test-all.mjs's tests/**/*.test.mjs scan without
// touching that file.
//
// A numeric selector ("43") is frequently copied straight from a report
// filename. If tracker drift has left the row's Report cell pointing at a
// DIFFERENT report ID than the row's own # column, blindly trusting the
// numeric selector risks editing the wrong application. set-status.mjs now
// refuses (exit 3, code 'report-number-mismatch') unless --force is passed.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nset-status report-number mismatch guard (--force)');

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

const tmp = mkdtempSync(join(tmpdir(), 'career-ops-set-status-mismatch-'));
try {
  mkdirSync(join(tmp, 'data'));
  const tracker = join(tmp, 'data', 'applications.md');
  const fixture =
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
    '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
    '| 2 | 2026-06-02 | DriftCo | Platform Engineer | 4.0/5 | Evaluated | ✅ | [7](../reports/007-driftco-2026-06-02.md) | migrated badly |\n';
  writeFileSync(tracker, fixture);

  const before = readFileSync(tracker, 'utf-8');
  const blocked = runSetStatus(['2', 'Applied', '--json'], tracker);
  const afterBlocked = readFileSync(tracker, 'utf-8');
  let blockedJson = null;
  try { blockedJson = JSON.parse(blocked.stdout); } catch { /* leave null, checked below */ }
  if (blocked.status === 3 && blockedJson?.code === 'report-number-mismatch'
      && blockedJson.trackerNum === 2 && blockedJson.reportNums?.includes(7)
      && afterBlocked === before) {
    pass('report-mismatch: numeric selector fails closed without writing');
  } else {
    fail(`report-mismatch: exit ${blocked.status} json=${JSON.stringify(blockedJson)}`);
  }

  const forced = runSetStatus(['2', 'Applied', '--force'], tracker);
  const afterForced = readFileSync(tracker, 'utf-8');
  if (forced.status === 0 && /\| 2 \|[^\n]*\| Applied \|/.test(afterForced)) {
    pass('report-mismatch: --force permits an intentional numeric update');
  } else {
    fail(`report-mismatch force: exit ${forced.status}\n${forced.stdout}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
