// tests/set-status-role-mismatch.test.mjs — regression coverage for
// set-status.mjs's --role mismatch guard, ported from upstream career-ops
// c05ce51 (#2108, "fail closed when a lone company row contradicts --role",
// closes #2009). Same porting rationale as tests/set-status-mismatch.test.mjs:
// upstream ships this as an addition to the old-style top-level
// set-status-tests.mjs, which this fork does not carry — the coverage lands
// here instead, auto-discovered by test-all.mjs's tests/**/*.test.mjs scan.
//
// resolveRow only consulted --role to break ties between 2+ candidates, so a
// company selector matching exactly ONE row was updated without ever checking
// it against --role — the intended requisition may not be in the tracker at
// all (fuzzy-deduped away), and the lone survivor silently absorbed the
// status change. set-status.mjs now refuses (exit 3, code 'role-mismatch')
// unless --force is passed.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nset-status --role mismatch guard (#2009)');

function runSetStatus(args, tracker) {
  try {
    const stdout = execFileSync(NODE, [join(ROOT, 'set-status.mjs'), ...args], {
      cwd: ROOT, encoding: 'utf-8', timeout: 30000,
      env: { ...process.env, CAREER_OPS_TRACKER: tracker },
    });
    return { status: 0, stdout };
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function makeTracker(rows) {
  const tmp = mkdtempSync(join(tmpdir(), 'career-ops-set-status-role-'));
  mkdirSync(join(tmp, 'data'));
  const tracker = join(tmp, 'data', 'applications.md');
  writeFileSync(tracker,
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
    '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
    rows.join('\n') + '\n');
  return { dir: tmp, tracker };
}

// ── A single company match must still be checked against --role (#2009) ──
{
  const { dir, tracker } = makeTracker([
    '| 2 | 2026-06-02 | Globex | Platform Engineer | 4.0/5 | Evaluated | ✅ | [2](../reports/002-globex-2026-06-02.md) | seed |',
  ]);
  const before = readFileSync(tracker, 'utf-8');
  const r = runSetStatus(['globex', 'SKIP', '--role', 'Data Engineer', '--json'], tracker);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  if (r.status === 3 && parsed?.code === 'role-mismatch'
      && parsed.rowRole === 'Platform Engineer' && parsed.requestedRole === 'Data Engineer'
      && readFileSync(tracker, 'utf-8') === before) {
    pass('role-mismatch: single company match fails closed without writing (#2009)');
  } else {
    fail(`role-mismatch: status=${r.status} json=${JSON.stringify(parsed)}\n${r.stdout}${r.stderr}`);
  }

  const forced = runSetStatus(['globex', 'SKIP', '--role', 'Data Engineer', '--force'], tracker);
  if (forced.status === 0 && /\| 2 \|[^\n]*\| SKIP \|/.test(readFileSync(tracker, 'utf-8'))) {
    pass('role-mismatch: --force records an explicit decision to proceed');
  } else {
    fail(`role-mismatch force: status=${forced.status}\n${forced.stdout}${forced.stderr}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── An exact --role must NOT be rejected by the new guard (#2009) ────────
// roleFuzzyMatch is a dedup predicate: it returns false when the overlap is
// entirely baseline vocabulary (["platform","engineer"]) so same-titled
// sibling reqs never auto-merge. Using it alone as the guard's equality test
// would reject --role "Platform Engineer" against a row that is exactly that.
{
  const { dir, tracker } = makeTracker([
    '| 2 | 2026-06-02 | Globex | Platform Engineer | 4.0/5 | Evaluated | ✅ | [2](../reports/002-globex-2026-06-02.md) | seed |',
  ]);
  const r = runSetStatus(['globex', 'Applied', '--role', 'Platform Engineer'], tracker);
  if (r.status === 0 && /\| 2 \|[^\n]*\| Applied \|/.test(readFileSync(tracker, 'utf-8'))) {
    pass('role-mismatch: an exact all-baseline role title still proceeds (#2009)');
  } else {
    fail(`role-mismatch exact: status=${r.status}\n${r.stdout}${r.stderr}`);
  }

  // Case and punctuation must not matter for the equality path.
  const r2 = runSetStatus(['globex', 'Evaluated', '--role', 'platform  engineer'], tracker);
  if (r2.status === 0 && /\| 2 \|[^\n]*\| Evaluated \|/.test(readFileSync(tracker, 'utf-8'))) {
    pass('role-mismatch: role equality is case/punctuation insensitive (#2009)');
  } else {
    fail(`role-mismatch normalize: status=${r2.status}\n${r2.stdout}${r2.stderr}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── Symbol-bearing titles must not collapse to the same role (#2009) ─────
// The equality normalizer strips generic punctuation, so it must preserve the
// symbols that actually distinguish a title first — otherwise "C# Engineer"
// and "C++ Engineer" both fold to "c engineer" and the guard silently updates
// the wrong row for exactly the kind of title it exists to protect.
{
  const { dir, tracker } = makeTracker([
    '| 1 | 2026-06-01 | Contoso | C++ Engineer | 4.0/5 | Evaluated | ✅ | [1](../reports/001-contoso-2026-06-01.md) | — |',
  ]);
  const before = readFileSync(tracker, 'utf-8');
  const r = runSetStatus(['contoso', 'SKIP', '--role', 'C# Engineer', '--json'], tracker);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  if (r.status === 3 && parsed?.code === 'role-mismatch' && readFileSync(tracker, 'utf-8') === before) {
    pass('role-mismatch: "C# Engineer" does not match a "C++ Engineer" row (#2009)');
  } else {
    fail(`role-mismatch symbol: status=${r.status} json=${JSON.stringify(parsed)}\n${r.stdout}${r.stderr}`);
  }

  // The genuine same-symbol title still matches (guard does not over-fire).
  const r2 = runSetStatus(['contoso', 'Applied', '--role', 'c++ engineer'], tracker);
  if (r2.status === 0 && /\| 1 \|[^\n]*\| Applied \|/.test(readFileSync(tracker, 'utf-8'))) {
    pass('role-mismatch: "c++ engineer" still matches a "C++ Engineer" row (#2009)');
  } else {
    fail(`role-mismatch symbol-equal: status=${r2.status}\n${r2.stdout}${r2.stderr}`);
  }
  rmSync(dir, { recursive: true, force: true });
}
