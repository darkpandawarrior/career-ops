// tests/scan-blacklist.test.mjs — company blacklist (#1742), ported from upstream.
// data/blacklist.md is the user's do-not-apply list. parseBlacklist keys rows
// by the shared normalizeCompany() so matching is case- and punctuation-
// insensitive; loadBlacklist on an absent file is a no-op (empty Map).
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { existsSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nscan.mjs — company blacklist (#1742)');

try {
  const { parseBlacklist, loadBlacklist } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
  const bl = parseBlacklist([
    '# Company Blacklist',
    '',
    '| Company | Since | Scope | Reason |',
    '|---------|-------|-------|--------|',
    '| Acme Corp. | 2026-01-15 | company | post-interview process signals |',
    '| Globex | 2026-02-01 | company | zero conversion |',
  ].join('\n'));
  const exact = bl.get('acmecorp');
  if (
    bl.size === 2 &&
    exact && exact.reason === 'post-interview process signals' && exact.since === '2026-01-15' &&
    bl.has('globex') && !bl.has('company')
  ) {
    pass('scan.mjs parseBlacklist parses the table and keys by normalized company (#1742)');
  } else {
    fail(`scan.mjs parseBlacklist wrong: size=${bl.size} keys=${[...bl.keys()].join(',')}`);
  }

  // Normalization tier: the same key the tracker writers use, so an ATS feed
  // variant ("ACME-CORP", "acme corp") hits the "Acme Corp." row.
  const { normalizeCompany } = await import(pathToFileURL(join(ROOT, 'tracker-utils.mjs')).href);
  if (bl.get(normalizeCompany('ACME-CORP')) === exact && bl.get(normalizeCompany('acme corp')) === exact) {
    pass('scan.mjs blacklist matching is case/punctuation-insensitive via shared normalizeCompany (#1742)');
  } else {
    fail('scan.mjs blacklist matching misses case/punctuation company variants');
  }

  const fixtureRoot = mkdtempSync(join(tmpdir(), 'career-ops-blacklist-'));
  try {
    const absent = loadBlacklist(join(fixtureRoot, 'data', 'blacklist.md'));
    if (absent instanceof Map && absent.size === 0) {
      pass('scan.mjs loadBlacklist with absent file is a no-op empty Map (opt-in, #1742)');
    } else {
      fail('scan.mjs loadBlacklist did not return an empty Map for an absent file');
    }
    mkdirSync(join(fixtureRoot, 'data'), { recursive: true });
    writeFileSync(join(fixtureRoot, 'data', 'blacklist.md'), '| Company | Since | Scope | Reason |\n|---|---|---|---|\n| Initech | 2026-03-01 | company | example |\n', 'utf-8');
    const present = loadBlacklist(join(fixtureRoot, 'data', 'blacklist.md'));
    if (present.size === 1 && present.get('initech')?.reason === 'example') {
      pass('scan.mjs loadBlacklist reads data/blacklist.md when present (#1742)');
    } else {
      fail('scan.mjs loadBlacklist did not parse a present blacklist file');
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
} catch (err) {
  fail(`scan.mjs blacklist tests crashed: ${err.message}`);
}

// Blacklist wiring: skips are counted and reported (never silent), persisted to
// scan-runs.tsv by header name, and --include-blacklisted bypasses the filter.
const scanScript = readFileSync(join(ROOT, 'scan.mjs'), 'utf-8');
if (
  scanScript.includes("args.includes('--include-blacklisted')") &&
  scanScript.includes('totalFilteredBlacklist') &&
  scanScript.includes('skipped (blacklist)') &&
  scanScript.includes('filtered_blacklist')
) {
  pass('scan.mjs wires blacklist counter, summary line, scan-runs column, and --include-blacklisted (#1742)');
} else {
  fail('scan.mjs missing blacklist counter/summary/scan-runs/--include-blacklisted wiring');
}
