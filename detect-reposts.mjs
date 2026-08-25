#!/usr/bin/env node
/**
 * detect-reposts.mjs — Repost Detector for career-ops
 *
 * Reads data/scan-history.tsv, groups rows by company, fuzzy-matches role
 * titles with roleFuzzyMatch from role-matcher.mjs, and flags any
 * company+role that appears 2+ times with different URLs within a 90-day
 * window. Such clusters are almost certainly the same opening being
 * re-listed by the employer — useful for tracking stale pipelines and
 * ghost postings.
 *
 * Only rows with status `added` are considered. Rows with a non-`added`
 * status (`skipped_expired`, `skipped_invalid_url`, `skipped_blocked_host`)
 * describe dead postings, not reposts, and are skipped.
 *
 * AGGREGATOR SKIP (#2703): a multi-employer board (e.g. a jobs aggregator)
 * carries many different employers' postings under its own name, so an
 * identical title there is genuinely a different job, not a repost — the one
 * case every rule above assumes cannot happen. Mark such an entry
 * `aggregator: true` in portals.yml (under `tracked_companies` or
 * `job_boards`) and detectReposts() skips it entirely — see
 * loadAggregatorCompanies / companyKey.
 *
 * Run: node detect-reposts.mjs             (JSON to stdout)
 *      node detect-reposts.mjs --summary   (human-readable table)
 *      node detect-reposts.mjs --window 60 (override 90-day window)
 *      node detect-reposts.mjs --self-test
 *      node detect-reposts.mjs --help
 *
 * Issue #1205 — github.com/santifer/career-ops
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
// Namespace import, not default: js-yaml 5.x drops the default export (#2656).
import * as yaml from 'js-yaml';

import { roleFuzzyMatch, roleTokens, BASELINE_TOKENS } from './role-matcher.mjs';
import { normalizeCompanyName } from './invite-match.mjs';
import { resolveCareerOpsRoot } from './path-resolver.mjs';
import { flagValue, validateFlags, safeIntFlag } from './lib/cli-flags.mjs';

// engineRoot = where this script and its siblings live; dataRoot = the ACTIVE
// profile's data (CAREER_OPS_ROOT), which is a different directory under the
// multi-profile setup. Data paths below must use CAREER_OPS_DATA, never CAREER_OPS.
const { engineRoot: CAREER_OPS, dataRoot: CAREER_OPS_DATA } = resolveCareerOpsRoot(import.meta.url);
const SCAN_HISTORY_PATH = join(CAREER_OPS_DATA, 'data/scan-history.tsv');
// Same override scan.mjs honours, so a sandboxed run points both at one config.
const PORTALS_PATH = process.env.CAREER_OPS_PORTALS || join(CAREER_OPS_DATA, 'portals.yml');
const DEFAULT_WINDOW_DAYS = 90;
// Smallest first_seen span a cluster may have and still count as a repost.
// ponytail: only the aggregator-skip half of upstream's phantom-repost fix is
// ported here (title-identity clustering and a real --min-span floor are
// not) — nothing currently calling this needs them. 0 (never enforced) keeps
// every existing caller's output byte-identical; the `minSpan` parameter
// threaded below exists only so detectReposts' 4th positional arg
// (`aggregators`) lands where the aggregator-skip feature needs it. Add
// --min-span / raise this default if same-sweep false positives show up here.
const MIN_REPOST_SPAN_DAYS = 0;

// --- CLI args ---

const KNOWN_FLAGS = ['--window', '--summary', '--self-test', '--help', '-h'];
const VALUE_FLAGS = ['--window'];

const USAGE = `Usage:
  node detect-reposts.mjs                       # full JSON repost clusters to stdout
  node detect-reposts.mjs --summary             # human-readable table
  node detect-reposts.mjs --window 60           # override the default 90-day window
  node detect-reposts.mjs --self-test           # run the in-memory test suite
  node detect-reposts.mjs --help                # print this usage block and exit`;

const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const selfTestMode = args.includes('--self-test');
const windowValue = flagValue(args, '--window');
// safeIntFlag, not parseInt: parseInt reads "7abc" as 7 and "-5" as -5, so a typo silently became
// a plausible window instead of falling back. The shared helper requires the whole string to be a
// non-negative integer.
const windowDays = safeIntFlag(windowValue, DEFAULT_WINDOW_DAYS);

// --- Date helpers ---
function parseDate(dateStr) {
  const iso = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return null;
  return date;
}

function daysBetween(d1, d2) {
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

// --- Parse scan-history.tsv ---
// Format: url, first_seen, portal, title, company, status, location, ...,
//         normalized_company (trailing col 12 — not currently written by this
//         fork's scan.mjs, so normCompany is '' on every real row today;
//         companyKey() falls back to normalizing the raw company name in that
//         case, which is the same result this always produced before).
export function parseScanHistory(content) {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];
  const rows = [];
  // Only skip the header when it actually looks like one — older
  // headerless scan-history.tsv files and the seed file in the repo
  // don't have a header row, and slice(1) would silently lose row 0.
  const hasHeader = /^\s*url\s*\t/i.test(lines[0]);
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const cols = line.split('\t');
    if (cols.length < 5) continue;
    const [url, firstSeen, portal = '', title = '', company = '', status = 'added', location = ''] = cols;
    const date = parseDate(firstSeen);
    if (!url || !date) continue;
    rows.push({
      url: url.trim(),
      date,
      dateStr: firstSeen.trim(),
      portal: portal.trim(),
      title: title.trim(),
      company: company.trim(),
      status: (status || 'added').trim(),
      location: (location || '').trim(),
      normCompany: (cols[11] || '').trim(),
    });
  }
  return rows;
}

// Canonical clustering/lookup key for a row's company. Prefers the stored
// normalized-company column (see parseScanHistory) so old and new rows still
// cluster on the same key; falls back to normalizing the raw company name for
// rows without that column (every real row today) and for hand-built row
// objects (e.g. tests). A final fallback to the raw lowercased name preserves
// this for names that fold to empty under normalizeCompanyName.
export function companyKey(row) {
  const stored = typeof row.normCompany === 'string' ? row.normCompany.trim() : '';
  const raw = typeof row.company === 'string' ? row.company.trim() : '';
  return stored || normalizeCompanyName(raw) || raw.toLowerCase();
}

// Companies the user has marked `aggregator: true` in portals.yml, as a Map of
// companyKey()-space key -> the raw name as written in portals.yml (a Map, not
// a bare Set, so a reader — e.g. company-history.mjs's card title — sees the
// original name rather than the normalized key). Checked under BOTH
// `tracked_companies` and `job_boards`, since a multi-employer board is at
// least as likely to live under the latter.
//
// portals.yml is a USER-LAYER file and may be absent (fresh install, sandboxed
// test, CI). Absent, unreadable or malformed all degrade to an empty Map —
// this must never crash the detector over an optional config. See #2703.
export function loadAggregatorCompanies(portalsPath = PORTALS_PATH) {
  const found = new Map();
  try {
    if (!existsSync(portalsPath)) return found;
    const doc = yaml.load(readFileSync(portalsPath, 'utf-8'));
    for (const entries of [doc?.tracked_companies, doc?.job_boards]) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry || entry.aggregator !== true) continue;
        const raw = typeof entry.name === 'string' ? entry.name.trim() : '';
        if (!raw) continue;
        const key = normalizeCompanyName(raw) || raw.toLowerCase();
        if (key && !found.has(key)) found.set(key, raw);
      }
    }
  } catch {
    return found;
  }
  return found;
}

// Set or Map — both answer .has(key), and every caller here only asks that.
export function isKeyLookup(value) {
  return value instanceof Set || value instanceof Map;
}

function loadScanHistory(path = SCAN_HISTORY_PATH) {
  if (!existsSync(path)) return [];
  return parseScanHistory(readFileSync(path, 'utf-8'));
}

// --- Core detection ---
//
// Group rows by company key (companyKey — case-insensitive, normalized), then
// within each company group compare all pairs of titles via roleFuzzyMatch.
// Build clusters of matching rows with union-find, then keep a cluster only if
// (a) it contains 2+ rows, (b) at least two rows have different URLs, (c) the
// cluster's first_seen dates all fall within `windowDays` of each other, and
// (d) that span is at least `minSpan` days (rejects same-sweep concurrent
// openings from counting as a repost of themselves).
//
// `aggregators` (optional, see loadAggregatorCompanies) is a Set/Map of
// companyKey()-space keys to skip entirely — a multi-employer board's
// identical titles are different employers' jobs, not reposts (#2703).
//
// Exported so external tests can call detectReposts() directly on a row list.
export function detectReposts(rows, windowDays = DEFAULT_WINDOW_DAYS, minSpan = MIN_REPOST_SPAN_DAYS, aggregators = null) {
  if (!Array.isArray(rows)) return [];
  const valid = rows
    .filter(r =>
      r &&
      typeof r === 'object' &&
      r.status === 'added' &&
      typeof r.url === 'string' && r.url.trim() &&
      r.date instanceof Date &&
      !Number.isNaN(r.date.getTime()) &&
      typeof r.company === 'string' && r.company.trim() &&
      typeof r.title === 'string' && r.title.trim()
    )
    .map(r => ({
      ...r,
      url: r.url.trim(),
      company: r.company.trim(),
      title: r.title.trim(),
    }));
  if (valid.length < 2) return [];

  // Group by normalized company key (companyKey), not the raw name — this is
  // what lets "Acme Inc." and "Acme" cluster as one company.
  const byCompany = new Map();
  for (const row of valid) {
    const key = companyKey(row);
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(row);
  }

  const skip = isKeyLookup(aggregators) ? aggregators : null;

  const clusters = [];
  for (const [key, groupRows] of byCompany) {
    if (groupRows.length < 2) continue;
    if (skip && skip.has(key)) continue;
    clusters.push(...detectRepostsInGroup(groupRows, windowDays, minSpan));
  }
  return clusters.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
}

// Cluster rows in a single company group. Rows are first grouped by title
// (exact or fuzzy match), then each title group is sorted by date and a
// sliding window finds sub-clusters within the windowDays span. This two-phase
// approach prevents non-matching roles (e.g. a Product Manager between two
// Backend Engineer postings) from breaking a valid repost cluster.
function detectRepostsInGroup(rows, windowDays, minSpan = MIN_REPOST_SPAN_DAYS) {
  const titleGroups = groupRowsByTitle(rows);

  const results = [];
  for (const group of titleGroups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (a.date < b.date ? -1 : 1));
    let cluster = [];

    for (const row of sorted) {
      if (cluster.length === 0) {
        cluster = [row];
        continue;
      }
      const first = cluster[0];
      const span = daysBetween(first.date, row.date);
      if (span <= windowDays) {
        cluster.push(row);
      } else {
        // Span exceeds window. Seal the current cluster if it has 2+ rows,
        // then slide the window: drop the oldest row(s) until the new row
        // fits within windowDays of the new cluster start. This preserves
        // valid overlapping repost pairs that would otherwise be dropped
        // (e.g. Jan 1 + Mar 15 sealed, but Mar 15 + Jun 10 also valid).
        if (cluster.length >= 2) {
          const result = buildRepostCluster(cluster, windowDays, minSpan);
          if (result) results.push(result);
        }
        cluster = cluster.filter(c => daysBetween(c.date, row.date) <= windowDays);
        cluster.push(row);
      }
    }
    if (cluster.length >= 2) {
      const result = buildRepostCluster(cluster, windowDays, minSpan);
      if (result) results.push(result);
    }
  }
  return results;
}

// Group one company's rows into title groups: a seed row plus every later row
// whose title matches it (exact, case-insensitively, or via roleFuzzyMatch).
//
// The obvious implementation is a nested loop over rows, and that is what this
// used to be. It degrades badly on the shape scan-history.tsv actually grows
// into: the file is append-only with one row per scanned posting, so a large
// employer accumulates thousands of DISTINCT titles. Nothing collapses, every
// pair pays a full roleFuzzyMatch (which re-tokenizes both strings on every
// call), and the run goes quadratic with a very expensive constant (#2383).
//
// Two structures replace the nested loop without changing what it computes:
//
//   1. Rows are bucketed by their lowercased title in one pass. Every row in a
//      bucket matches every other by the exact-title arm of the old condition,
//      so a bucket is atomic: a seed either takes the whole bucket or none of
//      it. Exact reposts (the overwhelming majority of real ones) therefore
//      collapse in O(N) with no fuzzy calls at all, and toLowerCase() runs once
//      per row instead of once per comparison.
//
//   2. Fuzzy matching then runs over DISTINCT buckets only, and even there is
//      gated by an inverted index over non-baseline tokens. roleFuzzyMatch can
//      only return true for two non-identical titles when their deduped token
//      sets share at least two tokens, at least one of which is not a
//      BASELINE_TOKENS word, and their Jaccard ratio is >= 0.6. All three are
//      necessary conditions and all three are checked exactly here, so any
//      bucket pair the gate drops is one roleFuzzyMatch would have rejected
//      anyway. The gate filters calls, never verdicts: every surviving pair is
//      still decided by roleFuzzyMatch itself.
//
// Ordering is preserved exactly, because it is load-bearing downstream. The
// date sort in detectRepostsInGroup uses a comparator that returns 1 (not 0)
// for equal dates, so same-date rows keep their input order only if the group
// arrives in input order; buildRepostCluster also reads clusterRows[0].company.
// Groups are therefore emitted in seed order and their rows re-sorted by
// original array position, which is what the nested loop produced: the seed is
// always the first not-yet-used row, and the inner loop appended the rest in
// array order.
function groupRowsByTitle(rows) {
  // Pass 1 — bucket by lowercased title, remembering each row's original
  // position so groups can be rebuilt in input order later.
  const buckets = [];
  const bucketOfKey = new Map();
  for (let i = 0; i < rows.length; i++) {
    const key = rows[i].title.toLowerCase();
    let idx = bucketOfKey.get(key);
    if (idx === undefined) {
      idx = buckets.length;
      bucketOfKey.set(key, idx);
      // The representative title is the FIRST row's raw title, which is also
      // the row the nested loop would have used as the seed. Other rows in the
      // bucket differ from it only in case, and every decision roleFuzzyMatch
      // makes runs on lowercased text, so the choice cannot change a verdict.
      buckets.push({ title: rows[i].title, rowIdx: [], tokens: null, tokenSet: null });
    }
    buckets[idx].rowIdx.push(i);
  }

  // Single distinct title: the nested loop would have made one group of
  // everything. Skip the index entirely.
  if (buckets.length === 1) return [buckets[0].rowIdx.map(i => rows[i])];

  // Pass 2 — tokenize each distinct title once, then index DISCRIMINATING
  // token -> buckets. Baseline tokens are deliberately left out of the index:
  // words like "engineer" or "platform" appear in most titles at a company, so
  // indexing them would build one enormous posting list that has to be walked
  // for every seed and can never, on its own, justify a match.
  const postings = new Map();
  for (let b = 0; b < buckets.length; b++) {
    const tokens = [...new Set(roleTokens(buckets[b].title))];
    buckets[b].tokens = tokens;
    buckets[b].tokenSet = new Set(tokens);
    for (const token of tokens) {
      if (BASELINE_TOKENS.has(token)) continue;
      let list = postings.get(token);
      if (!list) { list = []; postings.set(token, list); }
      list.push(b);
    }
  }

  // Pass 3 — seed buckets in first-appearance order, gathering matches.
  const used = new Uint8Array(buckets.length);
  const seen = new Uint8Array(buckets.length);
  const candidates = [];
  const groups = [];

  for (let seed = 0; seed < buckets.length; seed++) {
    if (used[seed]) continue;
    used[seed] = 1;
    const members = [seed];
    const seedTokens = buckets[seed].tokens;

    // Collect every bucket sharing at least one discriminating token with the
    // seed. A bucket that shares none cannot match: roleFuzzyMatch requires a
    // non-baseline word in the overlap, so it would return false without ever
    // being asked.
    for (const token of seedTokens) {
      const list = postings.get(token);
      if (!list) continue;
      for (const b of list) {
        if (b === seed || used[b] || seen[b]) continue;
        seen[b] = 1;
        candidates.push(b);
      }
    }

    // Ascending bucket order keeps the candidate walk deterministic. It cannot
    // change the outcome — each candidate is tested against the seed alone —
    // but it makes the traversal reproducible run to run.
    candidates.sort((a, b) => a - b);
    for (const b of candidates) {
      seen[b] = 0;
      // Exact overlap over the deduped token sets, then the exact Jaccard
      // ratio |A n B| / |A u B| with |A u B| = |A| + |B| - |A n B|. Both are
      // the same numbers roleFuzzyMatch computes; failing either is a verdict
      // it would have reached itself.
      const candSet = buckets[b].tokenSet;
      let overlap = 0;
      for (const token of seedTokens) if (candSet.has(token)) overlap += 1;
      if (overlap < 2) continue;
      const union = seedTokens.length + buckets[b].tokens.length - overlap;
      if (overlap / union < 0.6) continue;
      if (roleFuzzyMatch(buckets[seed].title, buckets[b].title)) {
        used[b] = 1;
        members.push(b);
      }
    }
    candidates.length = 0;

    if (members.length === 1) {
      groups.push(buckets[seed].rowIdx.map(i => rows[i]));
      continue;
    }
    // Appended one index at a time rather than spread: a pathological history
    // can put a very large number of rows into a single bucket, and a spread
    // that wide overflows the argument stack.
    const merged = [];
    for (const b of members) for (const i of buckets[b].rowIdx) merged.push(i);
    merged.sort((a, b) => a - b);
    groups.push(merged.map(i => rows[i]));
  }

  return groups;
}

// A fuzzy-matched cluster becomes a repost cluster only when (a) at least two
// distinct URLs are present (same URL means a dedup hit, not a repost), (b)
// every row's first_seen date falls within windowDays of every other row, and
// (c) the span between the earliest and latest first_seen is at least
// minSpan days — a same-sweep pair (span 0) is two concurrent openings the
// scanner saw at once, not one opening re-listed later. Rows sharing the same
// URL are collapsed (only the earliest sighting is kept) so a URL seen on
// multiple scan dates doesn't inflate the repost count.
function buildRepostCluster(clusterRows, windowDays, minSpan = MIN_REPOST_SPAN_DAYS) {
  const byUrl = new Map();
  for (const row of clusterRows) {
    if (!byUrl.has(row.url) || row.date < byUrl.get(row.url).date) {
      byUrl.set(row.url, row);
    }
  }
  const deduped = [...byUrl.values()];

  if (deduped.length < 2) return null;

  const sorted = [...deduped].sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = daysBetween(first.date, last.date);
  if (span > windowDays) return null;
  if (span < minSpan) return null;

  const role = last.title;
  const appearances = sorted.map(r => ({ url: r.url, date: r.dateStr, title: r.title }));

  return {
    company: clusterRows[0].company,
    role,
    repostCount: appearances.length,
    firstSeen: first.dateStr,
    lastSeen: last.dateStr,
    daysSpan: span,
    appearances,
  };
}

// --- Summary mode ---
function printSummary(clusters) {
  console.log(`\n${'='.repeat(78)}`);
  console.log('  Repost Detector — career-ops');
  console.log(`  window: ${windowDays} days | clusters: ${clusters.length}`);
  console.log(`${'='.repeat(78)}\n`);

  if (clusters.length === 0) {
    console.log('  No reposted roles detected.\n');
    return;
  }

  const header =
    '  ' +
    'Company'.padEnd(22) +
    'Role'.padEnd(34) +
    'Reposts'.padEnd(9) +
    'Span'.padEnd(12) +
    'First → Last';
  console.log(header);
  console.log('  ' + '-'.repeat(90));

  for (const c of clusters) {
    const company = (c.company || '').substring(0, 20).padEnd(22);
    const role = (c.role || '').substring(0, 32).padEnd(34);
    const reposts = String(c.repostCount).padEnd(9);
    const span = `${c.daysSpan}d`.padEnd(12);
    const range = `${c.firstSeen} → ${c.lastSeen}`;
    console.log('  ' + company + role + reposts + span + range);
  }
  console.log('');
}

// --- Self-test ---
function runSelfTest() {
  const baseRows = [
    // Genuine repost: same role, different URL, within 90 days.
    { url: 'https://acme.com/jobs/sre-1', date: parseDate('2024-01-10'), dateStr: '2024-01-10', title: 'Senior Site Reliability Engineer', company: 'Acme', status: 'added', portal: 'greenhouse', location: '' },
    { url: 'https://acme.com/jobs/sre-2', date: parseDate('2024-03-01'), dateStr: '2024-03-01', title: 'Senior Site Reliability Engineer', company: 'Acme', status: 'added', portal: 'greenhouse', location: '' },
    // Distinct role at the same company — must NOT be flagged.
    { url: 'https://acme.com/jobs/eng-mgr', date: parseDate('2024-02-15'), dateStr: '2024-02-15', title: 'Engineering Manager Platform', company: 'Acme', status: 'added', portal: 'greenhouse', location: '' },
    // Same role + same URL — dedup hit, NOT a repost.
    { url: 'https://acme.com/jobs/sre-1', date: parseDate('2024-03-20'), dateStr: '2024-03-20', title: 'Senior Site Reliability Engineer', company: 'Acme', status: 'added', portal: 'greenhouse', location: '' },
    // Same role + different URL but outside 90-day window — NOT flagged.
    { url: 'https://acme.com/jobs/sre-3', date: parseDate('2024-12-01'), dateStr: '2024-12-01', title: 'Senior Site Reliability Engineer', company: 'Acme', status: 'added', portal: 'greenhouse', location: '' },
    // Skipped (expired) row — must be ignored entirely.
    { url: 'https://acme.com/jobs/sre-4', date: parseDate('2024-02-01'), dateStr: '2024-02-01', title: 'Senior Site Reliability Engineer', company: 'Acme', status: 'skipped_expired', portal: 'greenhouse', location: '' },
  ];

  const clusters = detectReposts(baseRows, DEFAULT_WINDOW_DAYS);

  let pass = 0;
  let fail = 0;
  const check = (cond, label) => {
    if (cond) { pass += 1; } else { fail += 1; console.error(`  FAIL: ${label}`); }
  };

  // The genuine repost cluster (sre-1 on 2024-01-10, sre-2 on 2024-03-01).
  const repostClusters = clusters.filter(c =>
    c.company === 'Acme' &&
    /Site Reliability/.test(c.role) &&
    c.appearances.some(a => a.url === 'https://acme.com/jobs/sre-1') &&
    c.appearances.some(a => a.url === 'https://acme.com/jobs/sre-2')
  );
  check(repostClusters.length === 1, 'genuine repost (same role, different URL, within 90d) should be flagged');

  // The "same URL" row (sre-1 on 2024-03-20) must NOT inflate the cluster with
  // itself as a separate appearance — it collapses onto the sre-1 edge.
  if (repostClusters.length === 1) {
    const urls = repostClusters[0].appearances.map(a => a.url);
    check(new Set(urls).size === urls.length, 'appearances should not duplicate the same URL within one cluster');
    check(repostClusters[0].repostCount === 2, 'repostCount should be 2 for the genuine cluster (sre-1, sre-2)');
  }

  // The distinct Engineering Manager role must NOT appear in any cluster.
  const mgrClusters = clusters.filter(c => /Engineering Manager/.test(c.role));
  check(mgrClusters.length === 0, 'distinct role at the same company should NOT be flagged');

  // The outside-window row (sre-3 on 2024-12-01) must NOT be in the 90-day cluster.
  const sre3Clusters = clusters.filter(c => c.appearances.some(a => a.url === 'https://acme.com/jobs/sre-3'));
  check(sre3Clusters.length === 0, 'same role + different URL but outside 90-day window should NOT be flagged');

  // The skipped_expired row must never appear.
  const expiredClusters = clusters.filter(c => c.appearances.some(a => a.url === 'https://acme.com/jobs/sre-4'));
  check(expiredClusters.length === 0, 'rows with skipped_expired status must be ignored');

  // Empty input -> empty output, no crash.
  check(detectReposts([], DEFAULT_WINDOW_DAYS).length === 0, 'empty input should return no clusters');
  check(detectReposts(baseRows.filter(r => r.status !== 'added'), DEFAULT_WINDOW_DAYS).length === 0, 'only-skipped rows should return no clusters');

  console.log(`\n  detect-reposts self-test: ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

// --- Run (CLI only; guarded so the module is safely importable for tests) ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Replaces a bare --help check that never looked at the other flags, so a
  // mistyped --window was ignored and the scan silently used the 90-day
  // default instead of the window that was asked for (#2919). validateFlags
  // also runs the unrecognized-flag check BEFORE --help, so `--help --bogus`
  // errors rather than exiting 0 unread.
  //
  // Inside the main-module guard, not at import time: company-history.mjs
  // imports detectReposts/parseScanHistory from here, so a top-level check
  // would judge the IMPORTER's argv.
  //
  // requireOperand: without it, `--window --summary` reads --summary as the
  // window value; flagValue() has no adjacency check, parseInt('--summary')
  // is NaN, and windowDays silently falls back to DEFAULT_WINDOW_DAYS at exit
  // 0 instead of reporting the malformed flag (#3087).
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });

  if (selfTestMode) {
    runSelfTest();
  }

  const rows = loadScanHistory();
  const aggregators = loadAggregatorCompanies();
  const clusters = detectReposts(rows, windowDays, MIN_REPOST_SPAN_DAYS, aggregators);

  if (summaryMode) {
    printSummary(clusters);
  } else {
    console.log(JSON.stringify({
      metadata: {
        windowDays,
        totalRows: rows.length,
        // Distinguishes "no aggregators configured" from "configured and
        // skipped" — a mis-keyed flag that silently matches nothing would
        // otherwise look identical to a working one.
        aggregatorCompanies: aggregators.size,
        clusters: clusters.length,
      },
      clusters,
    }, null, 2));
  }
}