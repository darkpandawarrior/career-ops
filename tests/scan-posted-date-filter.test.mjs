// tests/scan-posted-date-filter.test.mjs — absolute --posted-after/--posted-before
// posting-date filters (#2067), ported from upstream. CLI-only, unlike the
// config-driven relative max_posting_age_days.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { execFileSync } from 'child_process';

console.log('\nscan.mjs — buildPostedDateFilter (#2067)');

const { buildPostedDateFilter } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

const DAY = 24 * 60 * 60 * 1000;
const JUL10 = Date.parse('2026-07-10T12:00:00Z');
const JUL15 = Date.parse('2026-07-15T12:00:00Z');
const JUL20 = Date.parse('2026-07-20T12:00:00Z');

// No bounds → everything passes, including jobs with no postedAt.
{
  const noop = buildPostedDateFilter(null, null);
  if (noop(JUL10) === true && noop(undefined) === true && noop(Number.NaN) === true) {
    pass('buildPostedDateFilter with no bounds passes every job');
  } else {
    fail('buildPostedDateFilter with no bounds should pass everything');
  }
}

// --posted-after only.
{
  const afterOnly = buildPostedDateFilter('2026-07-15', null);
  if (afterOnly(JUL20) === true && afterOnly(JUL10) === false && afterOnly(JUL15) === true) {
    pass('--posted-after excludes postings before the bound, keeps on/after it');
  } else {
    fail('--posted-after bound wrong');
  }
}

// --posted-before only — inclusive through end-of-day.
{
  const beforeOnly = buildPostedDateFilter(null, '2026-07-15');
  const endOfJul15 = Date.parse('2026-07-15T23:59:59.999Z');
  if (beforeOnly(JUL10) === true && beforeOnly(JUL20) === false && beforeOnly(endOfJul15) === true) {
    pass('--posted-before is inclusive through end-of-day and excludes postings after it');
  } else {
    fail('--posted-before bound wrong');
  }
}

// Both bounds — a window.
{
  const windowed = buildPostedDateFilter('2026-07-12', '2026-07-18');
  if (windowed(JUL15) === true && windowed(JUL10) === false && windowed(JUL20) === false) {
    pass('--posted-after + --posted-before together define an inclusive window');
  } else {
    fail('combined posted-date window wrong');
  }
}

// Missing/invalid postedAt always passes — don't penalize missing provider data.
{
  const bounded = buildPostedDateFilter('2026-07-12', '2026-07-18');
  if (bounded(undefined) === true && bounded('2026-07-14') === true && bounded(Number.NaN) === true) {
    pass('jobs with missing/non-numeric postedAt always pass a posted-date bound');
  } else {
    fail('missing/invalid postedAt should always pass');
  }
}

// CLI validation: a malformed --posted-after/--posted-before must fail loudly,
// not silently filter everything out.
{
  const run = (args) => {
    try {
      execFileSync(NODE, [join(ROOT, 'scan.mjs'), ...args], {
        env: { ...process.env, CAREER_OPS_PORTALS: join(ROOT, 'this-file-does-not-exist.yml') },
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0 };
    } catch (err) {
      return { code: err.status, stderr: err.stderr };
    }
  };
  const badAfter = run(['--posted-after', 'not-a-date']);
  const badBefore = run(['--posted-before', '07/15/2026']);
  if (badAfter.code !== 0 && /--posted-after expects YYYY-MM-DD/.test(badAfter.stderr)) {
    pass('scan.mjs rejects a malformed --posted-after with a clear error');
  } else {
    fail(`malformed --posted-after should exit non-zero with a clear message — got code=${badAfter.code} stderr=${badAfter.stderr}`);
  }
  if (badBefore.code !== 0 && /--posted-before expects YYYY-MM-DD/.test(badBefore.stderr)) {
    pass('scan.mjs rejects a malformed --posted-before with a clear error');
  } else {
    fail(`malformed --posted-before should exit non-zero with a clear message — got code=${badBefore.code} stderr=${badBefore.stderr}`);
  }
}
