// tests/scan-url-dedup.test.mjs — URL dedup normalization (#2065): a cosmetic
// query-suffix variant of an already-processed URL (locale/tracking params,
// trailing slash, case) must still dedup against the bare form, while an
// identity-bearing param (e.g. Greenhouse's gh_jid) must NOT be stripped.
import { pass, fail, ROOT } from './helpers.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nscan.mjs — normalizeUrlForDedup (#2065)');

const { normalizeUrlForDedup } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

const bare = 'https://acme.jobs.personio.com/job/2670127';
const withLang = `${bare}?language=en`;
const withTrailingSlash = `${bare}/`;
const withUtm = `${bare}?utm_source=newsletter`;
const ghJid = 'https://boards.greenhouse.io/acme/jobs/123?gh_jid=123';
const malformed = 'not a url';

if (
  normalizeUrlForDedup(withLang) === normalizeUrlForDedup(bare) &&
  normalizeUrlForDedup(withTrailingSlash) === normalizeUrlForDedup(bare) &&
  normalizeUrlForDedup(withUtm) === normalizeUrlForDedup(bare) &&
  normalizeUrlForDedup(ghJid).includes('gh_jid=123') &&
  normalizeUrlForDedup(malformed) === malformed
) {
  pass('normalizeUrlForDedup strips cosmetic params/trailing slash but preserves identity params and malformed input');
} else {
  fail(`normalizeUrlForDedup wrong: withLang=${normalizeUrlForDedup(withLang)} withTrailingSlash=${normalizeUrlForDedup(withTrailingSlash)} withUtm=${normalizeUrlForDedup(withUtm)} ghJid=${normalizeUrlForDedup(ghJid)} malformed=${normalizeUrlForDedup(malformed)}`);
}

if (normalizeUrlForDedup(null) == null && normalizeUrlForDedup(undefined) == null && normalizeUrlForDedup('') === '') {
  pass('normalizeUrlForDedup passes through null/undefined/empty unchanged');
} else {
  fail('normalizeUrlForDedup should pass through null/undefined/empty unchanged');
}

// Case-folding: scheme + host lowercased, path case preserved (some ATS slugs
// are case-sensitive).
if (normalizeUrlForDedup('HTTPS://Boards.Greenhouse.IO/acme/jobs/123') === 'https://boards.greenhouse.io/acme/jobs/123') {
  pass('normalizeUrlForDedup lowercases scheme + host');
} else {
  fail(`normalizeUrlForDedup did not lowercase scheme/host: ${normalizeUrlForDedup('HTTPS://Boards.Greenhouse.IO/acme/jobs/123')}`);
}

// ── loadSeenUrls integration — a fork-specific adaptation ───────────────────
// Upstream's loadSeenUrls resolves data/ relative to process.cwd(); this fork
// resolves it via CAREER_OPS_ROOT (or scan.mjs's own directory) instead — see
// path-resolver.mjs. Module-level path constants are also fixed at first
// import, so this drives loadSeenUrls as a subprocess (fresh module state)
// rather than importing scan.mjs again in-process.
{
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'career-ops-seen-urls-'));
  try {
    mkdirSync(join(fixtureRoot, 'data'), { recursive: true });
    writeFileSync(
      join(fixtureRoot, 'data', 'scan-history.tsv'),
      `url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n${withLang}\t2026-07-06\tpersonio-feed\tPM\tAcme\tadded\tRemote\n`,
      'utf-8',
    );
    const probe = [
      `const m = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'scan.mjs')).href)});`,
      'const { seen } = m.loadSeenUrls();',
      `console.log(JSON.stringify([[...seen].includes(m.normalizeUrlForDedup(${JSON.stringify(bare)})), [...seen].includes(m.normalizeUrlForDedup(${JSON.stringify(withLang)}))]));`,
    ].join('\n');
    const { execFileSync } = await import('child_process');
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
      cwd: fixtureRoot,
      env: { ...process.env, CAREER_OPS_ROOT: fixtureRoot },
      encoding: 'utf-8',
    }).trim();
    const [hasBare, hasWithLang] = JSON.parse(out);
    if (hasBare && hasWithLang) {
      pass('loadSeenUrls dedups a history row against a cosmetic query-suffix variant');
    } else {
      fail(`loadSeenUrls did not dedup query-suffix variant: has(bare)=${hasBare} has(withLang)=${hasWithLang}`);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

// Same dedupUrl-once pattern the main-loop and runSeedScan/scan-ats-full loops
// use: a job re-fetched under any URL variant of an already-seen row must be
// counted as a dupe (never re-added to the seen set).
{
  const seen = new Set([normalizeUrlForDedup(bare)]);
  let dupeCount = 0;
  let newCount = 0;
  for (const jobUrl of [bare, withLang, withTrailingSlash]) {
    const dedupUrl = normalizeUrlForDedup(jobUrl);
    if (seen.has(dedupUrl)) {
      dupeCount++;
    } else {
      seen.add(dedupUrl);
      newCount++;
    }
  }
  if (dupeCount === 3 && newCount === 0) {
    pass('main-loop dedup pattern treats every cosmetic URL variant of a seen row as a duplicate, never re-adds');
  } else {
    fail(`main-loop dedup pattern wrong: dupeCount=${dupeCount} newCount=${newCount} (expected 3/0)`);
  }
}
