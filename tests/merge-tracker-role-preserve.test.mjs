// tests/merge-tracker-role-preserve.test.mjs — a FUZZY-matched re-evaluation must
// not rewrite the existing row's role title.
//
// merge-tracker matches an addition to a tracker row in three tiers: report
// number (+ company), entry num (+ company), then company + fuzzy role. Only the
// first proves the two are the SAME evaluation. The update path used to write
// `role: addition.role` unconditionally, so a tier-3 match — which
// role-matcher.mjs makes deliberately generous ("Senior" is a stopword, short
// tokens are dropped) — overwrote the title too.
//
// That is worse than a plain bad merge: the differing title is the ONLY visible
// evidence that two requisitions were ever distinct, so overwriting it destroys
// the thing a human would use to notice the mistake.

import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

console.log('\nmerge-tracker — a fuzzy match must not rewrite the role title');

const dir = mkdtempSync(join(tmpdir(), 'co-merge-role-'));
try {
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'batch', 'tracker-additions'), { recursive: true });
  mkdirSync(join(dir, 'batch', 'merged'), { recursive: true });

  const tracker = join(dir, 'data', 'applications.md');
  writeFileSync(tracker, [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-06-01 | Acme | Senior Android Engineer | 4.0/5 | Applied | ❌ | [1](reports/1-acme.md) | — |',
    '',
  ].join('\n'));

  // No report link on the addition, so tier 1 cannot fire and the match falls
  // through to the fuzzy tier. The two titles are the SAME words in a different
  // order, which is exactly what roleFuzzyMatch is built to collapse — verified
  // directly: roleFuzzyMatch('Senior Android Engineer', 'Android Engineer, Senior')
  // is true. So this addition really does reach the update path, and the only
  // question left is whether it rewrites the stored title.
  writeFileSync(
    join(dir, 'batch', 'tracker-additions', '002-acme.tsv'),
    ['2', '2026-06-20', 'Acme', 'Android Engineer, Senior', 'Evaluated', '3.0/5', '❌', '—', 'second req'].join('\t') + '\n',
  );

  execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_ROOT: dir },
    encoding: 'utf-8',
    timeout: 60000,
  });

  const out = readFileSync(tracker, 'utf-8');
  // Guard the fixture itself: if the addition became its own row, the fuzzy tier
  // never fired and the assertions below would pass without testing anything.
  const rows = out.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l));
  if (rows.length === 1) {
    pass('the addition fuzzy-matched the existing row (it did not become a second row)');
  } else {
    fail(`fixture no longer exercises the fuzzy tier — expected 1 merged row, got ${rows.length}:\n${out}`);
  }
  if (out.includes('Senior Android Engineer') && !out.includes('Android Engineer, Senior')) {
    pass('a fuzzy-matched re-evaluation leaves the existing role title intact');
  } else {
    fail(`the fuzzy match rewrote the role title, destroying the evidence the two reqs differed:\n${out}`);
  }
} catch (e) {
  fail(`merge-tracker role-preservation test crashed: ${e.message}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
