#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { getSetupStatus, loadActiveProfile, loadJobSearchConfig } from './config.mjs';
import { acceptResumeUpload, discardDraft, readDraft } from './onboarding/upload-intake.mjs';
import { extractResumeDraft, readExtraction } from './onboarding/resume-extractor.mjs';
import { inferProfileDraft, readInference, saveReviewDraft } from './onboarding/profile-inference.mjs';
import {
  activateProfile,
  finalizeProfileReplacement,
  previewProfileActivation,
  rollbackProfileReplacement,
} from './onboarding/profile-writer.mjs';
import { normalizeJob } from './scoring/scorer.mjs';
import { validateJobSearchConfig } from './search/config-schema.mjs';
import { buildSearchPlan } from './search/query-builder.mjs';
import { findCachedJob, refreshJobSearch } from './search/job-search-runner.mjs';
import { createTailoredResume } from './resume-tailor.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(__dirname, 'public');
const CACHE_PATH = path.join(ROOT, 'data', 'job-dashboard.json');
const FIXTURES = path.join(__dirname, 'test', 'fixtures');
const HOST = process.env.CAREER_DASHBOARD_HOST || '127.0.0.1';
const PORT = Number(process.env.CAREER_DASHBOARD_PORT || 4173);
const DEMO = process.env.CAREER_DASHBOARD_DEMO === '1';
let refreshPromise = null;

export async function buildDashboardPayload() {
  const demo = DEMO ? await loadDemoData() : null;
  const setup = demo?.setup || await getSetupStatus(ROOT);
  const profile = demo?.profile || (setup.hasActiveProfile ? await loadActiveProfile(ROOT) : null);
  const rawConfig = demo?.jobSearch || await loadJobSearchConfig(ROOT);
  const validation = validateJobSearchConfig(rawConfig);
  const cached = demo?.cache || await readCache();
  const jobs = Array.isArray(cached?.jobs) && validation.valid
    ? cached.scored === true
      ? cached.jobs
      : cached.jobs.map((job) => normalizeJob(job, validation.config))
    : [];
  const searchPlan = validation.valid ? buildSearchPlan(validation.config) : null;
  return {
    setup,
    profile,
    searchConfig: {
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
    },
    searchPlan: searchPlan?.summary || null,
    generatedAt: cached?.generatedAt || null,
    jobs,
    stats: {
      total: jobs.filter((job) => job.type !== 'searchLead').length,
      excellent: jobs.filter((job) => job.type !== 'searchLead' && Number(job.score) >= 8).length,
      sources: jobs.filter((job) => job.type === 'searchLead').length,
    },
    diagnostics: {
      note: cached?.diagnostics?.note || (!setup.ready
        ? 'Complete local onboarding before searching for jobs.'
        : validation.valid
          ? `Profile-driven scoring is active with ${searchPlan.summary.queries} generated search queries.`
          : `Job-search configuration needs review: ${validation.errors.join('; ')}`),
      feedErrors: cached?.diagnostics?.feedErrors || [],
    },
  };
}

export async function route(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (req.method === 'OPTIONS') return sendEmpty(res, 204);
    if (url.pathname === '/api/health') {
      return sendJson(res, { ok: true, service: 'hiresignal' });
    }
    if (url.pathname === '/api/setup/status') {
      return sendJson(res, DEMO ? (await loadDemoData()).setup : await getSetupStatus(ROOT));
    }
    if (url.pathname === '/api/setup/upload' && req.method === 'POST') {
      const draft = await acceptResumeUpload(req, ROOT);
      return sendJson(res, { ok: true, draft }, 201);
    }
    if (url.pathname === '/api/setup/draft') {
      const draft = await readDraft(ROOT, url.searchParams.get('id'));
      const extraction = draft ? await readExtraction(ROOT, draft.draftId) : null;
      const inference = draft ? await readInference(ROOT, draft.draftId) : null;
      return draft ? sendJson(res, { ok: true, draft, extraction, inference }) : sendJson(res, { error: 'draft_not_found' }, 404);
    }
    if (url.pathname === '/api/setup/extract' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const extraction = await extractResumeDraft(ROOT, body.draftId);
      const draft = await readDraft(ROOT, body.draftId);
      return sendJson(res, { ok: true, draft, extraction });
    }
    if (url.pathname === '/api/setup/infer' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const inference = await inferProfileDraft(ROOT, body.draftId);
      return sendJson(res, { ok: true, inference });
    }
    if (url.pathname === '/api/setup/preview' && req.method === 'POST') {
      const body = await readJsonBody(req, 256 * 1024);
      const result = await saveReviewDraft(ROOT, body.draftId, body.review);
      return sendJson(res, result, result.valid ? 200 : 422);
    }
    if (url.pathname === '/api/setup/activation-preview' && req.method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, await previewProfileActivation(ROOT, body.draftId));
    }
    if (url.pathname === '/api/setup/confirm' && req.method === 'POST') {
      if (DEMO) return sendJson(res, { error: 'demo_read_only' }, 409);
      const body = await readJsonBody(req);
      const activation = await activateProfile(ROOT, body.draftId);
      let dashboard;
      try {
        dashboard = await refreshDashboard();
      } catch (error) {
        await rollbackProfileReplacement(ROOT, body.draftId);
        throw error;
      }
      let cleanup = { ok: true, previousProfilesRemoved: true };
      try {
        cleanup = await finalizeProfileReplacement(ROOT, body.draftId);
      } catch (error) {
        cleanup = { ok: false, previousProfilesRemoved: false, error: error.message };
      }
      return sendJson(res, { ok: true, activation, cleanup, dashboard });
    }
    if (url.pathname === '/api/setup/reset' && req.method === 'POST') {
      const body = await readJsonBody(req);
      await discardDraft(ROOT, body.draftId);
      return sendJson(res, { ok: true });
    }
    if (url.pathname === '/api/profile') {
      const demo = DEMO ? await loadDemoData() : null;
      const setup = demo?.setup || await getSetupStatus(ROOT);
      return sendJson(res, {
        setup,
        profile: demo?.profile || (setup.hasActiveProfile ? await loadActiveProfile(ROOT) : null),
      });
    }
    if (url.pathname === '/api/search-plan') {
      const rawConfig = DEMO ? (await loadDemoData()).jobSearch : await loadJobSearchConfig(ROOT);
      const validation = validateJobSearchConfig(rawConfig);
      if (!validation.valid) return sendJson(res, validation, 422);
      return sendJson(res, buildSearchPlan(validation.config));
    }
    if (url.pathname === '/api/jobs') {
      return sendJson(res, await buildDashboardPayload());
    }
    if (url.pathname === '/api/refresh' && req.method === 'POST') {
      const payload = DEMO ? await buildDashboardPayload() : await refreshDashboard();
      if (!payload.setup.ready) {
        return sendJson(res, { ...payload, error: 'setup_required' }, 409);
      }
      return sendJson(res, payload);
    }
    if (url.pathname === '/api/resume' && req.method === 'POST') {
      if (DEMO) return sendJson(res, { error: 'demo_read_only' }, 409);
      const body = await readJsonBody(req);
      const job = await findCachedJob(ROOT, body.id);
      if (!job) return sendJson(res, { error: 'job_not_found' }, 404);
      const artifact = await createTailoredResume(ROOT, job);
      return sendJson(res, { ok: true, job, artifact });
    }
    if (url.pathname.startsWith('/output/')) return serveOutput(url.pathname, res);
    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    return sendJson(
      res,
      { error: error.code || 'server_error', detail: error.message },
      error.status || 500,
    );
  }
}

async function refreshDashboard() {
  if (!refreshPromise) {
    refreshPromise = refreshJobSearch(ROOT).finally(() => { refreshPromise = null; });
  }
  await refreshPromise;
  return buildDashboardPayload();
}

async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('JSON request is too large');
      error.code = 'request_too_large';
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function loadDemoData() {
  const [jobSearchText, jobsText] = await Promise.all([
    readFile(path.join(FIXTURES, 'backend-profile.yml'), 'utf8'),
    readFile(path.join(FIXTURES, 'jobs.json'), 'utf8'),
  ]);
  return {
    setup: {
      ready: true,
      hasActiveProfile: true,
      demo: true,
      present: {},
      missing: [],
    },
    profile: {
      name: 'Fictional Candidate',
      headline: 'Backend systems engineer',
      location: 'India · open to global remote',
      roles: ['Senior Backend Engineer', 'Backend Engineer'],
    },
    jobSearch: yaml.load(jobSearchText),
    cache: {
      generatedAt: new Date().toISOString(),
      jobs: JSON.parse(jobsText),
    },
  };
}

async function readCache() {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(await readFile(CACHE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function serveStatic(pathname, res) {
  const requestPath = pathname === '/' ? '/index.html' : pathname;
  const full = path.resolve(PUBLIC, `.${requestPath}`);
  if (!full.startsWith(PUBLIC)) return sendText(res, 'Forbidden', 403);
  if (!existsSync(full)) return sendText(res, 'Not found', 404);
  const extension = path.extname(full).toLowerCase();
  const contentType = {
    '.css': 'text/css',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
  }[extension] || 'application/octet-stream';
  res.writeHead(200, securityHeaders({ 'content-type': `${contentType}; charset=utf-8` }));
  res.end(await readFile(full));
}

async function serveOutput(pathname, res) {
  const outputRoot = path.join(ROOT, 'output');
  const full = path.resolve(ROOT, `.${pathname}`);
  if (!full.startsWith(outputRoot) || !existsSync(full)) return sendText(res, 'Not found', 404);
  const extension = path.extname(full).toLowerCase();
  const contentType = {
    '.html': 'text/html',
    '.pdf': 'application/pdf',
    '.md': 'text/markdown',
  }[extension] || 'application/octet-stream';
  res.writeHead(200, securityHeaders({ 'content-type': `${contentType}; charset=utf-8` }));
  res.end(await readFile(full));
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, securityHeaders({ 'content-type': 'application/json; charset=utf-8' }));
  res.end(JSON.stringify(payload));
}

function sendText(res, text, status = 200) {
  res.writeHead(status, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
  res.end(text);
}

function sendEmpty(res, status) {
  res.writeHead(status, securityHeaders());
  res.end();
}

function securityHeaders(extra = {}) {
  return {
    'access-control-allow-origin': `http://${HOST}:${PORT}`,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    ...extra,
  };
}

export function startServer() {
  const server = http.createServer(route);
  server.listen(PORT, HOST, () => {
    console.log(`HireSignal: http://${HOST}:${PORT}`);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer();
}
