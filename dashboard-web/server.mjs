#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
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

// ── Tracker paths ────────────────────────────────────────────────────────────
const APPS        = path.join(ROOT, 'data/applications.md');
const PIPELINE    = path.join(ROOT, 'data/pipeline.md');
const SCAN_HIST   = path.join(ROOT, 'data/scan-history.tsv');
const AGENT_INBOX = path.join(ROOT, 'data/agent-inbox.md');
const PORTALS     = path.join(ROOT, 'portals.yml');
const CV_PATH     = path.join(ROOT, 'cv.md');
const REPORTS_DIR = path.join(ROOT, 'reports');
const COACH_STATE = path.resolve(ROOT, '../interview-coach-skill/coaching_state.md');
const CANONICAL_STATES = ['Evaluated','Applied','Responded','Interview','Offer','Rejected','Discarded','SKIP'];
const COMMANDS = {
  'career-ops': [
    { cmd: '/career-ops oferta {url}',           arg: 'job URL or paste JD',                        label: 'Evaluate offer',       desc: 'Full A–G scored evaluation + report + tracker entry.' },
    { cmd: '/career-ops pipeline',               arg: '',                                            label: 'Process inbox',        desc: 'Evaluate every pending URL in pipeline.md.' },
    { cmd: '/career-ops scan',                   arg: '',                                            label: 'Deep scan (agent)',    desc: 'WebSearch + Playwright scan across all queries.' },
    { cmd: '/career-ops deep {company}',         arg: 'company',                                    label: 'Deep research',        desc: 'Company deep-dive: funding, culture, eng blog, interview signals.' },
    { cmd: '/career-ops contacto {company}',     arg: 'company',                                    label: 'LinkedIn outreach',    desc: 'Find hiring contacts + draft personalized outreach messages.' },
    { cmd: '/career-ops pdf {company}',          arg: 'company',                                    label: 'Tailored CV PDF',      desc: 'Generate ATS-optimized CV PDF tailored to a specific evaluated offer.' },
    { cmd: '/career-ops apply {url}',            arg: 'application URL',                            label: 'Apply assistant',      desc: 'Live form-filling assistant — drafts answers, STOPS before submit.' },
    { cmd: '/career-ops interview-prep {company}', arg: 'company',                                  label: 'Interview intel',      desc: 'Company-specific interview prep report.' },
    { cmd: '/career-ops followup',               arg: '',                                            label: 'Follow-up coach',      desc: 'Cadence advice + drafts for overdue follow-ups.' },
    { cmd: '/career-ops patterns',               arg: '',                                            label: 'Rejection patterns',   desc: 'Analyze outcomes to improve targeting.' },
  ],
  'interview-coach': [
    { cmd: 'prep {company}',    arg: 'company',                                      label: 'Prep brief',          desc: 'Company + role prep brief with story mapping.',  live: false },
    { cmd: 'mock {format}',     arg: 'behavioral / system design / technical',       label: 'Mock interview',      desc: 'Full simulated interview, 4–6 questions, scored.', live: true  },
    { cmd: 'practice',          arg: '',                                              label: 'Practice drills',     desc: 'Drill menu: DSA cadence, ramble control, depth.', live: true  },
    { cmd: 'debrief',           arg: '',                                              label: 'Post-interview debrief', desc: 'Same-day rapid capture after a real round.',   live: true  },
    { cmd: 'stories',           arg: '',                                              label: 'Storybank work',      desc: 'Build / improve / retire STAR+R stories.',        live: false },
    { cmd: 'hype',              arg: '',                                              label: 'Pre-interview hype',  desc: 'Confidence + 3×3 plan — run within 48h of interview.', live: false },
    { cmd: 'salary',            arg: '',                                              label: 'Comp coaching',       desc: 'Early/mid-process compensation conversations.',   live: false },
    { cmd: 'negotiate',         arg: '',                                              label: 'Negotiate offer',     desc: 'Post-offer negotiation coaching.',                live: false },
    { cmd: 'feedback {what}',   arg: 'what happened',                                label: 'Report outcome',      desc: 'Capture recruiter feedback / report an outcome.', live: false },
  ],
};

// ── Tracker helpers ──────────────────────────────────────────────────────────
const readT = (f) => existsSync(f) ? readFileSync(f, 'utf-8') : '';

function execJson(script, args = []) {
  return new Promise((resolve) => {
    execFile(process.execPath, [script, ...args], { cwd: ROOT, timeout: 180_000 }, (err, stdout, stderr) => {
      try { resolve({ ok: true, data: JSON.parse(stdout) }); }
      catch { resolve({ ok: !err, output: (stdout || '') + (stderr || '') }); }
    });
  });
}

function execText(script, args = []) {
  return new Promise((resolve) => {
    execFile(process.execPath, [script, ...args], { cwd: ROOT, timeout: 180_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout || '') + (stderr || '') });
    });
  });
}

function parseApplications() {
  const rows = [];
  for (const line of readT(APPS).split('\n')) {
    const m = line.match(/^\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|$/);
    if (!m) continue;
    const c = m.slice(1).map((x) => x.trim());
    if (c[0] === '#' || /^-+$/.test(c[0])) continue;
    rows.push({ num: c[0], date: c[1], company: c[2], role: c[3], score: c[4], status: c[5], pdf: c[6], report: c[7], notes: c[8] });
  }
  return rows;
}

function parsePipeline() {
  const items = [];
  for (const m of readT(PIPELINE).matchAll(/- \[([ x])\] (https?:\/\/\S+) \| ([^|]+) \| (.+)/g)) {
    items.push({
      done: m[1] === 'x', url: m[2], company: m[3].trim(),
      title: m[4].replace(/<!--[\s\S]*?-->/g, '').trim(),
    });
  }
  return items;
}

function parseScanHistory() {
  const lines = readT(SCAN_HIST).trim().split('\n').slice(1).filter(Boolean);
  const byStatus = {};
  let lastScan = '';
  const all = [];
  for (const line of lines) {
    const [url, first_seen, portal, title, company, status, location] = line.split('\t');
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (first_seen > lastScan) lastScan = first_seen;
    all.push({ url, first_seen, portal, title, company, status, location });
  }
  return { total: lines.length, byStatus, lastScan, rows: all.reverse() };
}

function parsePortals() {
  try {
    const cfg = yaml.load(readT(PORTALS)) || {};
    return {
      companies: (cfg.tracked_companies || []).filter((c) => c && typeof c === 'object')
        .map((c) => ({ name: c.name, enabled: c.enabled !== false, notes: c.notes || '', url: c.careers_url || '' })),
      queries: (cfg.search_queries || []).map((q) => ({ name: q.name, enabled: q.enabled !== false })),
    };
  } catch { return { companies: [], queries: [] }; }
}

function parseAgentInbox() {
  const items = [];
  for (const m of readT(AGENT_INBOX).matchAll(/^- \[([ x])\] (.+)$/gm)) {
    items.push({ done: m[1] === 'x', text: m[2] });
  }
  return items;
}

function sectionOf(text, name) {
  const re = new RegExp(`^## ${name}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$(?![\\s\\S]))`, 'm');
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

function parseCoachState() {
  const text = readT(COACH_STATE);
  if (!text) return null;
  const stories = [];
  for (const m of sectionOf(text, 'Storybank').matchAll(/^\| (S\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| [^|]+ \| ([^|]+) \|/gm)) {
    stories.push({ id: m[1], title: m[2].trim().replace(/~~/g, ''), skill: m[3].trim().replace(/~~/g, ''), skill2: m[4].trim().replace(/~~/g, ''), strength: m[5].trim() });
  }
  const details = {};
  for (const m of text.matchAll(/^#### (S\d+) — ([^\n]+)\n([\s\S]*?)(?=\n#### |\n## )/gm)) {
    details[m[1]] = { title: m[2].trim(), body: m[3].trim() };
  }
  const outcomes = [];
  for (const m of sectionOf(text, 'Outcome Log').matchAll(/^\| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)) {
    const c = [m[1],m[2],m[3],m[4],m[5],m[6]].map((s) => s.trim());
    if (c[0] === 'Date' || /^-+$/.test(c[0])) continue;
    outcomes.push({ date: c[0], company: c[1], role: c[2], round: c[3], result: c[4], notes: c[5] });
  }
  const intel = sectionOf(text, 'Interview Intelligence');
  const sub = (name) => { const m = intel.match(new RegExp(`### ${name}[^\\n]*\\n([\\s\\S]*?)(?=\\n### |$(?![\\s\\S]))`)); return m ? m[1].trim() : ''; };
  const questions = [];
  for (const m of sub('Question Bank').matchAll(/^\| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)) {
    const c = m.slice(1).map((s) => s.trim());
    if (c[0] === 'Date') continue;
    questions.push({ date: c[0], company: c[1], round: c[3], question: c[4], competency: c[5], outcome: c[7] });
  }
  const companyPatterns = [];
  for (const m of intel.matchAll(/^#### ([^\n]+)\n([\s\S]*?)(?=\n#### |\n### |$(?![\s\S]))/gm)) {
    companyPatterns.push({ company: m[1].trim(), body: m[2].trim() });
  }
  const sessionLog = [];
  for (const m of sectionOf(text, 'Session Log').matchAll(/^\| (\d{4}[^|]*) \| ([^|]+) \| ([^|]+) \|$/gm)) {
    sessionLog.push({ date: m[1].trim(), commands: m[2].trim(), outcomes: m[3].trim() });
  }
  const drill = sectionOf(text, 'Drill Progression');
  return {
    stories, details, outcomes, questions, companyPatterns, sessionLog,
    loops: sectionOf(text, 'Interview Loops \\(active\\)').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.replace(/^- /, '')),
    profileBullets: sectionOf(text, 'Profile').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)),
    strategy: sectionOf(text, 'Active Coaching Strategy').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)),
    coachingNotes: sectionOf(text, 'Coaching Notes').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)),
    effectivePatterns: sub('Effective Patterns \\(what works for this candidate\\)').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)),
    ineffectivePatterns: sub('Ineffective Patterns \\(what keeps not working\\)').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)),
    drillStage: (drill.match(/Current stage: (\S+)/) || [])[1] || '?',
    drillQueue: (drill.match(/Revisit queue: (.+)/) || [])[1] || '',
    gatesPassed: (drill.match(/Gates passed: (.+)/) || [])[1] || '',
  };
}

function listReports() {
  if (!existsSync(REPORTS_DIR)) return [];
  return readdirSync(REPORTS_DIR).filter((f) => f.endsWith('.md')).sort().reverse();
}

function buildTrackerData() {
  const apps = parseApplications();
  const pipeline = parsePipeline();
  const scan = parseScanHistory();
  const portals = parsePortals();
  const inbox = parseAgentInbox();
  const coach = parseCoachState();
  const reports = listReports();
  return {
    apps, pipeline, scan, portals, inbox, coach, reports, commands: COMMANDS, states: CANONICAL_STATES,
    stats: {
      activeInterviews: apps.filter((a) => a.status === 'Interview').length,
      pendingOffers: pipeline.filter((p) => !p.done).length,
      totalApplications: apps.length,
      queuedTasks: inbox.filter((i) => !i.done).length,
      trackedCompanies: portals.companies.filter((c) => c.enabled).length,
    },
  };
}

function updateAppField(company, role, field, value) {
  if (field === 'status' && !CANONICAL_STATES.includes(value)) throw Object.assign(new Error(`non-canonical status: ${value}`), { status: 400 });
  if (field === 'notes') value = value.replace(/\|/g, '/');
  const colIdx = field === 'status' ? 6 : 9;
  const lines = readT(APPS).split('\n');
  let hit = false;
  const out = lines.map((line) => {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length >= 10 && cells[3] === company && cells[4] === role) {
      hit = true;
      const parts = line.split('|');
      parts[colIdx] = ` ${value} `;
      return parts.join('|');
    }
    return line;
  });
  if (!hit) throw Object.assign(new Error(`row not found: ${company} / ${role}`), { status: 404 });
  writeFileSync(APPS, out.join('\n'), 'utf-8');
}

function togglePipelineItem(url, done) {
  const esc = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const original = readT(PIPELINE);
  const updated = original.replace(new RegExp(`- \\[[ x]\\] ${esc}`), `- [${done ? 'x' : ' '}] ${url}`);
  if (updated === original) throw Object.assign(new Error(`url not found in pipeline: ${url}`), { status: 404 });
  writeFileSync(PIPELINE, updated, 'utf-8');
}

function queueAgentTask(text) {
  if (!existsSync(AGENT_INBOX)) writeFileSync(AGENT_INBOX, '# Agent Inbox\n\n', 'utf-8');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const entry = `- [ ] ${stamp} — ${text.replace(/\n/g, ' ')}\n`;
  // Deduplicate: skip if same text already queued (ignoring timestamp)
  const existing = readT(AGENT_INBOX);
  if (existing.includes(text.slice(0, 80))) { return; }
  appendFileSync(AGENT_INBOX, entry, 'utf-8');
}

function removeAgentTask(text) {
  // Match on full text to avoid accidental deletion of similar tasks
  const lines = readT(AGENT_INBOX).split('\n');
  const before = lines.length;
  const filtered = lines.filter((l) => !(l.startsWith('- [ ]') && l.endsWith(text.trim())));
  // Fallback: if exact-end match found nothing, use substring match
  const out = filtered.length < before ? filtered : lines.filter((l) => !(l.startsWith('- [ ]') && l.includes(text.trim())));
  writeFileSync(AGENT_INBOX, out.join('\n'), 'utf-8');
}

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
    // ── Tracker routes ──────────────────────────────────────────────────────
    if (url.pathname === '/api/data') return sendJson(res, buildTrackerData());
    if (url.pathname === '/api/cadence') return sendJson(res, await execJson('followup-cadence.mjs'));
    if (url.pathname === '/api/patterns') return sendJson(res, await execJson('analyze-patterns.mjs'));
    if (url.pathname === '/api/cv') {
      res.writeHead(200, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
      return res.end(readT(CV_PATH));
    }
    if (url.pathname.startsWith('/api/report/')) {
      const name = decodeURIComponent(url.pathname.slice('/api/report/'.length));
      if (name.includes('..') || name.includes('/')) return sendJson(res, { error: 'bad name' }, 400);
      const file = path.join(REPORTS_DIR, name);
      if (!existsSync(file)) return sendJson(res, { error: 'not found' }, 404);
      res.writeHead(200, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
      return res.end(readFileSync(file, 'utf-8'));
    }
    if (url.pathname === '/api/status' && req.method === 'POST') {
      const body = await readJsonBody(req);
      updateAppField(body.company, body.role, 'status', body.status);
      return sendJson(res, { ok: true });
    }
    if (url.pathname === '/api/notes' && req.method === 'POST') {
      const body = await readJsonBody(req);
      updateAppField(body.company, body.role, 'notes', body.notes);
      return sendJson(res, { ok: true });
    }
    if (url.pathname === '/api/pipeline-toggle' && req.method === 'POST') {
      const body = await readJsonBody(req);
      togglePipelineItem(body.url, body.done);
      return sendJson(res, { ok: true });
    }
    if (url.pathname === '/api/queue' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.text?.trim()) return sendJson(res, { error: 'empty' }, 400);
      queueAgentTask(body.text.trim());
      return sendJson(res, { ok: true });
    }
    if (url.pathname === '/api/queue-remove' && req.method === 'POST') {
      const body = await readJsonBody(req);
      removeAgentTask(body.text);
      return sendJson(res, { ok: true });
    }
    if (url.pathname === '/api/scan' && req.method === 'POST') return sendJson(res, await execText('scan.mjs'));
    if (url.pathname === '/api/scan-verify' && req.method === 'POST') return sendJson(res, await execText('scan.mjs', ['--verify']));
    if (url.pathname === '/api/liveness' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!/^https?:\/\//.test(body.url || '')) return sendJson(res, { error: 'bad url' }, 400);
      return sendJson(res, await execText('check-liveness.mjs', [body.url]));
    }
    if (url.pathname === '/api/pipeline-health' && req.method === 'POST') return sendJson(res, await execText('verify-pipeline.mjs'));
    // ── End tracker routes ──────────────────────────────────────────────────
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
