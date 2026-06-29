import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import yaml from 'js-yaml';

import ashbyProvider from '../../providers/ashby.mjs';
import greenhouseProvider from '../../providers/greenhouse.mjs';
import leverProvider from '../../providers/lever.mjs';
import recruiteeProvider from '../../providers/recruitee.mjs';
import smartRecruitersProvider from '../../providers/smartrecruiters.mjs';
import workableProvider from '../../providers/workable.mjs';
import workdayProvider from '../../providers/workday.mjs';
import { normalizeJob } from '../scoring/scorer.mjs';
import { validateJobSearchConfig } from './config-schema.mjs';
import { buildSearchPlan } from './query-builder.mjs';

const DEFAULT_TIMEOUT_MS = 15_000;
const DDG_URL = 'https://html.duckduckgo.com/html/';
const COMPANY_PROVIDERS = new Map([
  ['greenhouse', greenhouseProvider],
  ['lever', leverProvider],
  ['ashby', ashbyProvider],
  ['workable', workableProvider],
  ['smartrecruiters', smartRecruitersProvider],
  ['recruitee', recruiteeProvider],
  ['workday', workdayProvider],
]);

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
    measureSource('tracked-companies', 'Tracked company feeds', 'provider', () => fetchTrackedCompanyFeeds(portals, fetchImpl, errors), errors),
    validation.config.location.search_scopes.includes('remote')
      ? measureSource('remote-feeds', 'Remote job feeds', 'provider', () => fetchRemoteFeeds(fetchImpl, errors), errors)
      : Promise.resolve(skippedSource('remote-feeds', 'Remote job feeds', 'provider')),
    measureSource('generated-search', 'Generated web discovery', 'search', () => searchConfiguredQueries(plan.queries, fetchImpl, errors), errors),
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
    if (!existing
      || job.score > existing.score
      || (job.score === existing.score && job.snippet.length > existing.snippet.length)) {
      if (existing) funnel.duplicates += 1;
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
  await writeFile(path.join(root, 'data', 'job-dashboard.json'), JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

async function measureSource(id, label, kind, runner, errors) {
  const startedAt = Date.now();
  const errorCount = errors.length;
  try {
    const results = await runner();
    const newErrors = errors.length - errorCount;
    return {
      results,
      telemetry: resultTelemetry(id, label, kind, results, startedAt, newErrors),
    };
  } catch (error) {
    errors.push(`${label}: ${error.message}`);
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

function skippedSource(id, label, kind) {
  return {
    results: [],
    telemetry: {
      id, label, kind, status: 'skipped', jobs: 0, leads: 0,
      failures: 0, durationMs: 0, refreshedAt: null, freshness: 'not-run',
    },
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

async function fetchTrackedCompanyFeeds(portals, fetchImpl, errors) {
  const companies = (portals?.tracked_companies || []).filter((company) => company?.enabled !== false);
  const results = await Promise.allSettled(companies.map((company) => fetchCompany(company, fetchImpl)));
  return results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    errors.push(`${companies[index]?.name || 'tracked company'}: ${result.reason?.message || result.reason}`);
    return [];
  });
}

async function fetchCompany(company, fetchImpl) {
  const provider = detectProvider(company);
  const implementation = COMPANY_PROVIDERS.get(provider);
  if (!implementation) return [];
  const jobs = await implementation.fetch(company, providerContext(fetchImpl));
  return jobs.map((job) => ({
    ...job,
    source: providerLabel(provider),
    sourceCategory: 'ats',
    description: job.description || '',
  }));
}

function detectProvider(company) {
  if (company.provider) return String(company.provider).toLowerCase();
  const value = `${company.api || ''} ${company.careers_url || ''}`.toLowerCase();
  if (value.includes('greenhouse')) return 'greenhouse';
  if (value.includes('lever.co')) return 'lever';
  if (value.includes('ashbyhq')) return 'ashby';
  if (value.includes('workable.com')) return 'workable';
  if (value.includes('smartrecruiters.com')) return 'smartrecruiters';
  if (value.includes('recruitee.com')) return 'recruitee';
  if (value.includes('myworkdayjobs.com')) return 'workday';
  return '';
}

async function fetchRemoteFeeds(fetchImpl, errors) {
  const feeds = [
    ['RemoteOK', 'https://remoteok.com/api', parseRemoteOk],
    ['Remotive', 'https://remotive.com/api/remote-jobs?category=software-dev', parseRemotive],
    ['Jobicy', 'https://jobicy.com/api/v2/remote-jobs', parseJobicy],
    ['Himalayas', 'https://himalayas.app/jobs/api', parseHimalayas],
    ['Arbeitnow', 'https://www.arbeitnow.com/api/job-board-api', parseArbeitnow],
    ['Working Nomads', 'https://www.workingnomads.com/api/exposed_jobs/', parseWorkingNomads],
    ['SolidJobs', 'https://solid.jobs/public-api/offers/it', parseSolidJobs],
  ];
  const results = await Promise.allSettled(feeds.map(async ([name, url, parser]) => {
    const data = await fetchJson(url, fetchImpl, { 'user-agent': 'hiresignal/1.0' });
    return parser(data, name);
  }));
  return results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    errors.push(`${feeds[index][0]}: ${result.reason?.message || result.reason}`);
    return [];
  });
}

function parseRemoteOk(data, source) {
  return (Array.isArray(data) ? data : []).filter((job) => job?.position).map((job) => ({
    title: job.position,
    company: job.company || 'Unknown company',
    location: job.location || 'Remote',
    url: job.url || job.apply_url,
    source,
    sourceCategory: 'remote',
    description: stripHtml(job.description || ''),
    compensation: job.salary_min || job.salary_max
      ? `USD ${job.salary_min || ''}-${job.salary_max || ''}`
      : '',
  }));
}

function parseRemotive(data, source) {
  return (data.jobs || []).map((job) => ({
    title: job.title,
    company: job.company_name,
    location: job.candidate_required_location || 'Remote',
    url: job.url,
    source,
    sourceCategory: 'remote',
    description: stripHtml(job.description || ''),
    compensation: job.salary || '',
  }));
}

function parseJobicy(data, source) {
  return (data.jobs || []).map((job) => ({
    title: job.jobTitle,
    company: job.companyName,
    location: job.jobGeo || 'Remote',
    url: job.url,
    source,
    sourceCategory: 'remote',
    description: `${job.jobExcerpt || ''} ${stripHtml(job.jobDescription || '')}`,
    compensation: job.annualSalaryMin || job.annualSalaryMax
      ? `${job.salaryCurrency || ''} ${job.annualSalaryMin || ''}-${job.annualSalaryMax || ''}`
      : '',
  }));
}

function parseHimalayas(data, source) {
  return (data.jobs || []).map((job) => ({
    title: job.title,
    company: job.companyName,
    location: Array.isArray(job.locationRestrictions) ? job.locationRestrictions.join(', ') : 'Remote',
    url: job.applicationLink || job.guid,
    source,
    sourceCategory: 'remote',
    description: `${job.excerpt || ''} ${stripHtml(job.description || '')}`,
  }));
}

function parseArbeitnow(data, source) {
  return (data.data || []).map((job) => ({
    title: job.title,
    company: job.company_name,
    location: job.location || '',
    url: job.url,
    source,
    sourceCategory: 'international',
    description: `${(job.tags || []).join(' ')} ${job.remote ? 'remote' : ''} ${stripHtml(job.description || '')}`,
  }));
}

function parseWorkingNomads(data, source) {
  return (Array.isArray(data) ? data : []).map((job) => ({
    title: job.title,
    company: job.company_name || 'Unknown company',
    location: job.location || 'Remote',
    url: job.url,
    source,
    sourceCategory: 'remote',
    description: `${job.category_name || ''} ${job.description || ''}`,
  }));
}

function parseSolidJobs(data, source) {
  return (data.jobs || []).map((job) => ({
    title: job.title,
    company: job.company || 'Unknown company',
    location: Array.isArray(job.locations) ? job.locations.join(', ') : job.locations || '',
    url: job.url,
    source,
    sourceCategory: 'regional',
    description: job.description || '',
  }));
}

async function searchConfiguredQueries(queries, fetchImpl, errors) {
  const selected = queries.slice(0, Number(process.env.CAREER_DASHBOARD_SEARCH_LIMIT || 150));
  const results = [];
  for (let index = 0; index < selected.length; index += 5) {
    const chunk = selected.slice(index, index + 5);
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

async function fetchJson(url, fetchImpl, headers = {}) {
  const response = await fetchWithTimeout(url, fetchImpl, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function providerContext(fetchImpl) {
  return {
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
  };
}

function providerLabel(value) {
  return {
    greenhouse: 'Greenhouse',
    lever: 'Lever',
    ashby: 'Ashby',
    workable: 'Workable',
    smartrecruiters: 'SmartRecruiters',
    recruitee: 'Recruitee',
    workday: 'Workday',
  }[value] || value;
}

async function fetchWithTimeout(url, fetchImpl, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
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
  return yaml.load(await readFile(file, 'utf8')) || {};
}

function searchError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
