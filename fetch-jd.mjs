#!/usr/bin/env node
/*
 * fetch-jd.mjs — Fetch a single job's description as clean text via the ATS
 * provider's per-job API (NOT a full HTML page).
 *
 * Usage:
 *   node fetch-jd.mjs "<job-url>"            # prints clean JD text to stdout
 *   node fetch-jd.mjs "<job-url>" --json     # prints {title, company, location, text}
 *
 * Exit 0 + non-empty stdout on success. Exit 1 (empty/short output) when the
 * provider is unknown or the API misses, so callers (batch-runner.sh) can fall
 * back to the worker's WebFetch path.
 *
 * JD text on stdout, exit 0, when a known ATS answers with real content.
 * Exit 1 with empty stdout and no stderr noise otherwise — a miss is the
 * expected "fall back to the browser path" case, not an error condition, and
 * a visible miss is the whole point: never a fabricated JD.
 *
 * Coverage is JD_TEXT_API_ATS (liveness-api.mjs), including company careers
 * pages that carry only a Greenhouse `?gh_jid=`, and canonical/share-link
 * Workable postings (description, requirements and benefits).
 * Every fetch runs through fetchJdViaKnownApi() in browser-extract.mjs
 * — the same dispatch its own `jd` mode uses — so this script and the
 * interactive extractor cannot drift on which ATS is API-fetchable.
 */

import { fileURLToPath } from 'node:url';
import { isMainModule } from './lib/is-main-module.mjs';
// Shared implementation: it refuses non-emittable code points, so `&#0;` stays
// literal instead of decoding to a raw NUL that would land in scan-history.
export { decodeEntities } from './providers/_html-entities.mjs';
import { decodeEntities } from './providers/_html-entities.mjs';
import { fetchJson } from './providers/_http.mjs';

const MIN_USEFUL = 200; // chars; below this we treat as a miss and fall back
const FETCH_TIMEOUT_MS = 12000; // bound each request so a hung ATS endpoint can't stall a worker

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&#x27;': "'", '&apos;': "'", '&nbsp;': ' ', '&mdash;': '-', '&ndash;': '-',
  '&rsquo;': "'", '&lsquo;': "'", '&ldquo;': '"', '&rdquo;': '"', '&hellip;': '...',
};


export function htmlToText(html) {
  if (!html) return '';
  // Decode entities FIRST (Greenhouse `content` is entity-encoded HTML, e.g.
  // &lt;div&gt;), THEN strip tags — otherwise encoded tags survive as text.
  return decodeEntities(String(html))
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br)\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// ── Provider detectors + single-job fetchers (reuse _http.mjs fetchJson) ──

async function greenhouse(url) {
  // job-boards.greenhouse.io/{board}/jobs/{id} or boards.greenhouse.io/{board}/jobs/{id}
  const m = url.match(/greenhouse\.io\/(?:embed\/job_app\?for=)?([^/?#]+)\/jobs\/(\d+)/)
        || url.match(/greenhouse\.io\/([^/?#]+).*[?&]gh_jid=(\d+)/);
  if (!m) return null;
  const [, board, id] = m;
  const j = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}?questions=false`, { timeoutMs: FETCH_TIMEOUT_MS });
  return { title: j.title || '', company: board, location: j.location?.name || '', text: htmlToText(j.content) };
}

async function ashby(url) {
  // jobs.ashbyhq.com/{org}/{postingId}
  const m = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([^/?#]+)/i);
  if (!m) return null;
  const [, org, postingId] = m;
  const j = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`, { timeoutMs: FETCH_TIMEOUT_MS });
  const jobs = Array.isArray(j?.jobs) ? j.jobs : [];
  const post = jobs.find(p => p.id === postingId || p.jobId === postingId) || jobs.find(p => (p.jobUrl || '').includes(postingId));
  if (!post) return null;
  const text = post.descriptionPlain || htmlToText(post.descriptionHtml) || '';
  return { title: post.title || '', company: org, location: post.location || post.locationName || '', text };
}

async function lever(url) {
  // jobs.lever.co/{co}/{id} (also api.eu.lever.co)
  const m = url.match(/lever\.co\/([^/?#]+)\/([0-9a-f-]{8,})/i);
  if (!m) return null;
  const [, co, id] = m;
  const eu = /jobs\.eu\.lever\.co/.test(url);
  const host = eu ? 'api.eu.lever.co' : 'api.lever.co';
  const j = await fetchJson(`https://${host}/v0/postings/${co}/${id}`, { timeoutMs: FETCH_TIMEOUT_MS });
  const parts = [j.descriptionPlain || htmlToText(j.description)];
  for (const l of (j.lists || [])) parts.push(`\n${l.text}\n${htmlToText(l.content)}`);
  if (j.additionalPlain || j.additional) parts.push(j.additionalPlain || htmlToText(j.additional));
  return { title: j.text || '', company: co, location: j.categories?.location || '', text: parts.filter(Boolean).join('\n').trim() };
}

async function workday(url) {
  // {tenant}.{dc}.myworkdayjobs.com[/{locale}]/{site}/job/{path}_{reqid}
  const m = url.match(/^https:\/\/([\w-]+)\.(wd[\w-]*)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)\/job\/(.+?)(?:\?.*)?$/);
  if (!m) return null;
  const [, tenant, dc, site, jobPath] = m;
  const host = `${tenant}.${dc}.myworkdayjobs.com`;
  // CXS job-detail endpoint mirrors the careers path after /job/
  const j = await fetchJson(`https://${host}/wday/cxs/${tenant}/${site}/job/${jobPath}`, { timeoutMs: FETCH_TIMEOUT_MS });
  const info = j?.jobPostingInfo || {};
  const text = info.jobDescription ? htmlToText(info.jobDescription) : '';
  return { title: info.title || '', company: tenant, location: info.location || '', text };
}

const PROVIDERS = [greenhouse, ashby, lever, workday];

// Classify a job URL by ATS provider without fetching (host-based). Returns the
// provider id, or null when no provider handles the host (caller falls back to
// WebFetch). Exported for tests.
export function detectProvider(url) {
  const u = String(url || '');
  if (/greenhouse\.io\//.test(u)) return 'greenhouse';
  if (/jobs\.ashbyhq\.com\//.test(u)) return 'ashby';
  if (/lever\.co\//.test(u)) return 'lever';
  if (/\.myworkdayjobs\.com\//.test(u)) return 'workday';
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  node fetch-jd.mjs <url> [--json]
  node fetch-jd.mjs --help

Options:
  --help, -h  Print this usage block and exit`);
    process.exit(0);
  }

  const json = args.includes('--json');
  const url = args.find(a => /^https?:\/\//.test(a));
  if (!url) { process.stderr.write('usage: node fetch-jd.mjs <url> [--json]\n'); process.exit(2); }

  let result = null;
  for (const p of PROVIDERS) {
    try {
      const r = await p(url);
      if (r && (r.text || '').length >= MIN_USEFUL) { result = r; break; }
    } catch { /* try next / fall back */ }
  }

  if (!result) process.exit(1); // signal caller to fall back to WebFetch

  if (json) {
    process.stdout.write(JSON.stringify(result));
  } else {
    const head = [result.title && `# ${result.title}`, result.company && `Company: ${result.company}`, result.location && `Location: ${result.location}`].filter(Boolean).join('\n');
    process.stdout.write(`${head}\n\n${result.text}\n`);
  }
}

// Only run the CLI when invoked directly, so the module can be imported by tests.
if (isMainModule(import.meta.url)) {
  main().catch(err => { process.stderr.write(`fetch-jd error: ${err.message}\n`); process.exit(1); });
}
