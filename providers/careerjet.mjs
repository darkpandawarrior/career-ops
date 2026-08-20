// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Careerjet provider — the official v4 Job Search API.
//
// CORRECTION (2026-08-21): an earlier draft of this provider targeted the
// legacy unauthenticated endpoint (`public.api.careerjet.net/search` +
// `affid`) on the strength of a fetch performed 2026-08-20. Re-verified live
// today: that endpoint now returns HTTP 401 `"The legacy Job Search API is
// only accessible for authenticated legacy users. Please use the new API
// (v4) instead."` for every affid tried, including the placeholder and a
// widely-shared public sample affid. It is dead, not merely un-registered —
// there is no unauthenticated path into Careerjet's listings anymore.
//
// The real, current API (fetched live 2026-08-21 from
// https://www.careerjet.com/partners/api, which itself required no auth to
// read): endpoint `https://search.api.careerjet.net/v4/query`, HTTPS only —
// NOT the HTTP-only legacy host. Auth is HTTP Basic: the API key as the
// username, an empty password. The key comes from a Careerjet "Publisher"
// account (careerjet.com/partners/publishers → "Sign up now") — that program
// is framed as "display Careerjet's listings on your site to earn revenue",
// which is a different use case than a private job-search tool, and approval
// is NOT confirmed to be instant/self-serve. Treat obtaining a key as a real
// open decision, not a formality — see NEEDS SIDDHARTH in the implementation
// report.
//
// Required GET params (per the live-fetched docs): locale_code, keywords,
// user_ip, user_agent (403 "Missing param user_ip or user_agent" without
// them — verified live, unauthenticated, before the 401 auth check even
// applies). Optional: location, page, page_size (<=100), sort.
//
// Response shapes (from the docs page, not independently verified against a
// real key — no key exists yet):
//   success:        { type: 'JOBS', hits, pages, jobs: [...] }
//   ambiguous loc:  { type: 'LOCATIONS', locations: [...] } — treated as zero
//                   jobs, not an error: the location string didn't resolve
//                   to one place, not a request failure.
//   job shape:      { title, company, date, description, locations, url, ... }
//   url is a jobviewtrack.com tracking redirect, not the employer's own
//   posting page — same caveat cutshort.mjs's SEO-listing snapshot carries.
//
// STAFFING-AGENCY REPOST RISK (documented, unverified against live data):
// agencies are known to repost the same requisition with a fresh
// jobviewtrack.com tracking URL, which defeats scan.mjs's URL-based dedup.
// Pair this provider with a title+company fuzzy dedup pass before trusting
// its new_added count.

import { BROWSER_LIKE_USER_AGENT } from './_http.mjs';

const API_HOST = 'search.api.careerjet.net';
const API_ENDPOINT = `https://${API_HOST}/v4/query`;

// Per the docs: page 1-10, page_size <=100. 10 pages is the API's own ceiling,
// not a courtesy cap this provider imposes.
const MAX_PAGES = 10;
const PAGE_SIZE = 100;
const INTER_PAGE_DELAY_MS = 200;

function sleep(ms, ctx) {
  if (typeof ctx?.sleep === 'function') return ctx.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveApiKey() {
  const key = process.env.CAREERJET_API_KEY;
  return typeof key === 'string' && key.trim() ? key.trim() : null;
}

function authHeader(apiKey) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
}

/**
 * Normalize one v4 job record. Exported for unit tests.
 *
 * @param {any} j
 * @returns {{title: string, url: string, company: string, location: string, postedAt?: number} | null}
 */
export function normalizeCareerjetJob(j) {
  if (!j || typeof j !== 'object') return null;
  const title = typeof j.title === 'string' ? j.title.trim() : '';
  if (!title) return null;
  const url = typeof j.url === 'string' ? j.url.trim() : '';
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const company = typeof j.company === 'string' && j.company.trim() ? j.company.trim() : '';
  const location = typeof j.locations === 'string' ? j.locations.trim() : '';
  const job = { title, url, company, location };
  const ts = Date.parse(j.date || '');
  if (!Number.isNaN(ts)) job.postedAt = ts;
  return job;
}

function buildUrl({ keyword, location, localeCode }, page, apiKey) {
  const params = new URLSearchParams({
    locale_code: localeCode,
    keywords: keyword,
    user_ip: process.env.CAREERJET_USER_IP || '203.0.113.10',
    user_agent: BROWSER_LIKE_USER_AGENT,
    page_size: String(PAGE_SIZE),
    page: String(page),
    sort: 'date',
  });
  if (location) params.set('location', location);
  return `${API_ENDPOINT}?${params.toString()}`;
}

/** @param {import('./_types.js').PortalEntry} entry */
function resolveConfig(entry) {
  const keyword = typeof entry.keyword === 'string' ? entry.keyword.trim() : '';
  if (!keyword) return null;
  const location = typeof entry.location === 'string' ? entry.location.trim() : 'India';
  const localeCode = typeof entry.locale_code === 'string' ? entry.locale_code.trim() : 'en_IN';
  return { keyword, location, localeCode };
}

/** @type {Provider} */
export default {
  id: 'careerjet',

  detect(entry) {
    if (entry.provider !== 'careerjet') return null;
    const config = resolveConfig(entry);
    return config ? { url: API_ENDPOINT } : null;
  },

  async fetch(entry, ctx) {
    const config = resolveConfig(entry);
    if (!config) throw new Error(`careerjet: entry "${entry.name}" needs a non-empty \`keyword\` field`);
    const apiKey = resolveApiKey();
    if (!apiKey) {
      throw new Error(
        'careerjet: CAREERJET_API_KEY is not set. Register a Publisher account at '
        + 'https://www.careerjet.com/partners/publishers, then add CAREERJET_API_KEY=<key> to .env.',
      );
    }
    const headers = { authorization: authHeader(apiKey) };

    const all = [];
    let totalPages = 1;
    for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      // redirect:'error' prevents SSRF via a server-side redirect off the pinned API host.
      const json = await ctx.fetchJson(buildUrl(config, page, apiKey), { headers, redirect: 'error' });
      if (!json || typeof json !== 'object') {
        throw new Error(`careerjet: unexpected response for "${entry.name}" page ${page}`);
      }
      if (json.type === 'LOCATIONS') break; // ambiguous/unresolved location — zero jobs, not an error
      if (json.type !== 'JOBS' || !Array.isArray(json.jobs)) {
        throw new Error(`careerjet: unexpected response shape for "${entry.name}" page ${page} — keys: [${Object.keys(json).join(', ')}]`);
      }
      all.push(...json.jobs);
      totalPages = Number.isInteger(json.pages) && json.pages > 0 ? json.pages : 1;
      if (json.jobs.length === 0) break;
    }
    return all.map(normalizeCareerjetJob).filter(Boolean);
  },
};
