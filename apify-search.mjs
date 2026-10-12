#!/usr/bin/env node

/**
 * apify-search.mjs — broad, query-driven job search across LinkedIn, Indeed,
 * Glassdoor, and Wellfound via paid Apify actors.
 *
 * This is NOT a per-company provider (see providers/*.mjs and the generic
 * plugins/apify/ keyed provider for that). It's a "search by role + location
 * across whole boards" capability — the deterministic/scripted counterpart to
 * modes/discover.md's AI-search, using Apify's REST API instead of an LLM.
 *
 * COSTS REAL MONEY per run (a few cents to a couple dollars). OFF BY DEFAULT:
 * only runs when invoked with `node apify-search.mjs` directly, via
 * `node scan.mjs --apify`, or when broad_search.enabled: true in profile.yml
 * AND one of those entrypoints is used — importing this module does nothing
 * by itself (no top-level network calls, no dotenv side effects beyond the
 * same optional-guard pattern scan.mjs uses).
 *
 * Reuses plugins/apify/_apify.mjs's runActor() for the actual REST calls
 * (token handling, retries, timeout/deadline budget) rather than re-issuing
 * raw fetch() against api.apify.com — that client is already built and tested
 * by the generic apify provider plugin.
 *
 * Usage:
 *   node apify-search.mjs                  # run broad search per profile.yml / defaults
 *   node apify-search.mjs --dry-run        # preview without writing files
 */

import { existsSync, readFileSync } from 'fs';
import { isMainModule } from './lib/is-main-module.mjs';
import path from 'path';
import * as yaml from 'js-yaml';
import { pathToFileURL } from 'url';

try {
  const { config } = await import('dotenv');
  config();
} catch {
  // dotenv is optional — fall back to process.env if not installed
}

import { runActor } from './plugins/apify/_apify.mjs';
import { appendToPipeline, loadSeenUrls } from './scan.mjs';
import { resolveCareerOpsRoot } from './path-resolver.mjs';

const { dataRoot: CAREER_OPS_DATA } = resolveCareerOpsRoot(import.meta.url);
const PROFILE_PATH = process.env.CAREER_OPS_PROFILE || path.join(CAREER_OPS_DATA, 'config/profile.yml');

// ── Actor catalog (fixed, per user research — do not re-guess IDs) ─────────

// Rough per-result USD cost, used only to print an estimate before spending —
// not billed by this script; Apify bills the actual run. Ballpark figures from
// each actor's pricing page; deliberately conservative (rounds up) so the
// printed estimate is a ceiling, not a lowball.
//
// `id` is the owner/name slug, not the opaque actor ID (e.g. hKByXkMQaC5Qt9UMN
// for LinkedIn) — plugins/apify/_apify.mjs's runActor()/normalizeActorId()
// only accepts "owner/actor" or "owner~actor", not a bare platform ID, so the
// slug form is what's actually usable here. Both resolve to the identical
// actor (confirmed live: hKByXkMQaC5Qt9UMN's fullName is this slug).
const ACTORS = {
  linkedin: { id: 'curious_coder/linkedin-jobs-scraper', costPerResult: 0.01 },
  // kaix/indeed-scraper over valig/indeed-jobs-scraper: near-identical price
  // (~$0.00008/job vs $0.0001) but 60+ fields vs a handful — richer data at
  // effectively the same cost. Smaller user base than valig (1.4k vs 15.9k),
  // but both actors' own reliability numbers were high; live-verified below.
  indeed: { id: 'kaix/indeed-scraper', costPerResult: 0.005 },
  glassdoor: { id: 'valig/glassdoor-jobs-scraper', costPerResult: 0.01 },
  wellfound: { id: 'crawlerbros/wellfound-scraper', costPerResult: 0.01 },
};

const PLATFORMS = Object.keys(ACTORS);

// Hard spend guardrail — applies regardless of what config/CLI asks for.
// ponytail: fixed ceiling, not per-platform tunable; raise here if a future
// plan genuinely needs more than 50 results/platform per run.
const MAX_RESULTS_PER_PLATFORM = 50;

const DEFAULT_MAX_RESULTS = 10;

function loadBroadSearchConfig() {
  if (!existsSync(PROFILE_PATH)) return {};
  try {
    const raw = yaml.load(readFileSync(PROFILE_PATH, 'utf-8')) || {};
    return raw.broad_search || {};
  } catch {
    return {};
  }
}

// ── LinkedIn search URL builder ─────────────────────────────────────────────

export function buildLinkedInSearchUrl(role, location) {
  const params = new URLSearchParams();
  if (role) params.set('keywords', role);
  if (location) params.set('location', location);
  params.set('f_TPR', 'r604800'); // last 7 days
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

// ── Per-platform input builders ──────────────────────────────────────────────

function buildInput(platform, { role, location, count }) {
  switch (platform) {
    case 'linkedin':
      // The actor hard-rejects count < 10 ("Field input.count must be >= 10",
      // confirmed via a live call) — clamp up rather than fail the whole run.
      return { urls: [buildLinkedInSearchUrl(role, location)], scrapeCompany: false, count: Math.max(count, 10) };
    case 'indeed':
      // kaix's schema differs from the previously-used valig actor: keyword/
      // maxItems/fromDays, not title/limit/datePosted (same enum values though).
      return { country: 'IN', keyword: role, location, maxItems: count, fromDays: '7' };
    case 'glassdoor':
      return { keywords: role, location, daysOld: 7, limit: count };
    case 'wellfound':
      return { startUrls: ['https://wellfound.com/jobs'], keyword: role, location, maxItems: count };
    default:
      throw new Error(`apify-search: unknown platform ${platform}`);
  }
}

// ── Per-platform normalization → the same Job shape scan.mjs providers use
//    ({title, url, company, location}) ──────────────────────────────────────

function pick(...vals) {
  for (const v of vals) {
    if (v != null && v !== '') return String(v);
  }
  return '';
}

// Dotted-path getter for nested actor fields (Indeed/Glassdoor nest location
// under location.*, employer under employer.name — confirmed against real
// dataset items, see apify-search verification notes).
function at(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// Field names below were confirmed against REAL dataset items from each actor
// (not guessed from docs alone) — see verification notes. Each actor's shape
// is genuinely different; no shared field_map like the generic apify plugin
// uses since these 4 sources are hardcoded, not user-configurable.
function normalizeItem(platform, item) {
  switch (platform) {
    case 'linkedin':
      return {
        title: pick(item.title),
        url: pick(item.link, item.url),
        company: pick(item.companyName),
        location: pick(item.location),
      };
    case 'indeed':
      // kaix nests everything under dotted groups — confirmed against a real
      // live dataset item (title.text, urls.indeed/urls.apply, company.name,
      // location.formatted, e.g. "Bengaluru, Karnataka").
      return {
        title: pick(at(item, 'title.text')),
        url: pick(at(item, 'urls.indeed'), at(item, 'urls.apply')),
        company: pick(at(item, 'company.name')),
        location: pick(
          at(item, 'location.formatted'),
          [at(item, 'location.city'), at(item, 'location.state'), at(item, 'location.countryName')]
            .filter(Boolean).join(', '),
        ),
      };
    case 'glassdoor':
      return {
        title: pick(item.title),
        url: pick(item.url),
        company: pick(at(item, 'employer.name')),
        location: pick(at(item, 'location.name')),
      };
    case 'wellfound':
      return {
        title: pick(item.title),
        url: pick(item.jobUrl, item.url),
        company: pick(item.companyName),
        location: pick(Array.isArray(item.locations) ? item.locations.join(', ') : item.locations),
      };
    default:
      return null;
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(String(value)).protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Main search ──────────────────────────────────────────────────────────────

export async function runBroadSearch({ dryRun = false, cliPlatforms = null } = {}) {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error(
      'apify-search: APIFY_TOKEN not set. Add it to .env — see .env.example (apify.com console → Settings → Integrations).',
    );
  }

  const cfg = loadBroadSearchConfig();
  const role = cfg.role_query || 'Android Engineer';
  const location = cfg.location_query || 'India';
  const enabledPlatforms = (cliPlatforms || cfg.platforms || PLATFORMS).filter(p => PLATFORMS.includes(p));
  if (enabledPlatforms.length === 0) {
    throw new Error(`apify-search: no valid platforms selected (expected one of: ${PLATFORMS.join(', ')})`);
  }

  const requestedMax = Number.isFinite(Number(cfg.max_results_per_platform))
    ? Number(cfg.max_results_per_platform)
    : DEFAULT_MAX_RESULTS;
  const cappedMax = Math.min(Math.max(1, requestedMax), MAX_RESULTS_PER_PLATFORM);
  if (requestedMax > MAX_RESULTS_PER_PLATFORM) {
    console.log(`⚠️  max_results_per_platform (${requestedMax}) exceeds the guardrail ceiling — capped at ${MAX_RESULTS_PER_PLATFORM}.`);
  }

  const estimatedCost = enabledPlatforms.reduce((sum, p) => sum + cappedMax * ACTORS[p].costPerResult, 0);
  console.log(`apify-search: querying "${role}" in "${location}" across ${enabledPlatforms.join(', ')} (max ${cappedMax}/platform)`);
  console.log(`Estimated cost: ~$${estimatedCost.toFixed(2)} (this run makes real, billed Apify actor calls)`);
  if (dryRun) {
    console.log('(dry run — no actor calls will be made, no files written)');
    return { offers: [], estimatedCost };
  }

  const results = await Promise.all(
    enabledPlatforms.map(async platform => {
      const { id: actorId } = ACTORS[platform];
      const input = buildInput(platform, { role, location, count: cappedMax });
      try {
        const items = await runActor(actorId, input, { token });
        return { platform, items };
      } catch (err) {
        console.log(`  ✗ ${platform}: ${err.message}`);
        return { platform, items: [], error: err.message };
      }
    }),
  );

  const { seen } = loadSeenUrls();
  const offers = [];
  for (const { platform, items } of results) {
    let kept = 0;
    for (const item of items) {
      const normalized = normalizeItem(platform, item);
      if (!normalized || !normalized.title || !normalized.url) continue;
      if (!isHttpsUrl(normalized.url)) continue;
      if (seen.has(normalized.url)) continue;
      seen.add(normalized.url);
      offers.push({ ...normalized, source: `${platform}-apify` });
      kept++;
    }
    console.log(`  ${platform}: ${items.length} returned, ${kept} new after dedup`);
  }

  if (offers.length > 0) {
    // Tag each entry with its source platform, folded into the title field so
    // it rides through appendToPipeline()'s existing sanitize/atomic-write
    // logic unchanged (formatPipelineOffer's other columns are positional —
    // location/compensation — so a new column isn't safe to add here).
    await appendToPipeline(offers.map(o => ({ ...o, title: `${o.title} [via: ${o.source}]` })));
  }

  console.log(`\napify-search: ${offers.length} new offer(s) added to pipeline.`);
  return { offers, estimatedCost };
}

// ── CLI entrypoint ───────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    // Paid sweep: --help must never fall through to a billed run.
    console.log('Usage: node apify-search.mjs [--dry-run] [--platforms=linkedin,indeed,glassdoor,wellfound]\n\n' +
      '  --dry-run      print the estimated cost and exit without calling Apify\n' +
      '  --platforms=   comma-separated subset of platforms to sweep\n' +
      '  --help         show this help\n\nReads broad_search: in config/profile.yml. Needs APIFY_TOKEN. COSTS MONEY.');
    return;
  }
  const dryRun = args.includes('--dry-run');
  const platformsArg = args.find(a => a.startsWith('--platforms='));
  const cliPlatforms = platformsArg ? platformsArg.split('=')[1].split(',') : null;
  await runBroadSearch({ dryRun, cliPlatforms });
}

if (isMainModule(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
