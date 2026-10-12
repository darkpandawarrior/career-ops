// tests/scan-posting-age.test.mjs — freshness gate + postedAt persistence (#1742),
// ported from upstream. buildPostingAgeFilter is an opt-in freshness gate;
// postedAt flows into scan-history (trailing ISO column) and pipeline.md
// (labeled `posted:` segment), both backward-compatible.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { parseScanHistoryLine } from '../lib/scan-history-columns.mjs';

console.log('\nscan.mjs — posting-age filter + postedAt persistence (#1742)');

try {
  const {
    buildPostingAgeFilter,
    formatPipelineOffer,
    formatScanHistoryRow,
    sortOffersByPostedAtDesc,
  } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

  // ── posting-age filter (max_posting_age_days) ──
  // Opt-in freshness gate. `now` is injected so the boundary math is deterministic.
  const NOW = Date.parse('2026-07-09T00:00:00Z');
  const DAY = 24 * 60 * 60 * 1000;
  const ageFilter = buildPostingAgeFilter(45, NOW);
  if (
    ageFilter(NOW - 10 * DAY) === true && // fresh → pass
    ageFilter(NOW - 60 * DAY) === false && // older than 45d → skip
    ageFilter(NOW - 45 * DAY) === true && // exactly at the cutoff → kept (>=)
    ageFilter(undefined) === true && // no provider date → pass (don't penalize missing data)
    ageFilter(Number.NaN) === true && // malformed date → pass
    ageFilter('2026-01-01') === true // non-number → pass
  ) {
    pass('posting-age filter skips only dated offers older than N days; missing/invalid dates pass');
  } else {
    fail('posting-age filter did not gate on age / missing-date correctly');
  }
  // Absent or non-positive config → pass-all (opt-in, disabled by default).
  if (
    buildPostingAgeFilter(undefined, NOW)(NOW - 9999 * DAY) === true &&
    buildPostingAgeFilter(0, NOW)(NOW - 9999 * DAY) === true &&
    buildPostingAgeFilter(-5, NOW)(NOW - 9999 * DAY) === true &&
    buildPostingAgeFilter(3.5, NOW)(NOW - 9999 * DAY) === true // non-integer → disabled
  ) {
    pass('posting-age filter is opt-in: absent / 0 / negative / non-integer config disables it');
  } else {
    fail('posting-age filter should be a pass-all no-op when unconfigured or misconfigured');
  }

  // ── postedAt persistence ──
  const datedOffer = {
    url: 'https://jobs.example.com/42',
    source: 'greenhouse-api',
    title: 'Staff Engineer',
    company: 'Acme',
    location: 'Remote (US)',
    description: '',
    postedAt: Date.parse('2026-06-18T00:00:00Z'),
  };
  const datedHistory = parseScanHistoryLine(formatScanHistoryRow(datedOffer, '2026-07-09'));
  const noDateHistory = parseScanHistoryLine(formatScanHistoryRow({ ...datedOffer, postedAt: undefined }, '2026-07-09'));
  if (
    datedHistory.posted_at === '2026-06-18' && // epoch ms -> YYYY-MM-DD in the postedAt column
    datedHistory.normalized_company === 'acme' &&
    datedHistory.listing_key === '' &&
    noDateHistory.posted_at === '' && // missing postedAt -> empty column, never a bogus date
    noDateHistory.normalized_company === 'acme' &&
    noDateHistory.listing_key === ''
  ) {
    pass('scan-history writer appends postedAt as an ISO trailing column (empty when absent)');
  } else {
    fail(`scan-history postedAt column wrong: dated=${JSON.stringify(datedHistory)} / noDate=${JSON.stringify(noDateHistory)}`);
  }

  const datedPipeline = formatPipelineOffer(datedOffer);
  const noDatePipeline = formatPipelineOffer({ ...datedOffer, postedAt: undefined });
  const badDatePipeline = formatPipelineOffer({ ...datedOffer, postedAt: -1 });
  const nanDatePipeline = formatPipelineOffer({ ...datedOffer, postedAt: Number.NaN });
  if (
    datedPipeline === '- [ ] https://jobs.example.com/42 | Acme | Staff Engineer | Remote (US) | posted: 2026-06-18' &&
    noDatePipeline === '- [ ] https://jobs.example.com/42 | Acme | Staff Engineer | Remote (US)' &&
    badDatePipeline === noDatePipeline && // negative epoch → no segment (guarded)
    nanDatePipeline === noDatePipeline // NaN → no segment (guarded)
  ) {
    pass('pipeline writer appends a labeled posted: segment (omitted/byte-identical when date missing or invalid)');
  } else {
    fail(`pipeline postedAt segment wrong: dated="${datedPipeline}" / noDate="${noDatePipeline}" / bad="${badDatePipeline}" / nan="${nanDatePipeline}"`);
  }
  // ── pipeline sort order + [<24h] freshness tag ──
  const freshOffer = { ...datedOffer, url: 'https://jobs.example.com/fresh', postedAt: Date.now() - 60_000 };
  const freshPipeline = formatPipelineOffer(freshOffer);
  if (freshPipeline.endsWith('[<24h]') && !datedPipeline.includes('[<24h]')) {
    pass('pipeline writer tags a posting < 24h old with [<24h]; an old dated posting gets no tag');
  } else {
    fail(`freshness tag wrong: fresh="${freshPipeline}" / old="${datedPipeline}"`);
  }

  const oldA = { ...datedOffer, url: 'https://a', postedAt: Date.parse('2026-01-01T00:00:00Z') };
  const newB = { ...datedOffer, url: 'https://b', postedAt: Date.parse('2026-06-18T00:00:00Z') };
  const undatedC = { ...datedOffer, url: 'https://c', postedAt: undefined };
  const undatedD = { ...datedOffer, url: 'https://d', postedAt: undefined };
  const sorted = sortOffersByPostedAtDesc([oldA, undatedC, newB, undatedD]).map(o => o.url);
  if (sorted[0] === 'https://b' && sorted[1] === 'https://a' && sorted[2] === 'https://c' && sorted[3] === 'https://d') {
    pass('sortOffersByPostedAtDesc: freshest dated offer first, undated offers last in original relative order');
  } else {
    fail(`sortOffersByPostedAtDesc order wrong: ${JSON.stringify(sorted)}`);
  }
} catch (err) {
  fail(`scan.mjs posting-age / postedAt tests crashed: ${err.message}`);
}
