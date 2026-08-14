// tests/dedup-nonlatin-company.test.mjs — moved out of test-all.mjs into the
// fork's auto-discovered tests/ layout. Content is upstream's block, unchanged.

import { pass, fail, ROOT, NODE, fileExists, run } from './helpers.mjs';
// test-all.mjs's local readFile helper; tests/helpers.mjs exports fileExists but not this.
const readFile = (rel) => readFileSync(join(ROOT, rel), 'utf-8');
import { join } from 'path';
import { pathToFileURL } from 'url';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

// ── DEDUP ORDINARY COMPANY KEY: NON-LATIN COMPANIES (#2429) ──
// The sibling of the blind-via case directly above, on the path that runs for
// every normal row. #2429 made tracker-utils.mjs's normalizeCompany
// Unicode-aware and merge-tracker/set-status inherited it, but dedup-tracker
// carried its own local [^a-z0-9] copy, so two DIFFERENT companies written in
// a non-Latin script both keyed to '' and one row was deleted outright.
// Controls: punctuation/spacing variants of one Latin employer must still
// merge, and two distinct Latin employers must still stay apart.
console.log('\n🧪 Testing dedup company key with non-Latin companies (#2429)...');
try {
  const coDedupTmp = mkdtempSync(join(tmpdir(), 'career-ops-dedup-company-'));
  try {
    mkdirSync(join(coDedupTmp, 'data'));
    const tracker = join(coDedupTmp, 'data', 'applications.md');
    writeFileSync(tracker,
      '# Applications Tracker\n\n' +
      '| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|-----|------|-------|--------|-----|--------|-------|\n' +
      // (a) Two DIFFERENT non-Latin employers, same role — two real
      // applications, both must survive.
      '| 71 | 2026-04-01 | アクメ株式会社 | — | Backend Engineer | 4.2/5 | Evaluated | ❌ | [71](../reports/071-a.md) | first company |\n' +
      '| 72 | 2026-04-02 | グロベックス合同会社 | — | Backend Engineer | 3.0/5 | Evaluated | ❌ | [72](../reports/072-b.md) | different company |\n' +
      // (b) Control: presentation variants of ONE Latin employer still merge.
      '| 73 | 2026-04-03 | Acme (Inc.) | — | Data Engineer | 3.1/5 | Evaluated | ❌ | [73](../reports/073-c.md) | punctuated |\n' +
      '| 74 | 2026-04-04 | Acme Inc | — | Data Engineer | 4.5/5 | Evaluated | ❌ | [74](../reports/074-d.md) | same employer |\n' +
      // (c) Control: two distinct Latin employers still stay apart.
      '| 75 | 2026-04-05 | Globex | — | Platform Engineer | 3.9/5 | Evaluated | ❌ | [75](../reports/075-e.md) | one |\n' +
      '| 76 | 2026-04-06 | Initech | — | Platform Engineer | 4.0/5 | Evaluated | ❌ | [76](../reports/076-f.md) | another |\n');

    const r = run(NODE, ['dedup-tracker.mjs'], { env: { ...process.env, CAREER_OPS_TRACKER: tracker } });
    if (r === null) {
      fail('dedup-tracker.mjs crashed during non-Latin company key test (#2429)');
    } else {
      const out = readFileSync(tracker, 'utf-8');

      const backendRows = out.split('\n').filter(l => l.includes('Backend Engineer'));
      if (backendRows.length === 2
          && backendRows.some(l => l.includes('アクメ株式会社'))
          && backendRows.some(l => l.includes('グロベックス合同会社'))) {
        pass('dedup-tracker keeps two distinct non-Latin companies apart (#2429)');
      } else {
        fail(`dedup-tracker merged distinct non-Latin companies: ${backendRows.length} Backend Engineer rows`);
      }

      const dataRows = out.split('\n').filter(l => l.includes('Data Engineer'));
      if (dataRows.length === 1 && dataRows[0].includes('4.5/5')) {
        pass('dedup-tracker still merges punctuation variants of one Latin employer (#2429)');
      } else {
        fail(`dedup-tracker Latin punctuation merge broken: ${dataRows.length} Data Engineer rows`);
      }

      const platformRows = out.split('\n').filter(l => l.includes('Platform Engineer'));
      if (platformRows.length === 2) {
        pass('dedup-tracker still keeps two distinct Latin employers apart (#2429)');
      } else {
        fail(`dedup-tracker merged distinct Latin employers: ${platformRows.length} Platform Engineer rows`);
      }
    }
  } finally {
    rmSync(coDedupTmp, { recursive: true, force: true });
  }
} catch (e) {
  fail(`dedup company key tests crashed (#2429): ${e.message}`);
}

