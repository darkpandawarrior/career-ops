import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as yaml from 'js-yaml';

import { loadProviders, resolveProvider } from '../../../../providers/_registry.mjs';
import { normalizeJob } from '../scoring/scorer.mjs';
import { validateJobSearchConfig } from './config-schema.mjs';
import { buildSearchPlan } from './query-builder.mjs';

const DEFAULT_TIMEOUT_MS = 15_000;
const DDG_URL = 'https://html.duckduckgo.com/html/';
const PROVIDERS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../providers');

// Loaded once per process and shared by every tracked-company fetch and every
// job-board fetch below — the same registry scan.mjs/verify-portals.mjs use,
// so a new providers/*.mjs file needs zero dashboard changes to be picked up.
let providersPromise;
function getProviders() {
  if (!providersPromise) providersPromise = loadProviders(PROVIDERS_DIR);
  return providersPromise;
}

// Display labels for provider ids that don't title-case cleanly (acronyms,
// brand casing, dotted/multi-word names).
const PROVIDER_LABELS = {
  '4dayweek': '4 Day Week',
  arbeitsagentur: 'Arbeitsagentur',
  bamboohr: 'BambooHR',
  dassault: 'Dassault Systèmes',
  getonbrd: 'GetOnBoard',
  hackernews: 'Hacker News',
  higheredjobs: 'HigherEdJobs',
  ibm: 'IBM',
  jazzhr: 'JazzHR',
  jibeapply: 'Jibe',
  jobstreet: 'JobStreet',
  justjoin: 'JustJoin.it',
  'local-parser': 'Local parser',
  nodesk: 'NoDesk',
  nofluffjobs: 'NoFluffJobs',
  remoteok: 'RemoteOK',
  smartrecruiters: 'SmartRecruiters',
  solidjobs: 'SolidJobs',
  'startup.ch': 'Startup.ch',
  startupch: 'Startup.ch',
  successfactors: 'SuccessFactors',
  thehub: 'The Hub',
  themuse: 'The Muse',
  weworkremotely: 'We Work Remotely',
  workingnomads: 'Working Nomads',
};

function providerLabel(id) {
  return PROVIDER_LABELS[id] || (id.charAt(0).toUpperCase() + id.slice(1));
}

export async function refreshJobSearch(root, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const runScan = options.runScan || (() => runNode(root, ['scan.mjs']));
  const [jobSearch, portals] = await Promise.all([
    readYaml(path.join(root, 'config', 'job-search.yml')),
    readYaml(path.join(root, 'portals.yml')),
  ]);
  const validation = validateJobSearchConfig(jobSearch);
  if (!validation.valid) throw searchError('invalid_search_config', validation.errors.join('; '), 422);
  const runWideScan = options.runWideScan || (() => runReverseAtsScan(root, validation.config));
  const plan = buildSearchPlan(validation.config);
  const errors = [];
  const telemetry = [];
  const refreshStartedAt = new Date().toISOString();
  let started = Date.now();
  const scan = await runScan();
  if (scan.code !== 0) errors.push(`career-ops scan: ${scan.stderr || `exit ${scan.code}`}`);
  telemetry.push(commandTelemetry('career-ops-scan', 'Career-ops portal scan', scan, started));
  started = Date.now();
  const wideScan = await runWideScan();
  if (wideScan.code !== 0) errors.push(`career-ops reverse ATS scan: ${wideScan.stderr || `exit ${wideScan.code}`}`);
  telemetry.push(commandTelemetry('reverse-ats', 'Reverse ATS discovery', wideScan, started));

  const sources = await Promise.all([
    measureSource('pipeline', 'Saved pipeline', 'local', () => readPipelineJobs(root), errors),
    measureSource('scan-history', 'Scan history', 'local', () => readScanHistoryJobs(root), errors),
    measureSource('tracked-companies', 'Tracked company feeds', 'provider', (localErrors) => fetchTrackedCompanyFeeds(portals, fetchImpl, localErrors), errors),
    measureSource('board-feeds', 'Job board feeds', 'provider', (localErrors) => fetchBoardFeeds(portals, fetchImpl, localErrors), errors),
    measureSource('generated-search', 'Generated web discovery', 'search', (localErrors) => searchConfiguredQueries(plan.queries, fetchImpl, localErrors), errors),
  ]);
  telemetry.push(...sources.map((source) => source.telemetry));
  const batches = sources.map((source) => source.results);
  const funnel = {
    raw: batches.flat().length, verified: 0, leads: 0, irrelevant: 0,
    expired: 0, over60Days: 0, unknownDate: 0, duplicates: 0, final: 0,
  };
  const byId = new Map();
  for (const raw of batches.flat()) {
    if (!raw?.url || !raw?.title) continue;
    const job = normalizeJob(raw, validation.config);
    if (job.type === 'searchLead') funnel.leads += 1;
    else {
      funnel.verified += 1;
      if (isExpiredJob(job)) { funnel.expired += 1; continue; }
      if (job.freshness?.band === 'over 60 days') { funnel.over60Days += 1; continue; }
      if (job.freshness?.band === 'unknown') funnel.unknownDate += 1;
      if (!isDiscoverableJob(job)) { funnel.irrelevant += 1; continue; }
    }
    const existing = byId.get(job.id);
    if (existing) funnel.duplicates += 1;
    if (!existing
      || job.score > existing.score
      || (job.score === existing.score && job.snippet.length > existing.snippet.length)) {
      byId.set(job.id, job);
    }
  }
  const jobs = [...byId.values()]
    .sort((a, b) => b.score - a.score || a.company.localeCompare(b.company));
  const generatedAt = new Date().toISOString();
  funnel.final = jobs.filter((job) => job.type !== 'searchLead').length;
  const payload = {
    version: 2,
    scored: true,
    generatedAt,
    jobs,
    stats: summarizeJobs(jobs),
    scan: {
      exitCode: scan.code,
      summary: summarizeScan(scan.stdout),
      stderr: scan.stderr || '',
      reverseAts: {
        exitCode: wideScan.code,
        summary: summarizeScan(wideScan.stdout),
        stderr: wideScan.stderr || '',
      },
    },
    searchPlan: plan.summary,
    telemetry: {
      refreshStartedAt,
      lastRefresh: generatedAt,
      durationMs: new Date(generatedAt).getTime() - new Date(refreshStartedAt).getTime(),
      sources: telemetry,
      contributors: summarizeContributors(batches.flat()),
      funnel,
    },
    diagnostics: {
      feedErrors: errors.slice(0, 20),
      note: errors.length
        ? 'Some sources could not be fetched; available results and source-search leads are shown.'
        : 'Fresh profile-driven search completed.',
    },
  };
  await mkdir(path.join(root, 'data'), { recursive: true });
  const cachePath = path.join(root, 'data', 'job-dashboard.json');
  await writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf8');
  if (options.autoEnrich !== false && jobs.some((job) => job.type === 'searchLead')) {
    await enrichDiscoveryLeads(root, {
      fetchImpl,
      limit: options.enrichmentLimit ?? 4,
    });
    return JSON.parse(await readFile(cachePath, 'utf8'));
  }
  return payload;
}

// Sources run concurrently (Promise.all in refreshJobSearch), so each gets its own
// local error list instead of diffing a shared array's length — that diff pattern
// misattributes failures across sources when their promises interleave.
async function measureSource(id, label, kind, runner, sharedErrors) {
  const startedAt = Date.now();
  const localErrors = [];
  try {
    const results = await runner(localErrors);
    sharedErrors.push(...localErrors);
    return {
      results,
      telemetry: resultTelemetry(id, label, kind, results, startedAt, localErrors.length),
    };
  } catch (error) {
    sharedErrors.push(`${label}: ${error.message}`);
    return {
      results: [],
      telemetry: {
        id, label, kind, status: 'failed', jobs: 0, leads: 0,
        failures: 1, durationMs: Date.now() - startedAt,
        refreshedAt: new Date().toISOString(), freshness: 'fresh',
      },
    };
  }
}

function resultTelemetry(id, label, kind, results, startedAt, failures) {
  return {
    id,
    label,
    kind,
    status: failures > 0 ? 'partial' : 'success',
    jobs: results.filter((item) => item?.type !== 'searchLead').length,
    leads: results.filter((item) => item?.type === 'searchLead').length,
    failures,
    durationMs: Date.now() - startedAt,
    refreshedAt: new Date().toISOString(),
    freshness: 'fresh',
  };
}

function commandTelemetry(id, label, result, startedAt) {
  return {
    id,
    label,
    kind: 'scanner',
    status: result.code === 0 ? 'success' : 'failed',
    jobs: 0,
    leads: 0,
    failures: result.code === 0 ? 0 : 1,
    durationMs: Date.now() - startedAt,
    refreshedAt: new Date().toISOString(),
    freshness: 'fresh',
  };
}

function summarizeContributors(items) {
  const sources = new Map();
  for (const item of items) {
    const label = item?.source || 'Unknown source';
    const current = sources.get(label) || { source: label, jobs: 0, leads: 0 };
    if (item?.type === 'searchLead') current.leads += 1;
    else current.jobs += 1;
    sources.set(label, current);
  }
  return [...sources.values()].sort((a, b) => b.jobs - a.jobs || b.leads - a.leads || a.source.localeCompare(b.source));
}

function isRelevantJob(job) {
  const verified = (job.matchedSkills || []).length;
  const supporting = (job.supportingSkills || []).length;
  return verified >= 2 || (verified >= 1 && verified + supporting >= 3);
}

export function isDiscoverableJob(job) {
  if (job?.type === 'searchLead') return true;
  return !isExpiredJob(job) && job?.freshness?.band !== 'over 60 days' && isRelevantJob(job);
}

function isExpiredJob(job) {
  const value = `${job.liveness || ''} ${job.status || ''} ${job.snippet || ''}`;
  return /\b(expired|closed|no longer accepting|position (?:has been )?filled|job unavailable)\b/i.test(value);
}

export async function findCachedJob(root, id) {
  try {
    const cache = JSON.parse(await readFile(path.join(root, 'data', 'job-dashboard.json'), 'utf8'));
    return (cache.jobs || []).find((job) => job.id === id) || null;
  } catch {
    return null;
  }
}

export async function enrichDiscoveryLead(root, id, options = {}) {
  const cachePath = path.join(root, 'data', 'job-dashboard.json');
  const [cache, rawConfig] = await Promise.all([
    readFile(cachePath, 'utf8').then(JSON.parse),
    readYaml(path.join(root, 'config', 'job-search.yml')),
  ]);
  const validation = validateJobSearchConfig(rawConfig);
  if (!validation.valid) throw searchError('invalid_search_config', validation.errors.join('; '), 422);
  const lead = (cache.jobs || []).find((job) => job.id === id && job.type === 'searchLead');
  if (!lead) throw searchError('lead_not_found', 'Discovery lead was not found', 404);
  if (!lead.discoveryQuery) throw searchError('lead_query_missing', 'Run a fresh search before enriching this legacy lead', 409);

  const errors = [];
  const query = { name: lead.source || lead.title, category: lead.sourceCategory || 'search', query: lead.discoveryQuery };
  const rawJobs = await searchConfiguredQueries([query], options.fetchImpl || globalThis.fetch, errors);
  const jobs = rawJobs
    .filter((job) => job.type !== 'searchLead')
    .map((job) => normalizeJob(job, validation.config))
    .filter(isDiscoverableJob);
  const attemptedAt = new Date().toISOString();

  if (jobs.length === 0) {
    lead.enrichment = {
      status: 'unverified', attemptedAt,
      reason: errors[0] || rawJobs[0]?.discoveryReason || 'No job postings could be verified from this lead',
    };
    await writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf8');
    return { status: 'unverified', lead, jobs: [], errors };
  }

  const byId = new Map((cache.jobs || []).filter((job) => job.id !== lead.id).map((job) => [job.id, job]));
  for (const job of jobs) {
    const existing = byId.get(job.id);
    if (!existing || job.score > existing.score || job.snippet.length > existing.snippet.length) byId.set(job.id, job);
  }
  cache.jobs = [...byId.values()].sort((a, b) => b.score - a.score || a.company.localeCompare(b.company));
  cache.stats = summarizeJobs(cache.jobs);
  cache.leadEnrichment = { lastAttempt: attemptedAt, leadId: lead.id, promotedJobs: jobs.length };
  await writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf8');
  return { status: 'promoted', leadId: lead.id, jobs, errors };
}

export async function enrichDiscoveryLeads(root, options = {}) {
  const cachePath = path.join(root, 'data', 'job-dashboard.json');
  const cache = JSON.parse(await readFile(cachePath, 'utf8'));
  const leads = (cache.jobs || [])
    .filter((job) => job.type === 'searchLead' && job.discoveryQuery)
    .slice(0, Math.max(0, Number(options.limit ?? 8)));
  const results = [];
  for (const lead of leads) {
    try {
      const result = await enrichDiscoveryLead(root, lead.id, { fetchImpl: options.fetchImpl });
      results.push({ leadId: lead.id, status: result.status, promotedJobs: result.jobs?.length || 0 });
    } catch (error) {
      results.push({ leadId: lead.id, status: 'failed', promotedJobs: 0, reason: error.message });
    }
  }
  const latest = JSON.parse(await readFile(cachePath, 'utf8'));
  latest.leadEnrichmentBatch = {
    attemptedAt: new Date().toISOString(),
    attempted: results.length,
    promotedJobs: results.reduce((sum, result) => sum + result.promotedJobs, 0),
    failed: results.filter((result) => result.status === 'failed').length,
    results,
  };
  await writeFile(cachePath, JSON.stringify(latest, null, 2), 'utf8');
  return latest.leadEnrichmentBatch;
}

async function fetchTrackedCompanyFeeds(portals, fetchImpl, errors) {
  const companies = (portals?.tracked_companies || []).filter((company) => company?.enabled !== false);
  const providers = await getProviders();
  const results = await Promise.allSettled(
    companies.map((company) => fetchViaProvider(company, providers, fetchImpl, 'ats')),
  );
  return results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    errors.push(`${companies[index]?.name || 'tracked company'}: ${result.reason?.message || result.reason}`);
    return [];
  });
}

// job_boards entries (portals.yml) are resolved through the exact same
// provider registry as tracked_companies — scan.mjs treats both lists
// identically, always via an explicit `provider:` field.
async function fetchBoardFeeds(portals, fetchImpl, errors) {
  const boards = (portals?.job_boards || []).filter((board) => board?.enabled !== false);
  const providers = await getProviders();
  const results = await Promise.allSettled(
    boards.map((board) => fetchViaProvider(board, providers, fetchImpl, 'board')),
  );
  return results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    errors.push(`${boards[index]?.name || 'job board'}: ${result.reason?.message || result.reason}`);
    return [];
  });
}

async function fetchViaProvider(entry, providers, fetchImpl, sourceCategory) {
  const resolved = resolveProvider(entry, providers, { skipIds: ['local-parser'] });
  if (!resolved || resolved.error || !resolved.provider) {
    if (resolved?.error) throw new Error(resolved.error);
    return [];
  }
  const jobs = await resolved.provider.fetch(entry, providerContext(fetchImpl));
  return jobs.map((job) => ({
    ...job,
    source: entry.name || providerLabel(resolved.provider.id),
    sourceCategory,
    description: job.description || '',
  }));
}

async function searchConfiguredQueries(queries, fetchImpl, errors) {
  const selected = queries.slice(0, Number(process.env.CAREER_DASHBOARD_SEARCH_LIMIT || 150));
  const concurrency = Math.max(1, Number(process.env.CAREER_DASHBOARD_SEARCH_CONCURRENCY || 10));
  const queryTimeoutMs = Math.max(1000, Number(process.env.CAREER_DASHBOARD_QUERY_TIMEOUT_MS || 8000));
  const budgetMs = Math.max(queryTimeoutMs, Number(process.env.CAREER_DASHBOARD_SEARCH_BUDGET_MS || 60_000));
  const startedAt = Date.now();
  const results = [];
  for (let index = 0; index < selected.length; index += concurrency) {
    if (Date.now() - startedAt >= budgetMs) {
      const remaining = selected.slice(index);
      errors.push(`Generated search budget reached after ${index} of ${selected.length} queries`);
      results.push(...remaining.map((query) => searchLead(query, 'Not fetched before the generated-search time budget expired')));
      break;
    }
    const chunk = selected.slice(index, index + concurrency);
    const batch = await Promise.all(chunk.map(async (query) => {
      try {
        const body = new URLSearchParams({ q: query.query });
        const response = await fetchWithTimeout(DDG_URL, fetchImpl, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': 'hiresignal/1.0',
          },
          body,
          timeoutMs: queryTimeoutMs,
        });
        const html = await response.text();
        const parsed = parseDuckResults(html, query);
        return parsed.length ? parsed : [searchLead(query, 'No parseable results')];
      } catch (error) {
        errors.push(`${query.name}: ${error.message}`);
        return [searchLead(query, error.message)];
      }
    }));
    for (const jobs of batch) {
      results.push(...jobs);
    }
  }
  return results;
}

export function parseDuckResults(html, query) {
  const results = [];
  const seen = new Set();
  const pattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(pattern)) {
    const url = decodeDuckUrl(decodeHtml(match[1]));
    const titleText = decodeHtml(stripHtml(match[2])).replace(/\s+/g, ' ').trim();
    if (!url || !titleText || seen.has(url)) continue;
    seen.add(url);
    const { title, company } = parseTitleCompany(titleText, url);
    results.push({
      title,
      company,
      location: '',
      url,
      source: query.name,
      sourceCategory: query.category,
      snippet: titleText,
    });
    if (results.length >= 12) break;
  }
  return results;
}

function searchLead(query, reason) {
  return {
    type: 'searchLead',
    title: query.name,
    company: 'Source search',
    location: '',
    url: `https://duckduckgo.com/?q=${encodeURIComponent(query.query)}`,
    source: query.name,
    sourceCategory: query.category,
    discoveryQuery: query.query,
    discoveryReason: reason,
    snippet: reason,
  };
}

async function readPipelineJobs(root) {
  const file = path.join(root, 'data', 'pipeline.md');
  if (!existsSync(file)) return [];
  const text = await readFile(file, 'utf8');
  const jobs = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^- \[[ x]\] (https?:\/\/\S+)\s+\|\s+(.+?)\s+\|\s+(.+)$/);
    if (match) jobs.push({ url: match[1], company: match[2], title: match[3], source: 'career-ops pipeline' });
  }
  return jobs;
}

async function readScanHistoryJobs(root) {
  const file = path.join(root, 'data', 'scan-history.tsv');
  if (!existsSync(file)) return [];
  const lines = (await readFile(file, 'utf8')).split(/\r?\n/).slice(1);
  return lines.flatMap((line) => {
    const fields = line.split('\t');
    if (fields.length < 6 || fields[5] !== 'added') return [];
    return [{
      url: fields[0],
      source: fields[2],
      title: fields[3],
      company: fields[4],
      location: fields[6] || '',
    }];
  });
}

function runNode(root, args, environment = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, ...environment },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: error.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function runReverseAtsScan(root, config) {
  if (!existsSync(path.join(root, 'scan-ats-full.mjs'))) {
    return { code: 0, stdout: 'reverse ATS scan unavailable in this workspace', stderr: '' };
  }
  const days = String(process.env.CAREER_DASHBOARD_ATS_DAYS || 14);
  const limit = String(process.env.CAREER_DASHBOARD_ATS_LIMIT || 50);
  return runNode(
    root,
    ['scan-ats-full.mjs', '--since', days, '--limit', limit],
    { CAREER_OPS_FRESH_SCAN: '1' },
  );
}

function providerContext(fetchImpl) {
  return {
    transport: 'http',
    fetchJson: async (url, options = {}) => {
      const response = await fetchWithTimeout(url, fetchImpl, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
    fetchText: async (url, options = {}) => {
      const response = await fetchWithTimeout(url, fetchImpl, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    },
    // A couple of providers (e.g. startup.ch) need response headers (Set-Cookie)
    // rather than a parsed body — matches providers/_http.mjs's fetchResponse.
    fetchResponse: async (url, options = {}) => {
      const response = await fetchWithTimeout(url, fetchImpl, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    },
  };
}

async function fetchWithTimeout(url, fetchImpl, options = {}) {
  const controller = new AbortController();
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeJobs(jobs) {
  const real = jobs.filter((job) => job.type !== 'searchLead');
  return {
    total: real.length,
    excellent: real.filter((job) => job.score >= 8).length,
    strong: real.filter((job) => job.score >= 7).length,
    sources: jobs.filter((job) => job.type === 'searchLead').length,
  };
}

function summarizeScan(stdout) {
  return String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-5);
}

function parseTitleCompany(value, url) {
  const parts = value.split(/\s+(?:[-|–—])\s+/).map((part) => part.trim()).filter(Boolean);
  return {
    title: parts[0] || value,
    company: parts[1] || inferCompany(url),
  };
}

function inferCompany(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').split('.')[0];
  } catch {
    return 'Unknown company';
  }
}

function decodeDuckUrl(value) {
  try {
    const parsed = new URL(value, 'https://duckduckgo.com');
    return parsed.searchParams.get('uddg') || parsed.href;
  } catch {
    return '';
  }
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtml(value) {
  return String(value || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

async function readYaml(file) {
  if (!existsSync(file)) return {};
  const raw = await readFile(file, 'utf8');
  return (raw.trim() ? yaml.load(raw) : {}) || {};
}

function searchError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
