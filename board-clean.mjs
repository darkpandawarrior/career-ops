#!/usr/bin/env node
/**
 * board-clean.mjs — Purge non-Android-engineering false positives from pipeline.md.
 *
 * Aggregator / WebSearch scans periodically drag in postings whose title
 * matches "mobile" or "android" by accident but are NOT Android product
 * engineering roles: retail sales clerks ("Mobile Associate"), diesel/trailer
 * mechanics, vehicle inspectors, biomedical technicians, product/program
 * managers, QA/automation, MAUI/Xamarin, academic theses (Thèse CIFRE), etc.
 *
 * This classifies every OPEN (`- [ ]`) entry in data/pipeline.md against a
 * maintained keyword denylist (matched on the role-title field only) and:
 *   --dry-run (default)  prints a compact junk/keep report, writes nothing
 *   --apply              moves junk lines into an "## Off-topic (auto-purged)"
 *                        archive section at the end of the file AND appends a
 *                        row to data/scan-history.tsv with status skipped_offtopic
 *
 * Deterministic, zero-token, zero-network. Idempotent: a second --apply finds
 * nothing new (already-archived lines are not re-classified). Reversible: the
 * archived lines stay in the git-tracked file under their own heading; a backup
 * is also written to pipeline.md.bak.
 *
 * Run:
 *   node board-clean.mjs                 # dry-run report
 *   node board-clean.mjs --apply         # move junk to archive + log
 *   node board-clean.mjs --apply --quiet # apply with a one-line summary only
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveCareerOpsRoot } from './path-resolver.mjs';

// engineRoot = where this script and its siblings live; dataRoot = the ACTIVE
// profile's data (CAREER_OPS_ROOT). Data paths must use ROOT_DATA, never ROOT.
const { engineRoot: ROOT, dataRoot: ROOT_DATA } = resolveCareerOpsRoot(import.meta.url);
const PIPELINE_PATH = join(ROOT_DATA, 'data', 'pipeline.md');
const SCAN_HISTORY_PATH = join(ROOT_DATA, 'data', 'scan-history.tsv');
const ARCHIVE_HEADING = '## Off-topic (auto-purged)';
const SCAN_HISTORY_HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation';

const APPLY = process.argv.includes('--apply');
const QUIET = process.argv.includes('--quiet');

// ── Denylist ──────────────────────────────────────────────────────────────
// Each pattern is matched (case-insensitive) against the ROLE TITLE field only.
// Keep these as word-ish fragments — broad enough to catch variants, narrow
// enough not to nuke real Android roles. When a new junk class shows up in a
// scan, add it here rather than hand-editing pipeline.md.
const DENYLIST = [
  // Retail / field-service "mobile" that isn't software
  'Retail Sales', 'Mobile Associate', 'Vehicle Condition Inspector', 'Mobile Inspector',
  'Diesel Mechanic', 'Trailer Technician', 'Trailer Mechanic', 'ADAS Technician',
  'Biomedical Technician', 'Sales Representative',
  // Marketing / non-engineering leadership
  'Marketing Director', 'Conseiller',
  // Academic / research theses (FR)
  'Thèse', 'CIFRE',
  // QA / test / RE — not product engineering
  'Quality Engineer', 'Automation Test', 'Reverse Engineer',
  // Cross-platform stacks that aren't native Android
  'MAUI', 'Xamarin',
  // Product / program / growth management, not IC engineering
  'Product Manager', 'Product Owner', 'Product Lead', 'Program Manager',
  'Growth Lead', 'Tech Trainer', 'Digital Product',
  // People-management bands above IC scope
  'Engineering Manager', 'Senior Manager',
  // Non-English generalist titles that historically resolve to non-Android
  'Desenvolvedor', 'Desarrollador', 'Especialista',
  // Misc off-band / off-topic
  'Associate Engineer', 'Foundational Engineer', 'GITLAB',
];

// Pre-compile to a single case-insensitive alternation for speed + clarity.
const DENY_RE = new RegExp(
  '(' + DENYLIST.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')',
  'i',
);

// ── Pipeline line parsing ──────────────────────────────────────────────────
// Format:  - [ ] <url> | <Company> | <Role title>  <!-- annotations -->
// Role title is the 3rd pipe field, before any trailing HTML comment.

function parseOpenEntry(line) {
  if (!line.startsWith('- [ ]')) return null;
  const urlMatch = line.match(/https?:\/\/[^\s|)]+/);
  if (!urlMatch) return null;
  const url = urlMatch[0];

  // Strip the leading "- [ ] <url>" then split the remainder on pipes.
  const afterUrl = line.slice(line.indexOf(url) + url.length);
  const parts = afterUrl.split('|').map((s) => s.trim());
  // parts[0] is '' (the pipe right after the url), parts[1] company, parts[2] role(+comment)
  const company = (parts[1] || '').replace(/<!--.*$/, '').trim() || '—';
  let role = (parts[2] || '').replace(/<!--.*$/, '').trim();
  if (!role) role = (parts[1] || '').replace(/<!--.*$/, '').trim(); // url|Role form
  return { url, company, role };
}

function classify(entry) {
  if (!entry.role) return { junk: false, hit: null };
  const m = entry.role.match(DENY_RE);
  return { junk: !!m, hit: m ? m[1] : null };
}

function tsvCell(s) {
  // scan-history.tsv is tab-separated; never let a literal tab/newline leak in.
  return (s || '').replace(/[\t\r\n]/g, ' ').trim();
}

function today() {
  return new Date().toISOString().split('T')[0];
}

// ── Main ────────────────────────────────────────────────────────────────────

if (!existsSync(PIPELINE_PATH)) {
  console.error('data/pipeline.md not found. Nothing to clean.');
  process.exit(1);
}

const content = readFileSync(PIPELINE_PATH, 'utf-8');
const lines = content.split('\n');

// Only classify lines ABOVE the archive heading so a re-run is idempotent
// (already-purged entries are not reconsidered).
let archiveIdx = lines.findIndex((l) => l.trim() === ARCHIVE_HEADING);
const scanLimit = archiveIdx === -1 ? lines.length : archiveIdx;

const junk = []; // { lineIdx, entry, hit }
let openCount = 0;

for (let i = 0; i < scanLimit; i++) {
  const entry = parseOpenEntry(lines[i]);
  if (!entry) continue;
  openCount++;
  const { junk: isJunk, hit } = classify(entry);
  if (isJunk) junk.push({ lineIdx: i, entry, hit });
}

// ── Report ──────────────────────────────────────────────────────────────────

if (!QUIET) {
  console.log(`\nboard:clean — ${openCount} open item(s), ${junk.length} off-topic\n${'─'.repeat(56)}`);
  if (junk.length === 0) {
    console.log('✅ Board is clean — no off-topic open items.');
  } else {
    for (const { entry, hit } of junk) {
      const role = entry.role.length > 52 ? entry.role.slice(0, 49) + '…' : entry.role;
      console.log(`  ❌ [${hit}]  ${entry.company} — ${role}`);
    }
  }
}

if (junk.length === 0) {
  if (QUIET) console.log('board:clean — 0 off-topic');
  process.exit(0);
}

if (!APPLY) {
  if (!QUIET) {
    console.log(`${'─'.repeat(56)}`);
    console.log(`(dry-run — run with --apply to move ${junk.length} item(s) to "${ARCHIVE_HEADING}")`);
  } else {
    console.log(`board:clean — ${junk.length} off-topic (dry-run)`);
  }
  process.exit(0);
}

// ── Apply: backup, move junk lines to archive section, log to scan-history ──

copyFileSync(PIPELINE_PATH, PIPELINE_PATH + '.bak');

const junkIdx = new Set(junk.map((j) => j.lineIdx));
const movedLines = junk.map((j) => lines[j.lineIdx].replace(/^- \[ \]/, '- [x]'));

// Remove junk lines from their original position.
const kept = lines.filter((_, i) => !junkIdx.has(i));

// Locate (or create) the archive section in the kept lines and append there.
let out;
archiveIdx = kept.findIndex((l) => l.trim() === ARCHIVE_HEADING);
const stamp = `<!-- board:clean purge ${today()} — ${movedLines.length} off-topic item(s) -->`;
if (archiveIdx === -1) {
  out = [...kept];
  if (out.length && out[out.length - 1].trim() !== '') out.push('');
  out.push(ARCHIVE_HEADING, stamp, ...movedLines, '');
} else {
  // Insert right after the heading (newest purge first).
  out = [
    ...kept.slice(0, archiveIdx + 1),
    stamp,
    ...movedLines,
    ...kept.slice(archiveIdx + 1),
  ];
}

writeFileSync(PIPELINE_PATH, out.join('\n'));

// Append skipped_offtopic rows to scan-history.tsv (the durable audit log).
mkdirSync(dirname(SCAN_HISTORY_PATH), { recursive: true });
if (!existsSync(SCAN_HISTORY_PATH)) {
  writeFileSync(SCAN_HISTORY_PATH, SCAN_HISTORY_HEADER + '\n');
}
// Dedup against existing skipped_offtopic rows ONLY — a URL may already appear
// in history under a different status (added / skipped_location / …); we still
// want to record THIS off-topic purge, just not a second skipped_offtopic row.
const offtopicUrls = new Set(
  (existsSync(SCAN_HISTORY_PATH) ? readFileSync(SCAN_HISTORY_PATH, 'utf-8') : '')
    .split('\n')
    .filter((l) => l.includes('\tskipped_offtopic\t') || l.endsWith('\tskipped_offtopic'))
    .map((l) => l.split('\t')[0]),
);
const rows = junk
  .filter((j) => !offtopicUrls.has(j.entry.url))
  .map((j) =>
    [
      tsvCell(j.entry.url),
      today(),
      'board-clean',
      tsvCell(j.entry.role),
      tsvCell(j.entry.company),
      'skipped_offtopic',
      '',
    ].join('\t'),
  );
if (rows.length) appendFileSync(SCAN_HISTORY_PATH, rows.join('\n') + '\n');

if (QUIET) {
  console.log(`board:clean — moved ${movedLines.length} off-topic, logged ${rows.length}`);
} else {
  console.log(`${'─'.repeat(56)}`);
  console.log(`✅ Moved ${movedLines.length} off-topic item(s) → "${ARCHIVE_HEADING}"`);
  console.log(`   Logged ${rows.length} new row(s) to data/scan-history.tsv (skipped_offtopic)`);
  console.log(`   Backup: data/pipeline.md.bak`);
}
