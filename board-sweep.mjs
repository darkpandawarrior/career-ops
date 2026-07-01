#!/usr/bin/env node
/**
 * board-sweep.mjs — Liveness-sweep every open item in pipeline.md.
 *
 * The board accumulates open (`- [ ]`) postings over weeks; many quietly die
 * (filled, reposted, pulled). This walks every open entry and checks liveness.
 *
 * By default it uses ONLY the zero-token, zero-browser ATS API rung
 * (Greenhouse / Lever) — instant, no Playwright, no network risk beyond a
 * fixed-host GET. Non-ATS URLs (LinkedIn, instahyre, naukri, aggregators) are
 * reported as `skippable` (browser needed) and left untouched unless you pass
 * --browser, which falls back to the full Playwright liveness check for them.
 *
 *   node board-sweep.mjs                  # API-only sweep, compact report
 *   node board-sweep.mjs --browser        # also Playwright-check non-ATS URLs
 *   node board-sweep.mjs --mark           # mark confirmed-dead items - [x] ... | Dead (sweep <date>)
 *   node board-sweep.mjs --browser --mark # full check + mark
 *
 * Only definitively-expired items are ever marked. Uncertain/skippable items
 * are never touched. A backup is written to pipeline.md.bak before --mark.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { checkLivenessViaApi, isAtsPosting } from './liveness-api.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PIPELINE_PATH = join(ROOT, 'data', 'pipeline.md');
const ARCHIVE_HEADING = '## Off-topic (auto-purged)';

const USE_BROWSER = process.argv.includes('--browser');
const MARK = process.argv.includes('--mark');

function today() {
  return new Date().toISOString().split('T')[0];
}

function parseOpenLine(line) {
  if (!line.startsWith('- [ ]')) return null;
  const urlMatch = line.match(/https?:\/\/[^\s|)]+/);
  if (!urlMatch) return null;
  const afterUrl = line.slice(line.indexOf(urlMatch[0]) + urlMatch[0].length);
  const parts = afterUrl.split('|').map((s) => s.trim());
  const company = (parts[1] || '').replace(/<!--.*$/, '').trim() || '—';
  return { url: urlMatch[0], company };
}

if (!existsSync(PIPELINE_PATH)) {
  console.error('data/pipeline.md not found. Nothing to sweep.');
  process.exit(1);
}

const content = readFileSync(PIPELINE_PATH, 'utf-8');
const lines = content.split('\n');
// Don't sweep the auto-purged archive section (those are already closed - [x]).
const archiveIdx = lines.findIndex((l) => l.trim() === ARCHIVE_HEADING);
const limit = archiveIdx === -1 ? lines.length : archiveIdx;

const open = [];
for (let i = 0; i < limit; i++) {
  const e = parseOpenLine(lines[i]);
  if (e) open.push({ ...e, lineIdx: i });
}

console.log(`\nboard:sweep — ${open.length} open item(s)`);
console.log(`Mode: ${USE_BROWSER ? 'API + Playwright fallback' : 'API-only (zero-token, zero-browser)'}\n${'─'.repeat(56)}`);

let active = 0, expired = 0, uncertain = 0, skippable = 0;
const dead = []; // line indices confirmed expired

// Lazy Playwright — only spun up if --browser and a non-ATS URL needs it.
let browser = null, page = null, browserLib = null;
async function ensureBrowser() {
  if (browser) return;
  const { chromium } = await import('playwright');
  const { newLivenessPage } = await import('./liveness-browser.mjs');
  browserLib = chromium;
  browser = await chromium.launch({ headless: true });
  page = await newLivenessPage(browser);
}

for (const item of open) {
  let result, reason, via;

  const api = await checkLivenessViaApi(item.url);
  if (api) {
    ({ result, reason } = api);
    via = 'api';
  } else if (USE_BROWSER) {
    await ensureBrowser();
    const { checkUrlLivenessWithFallback } = await import('./liveness-browser.mjs');
    ({ result, reason } = await checkUrlLivenessWithFallback(page, item.url, {}));
    via = 'browser';
  } else {
    // Non-ATS and no browser requested → can't decide cheaply.
    skippable++;
    continue;
  }

  const icon = { active: '✅', expired: '❌', uncertain: '⚠️' }[result] || '⚠️';
  if (result === 'active') active++;
  else if (result === 'expired') { expired++; dead.push(item.lineIdx); }
  else uncertain++;

  if (result !== 'active') {
    console.log(`  ${icon} ${result.padEnd(9)} (${via}) ${item.company} — ${item.url}`);
    if (reason) console.log(`        ${reason}`);
  }
}

if (browser) await browser.close();

console.log(`${'─'.repeat(56)}`);
console.log(
  `Results: ${active} active  ${expired} expired  ${uncertain} uncertain` +
    (skippable ? `  ${skippable} need-browser (re-run with --browser)` : ''),
);

// ── Mark dead items ──────────────────────────────────────────────────────────
if (MARK && dead.length > 0) {
  copyFileSync(PIPELINE_PATH, PIPELINE_PATH + '.bak');
  const deadSet = new Set(dead);
  const out = lines.map((line, i) => {
    if (!deadSet.has(i)) return line;
    // Flip - [ ] → - [x] and append a Dead disposition if not already present.
    let marked = line.replace(/^- \[ \]/, '- [x]');
    if (!/\|\s*Dead\b/i.test(marked)) marked += ` | Dead (sweep ${today()})`;
    return marked;
  });
  writeFileSync(PIPELINE_PATH, out.join('\n'));
  console.log(`✅ Marked ${dead.length} confirmed-dead item(s) - [x] (backup: data/pipeline.md.bak)`);
} else if (MARK) {
  console.log('No confirmed-dead items to mark.');
} else if (dead.length > 0) {
  console.log(`(run with --mark to close ${dead.length} confirmed-dead item(s))`);
}
