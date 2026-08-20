// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';

// Y Combinator "Work at a Startup" provider — reads the embedded Inertia.js
// JSON on workatastartup.com's public, robots-permitted category listing
// pages (`https://www.workatastartup.com/jobs/l/<slug>`, e.g.
// `software-engineer`). Same shape as cutshort.mjs's __NEXT_DATA__ read, one
// framework over: Inertia serializes the page props into a
// `data-page="{...}"` attribute (HTML-entity-encoded JSON) instead of a
// `<script>` blob.
//
// Verified live 2026-08-20: the default career-ops UA gets HTTP 406 on this
// path — but so does a full browser UA with no Accept header. What actually
// flips it to HTTP 200 is sending `Accept: text/html,...` — the endpoint is
// content-negotiating, not UA-sniffing. `data-page` decodes to
// `{ component: "jobs/public/pages/JobsPage", props: { jobs: [...], roleLinks: [...], ... } }`.
// Each job carries `id`, `title`, `location`, `companyName`, `companySlug`,
// `roleType`, `jobType`, `salary`; there is no dedicated Android/Mobile
// roleLink — "Engineering" (`/jobs/l/software-engineer`) is the closest
// category and the only one wired below.
//
// `applyUrl` is an auth-gated `account.ycombinator.com/authenticate?...`
// redirect (a signup/login flow, not a job page) — NOT used as the emitted
// URL. `https://www.workatastartup.com/jobs/{id}` is the public job detail
// page (verified HTTP 200, no auth) and is what this provider emits instead.
//
// No real pagination or filtering: `?query=`/`?role=`/`?q=` are all silently
// ignored (verified live — identical 29-job payload with or without them),
// same bounded-snapshot caveat cutshort.mjs documents for its own board.
//
// robots.txt (fetched 2026-08-20): `User-Agent: *` / `Disallow:` (empty) —
// fully open.
//
// Not auto-detected: like cutshort, this is a shared multi-tenant board with
// no per-entry signal to key off. Configure explicitly with
// `provider: workatastartup` + `careers_url` pointing at the desired
// `/jobs/l/<slug>` category page.

const HOST = 'www.workatastartup.com';
const ACCEPT_HEADER = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8';

/** @param {string} url */
function assertWorkAtAStartupUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`workatastartup: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`workatastartup: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== HOST) {
    throw new Error(`workatastartup: untrusted hostname "${parsed.hostname}" — must be ${HOST}`);
  }
  if (!/^\/jobs\/l\/[a-z0-9-]+$/i.test(parsed.pathname)) {
    throw new Error(`workatastartup: careers_url must be a /jobs/l/<slug> category page: ${url}`);
  }
  return url;
}

function resolveListingUrl(entry) {
  const raw = typeof entry.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  try {
    assertWorkAtAStartupUrl(raw);
  } catch {
    return null;
  }
  return raw;
}

/**
 * Extract the embedded Inertia `data-page` job array out of a listing page.
 * Exported for unit tests (avoids re-fetching a live page to test parsing).
 *
 * @param {string} html
 * @returns {any[]}
 */
export function extractJobsFromHtml(html) {
  const m = /data-page="([^"]*)"/.exec(String(html || ''));
  if (!m) return [];
  // Shared decoder, not a private copy — see _html-entities.mjs's header for
  // why per-provider entity decoders drift.
  const decoded = decodeEntities(m[1]);
  let data;
  try {
    data = JSON.parse(decoded);
  } catch {
    return [];
  }
  const jobs = data?.props?.jobs;
  return Array.isArray(jobs) ? jobs : [];
}

/**
 * Normalize a single Work at a Startup job record. Exported for unit tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:   `title`, trimmed.
 *   - url:     `https://www.workatastartup.com/jobs/{id}` — the public job
 *              detail page, NOT `applyUrl` (an auth-gated signup redirect).
 *              Requires a positive integer `id`; malformed/missing drops the row.
 *   - company: `companyName`, falling back to the portal entry name.
 *   - location: `location`, trimmed.
 *
 * @param {any} j
 * @param {string} [fallbackCompany]
 */
export function normalizeWorkAtAStartupJob(j, fallbackCompany) {
  if (!j || typeof j !== 'object') return null;

  const title = typeof j.title === 'string' ? j.title.trim() : '';
  if (!title) return null;

  const id = j.id;
  if (!Number.isInteger(id) || id <= 0) return null;
  const url = `https://${HOST}/jobs/${id}`;

  const company = (typeof j.companyName === 'string' && j.companyName.trim())
    || (typeof fallbackCompany === 'string' ? fallbackCompany.trim() : '')
    || 'Y Combinator — Work at a Startup';

  const location = typeof j.location === 'string' ? j.location.trim() : '';

  return { title, url, company, location };
}

/** @type {Provider} */
export default {
  id: 'workatastartup',

  detect(entry) {
    if (entry.provider !== 'workatastartup') return null;
    const url = resolveListingUrl(entry);
    return url ? { url } : null;
  },

  async fetch(entry, ctx) {
    const url = resolveListingUrl(entry);
    if (!url) throw new Error(`workatastartup: careers_url must be a valid https://www.workatastartup.com/jobs/l/<slug> page for ${entry.name}`);
    // redirect:'error' + the host/path check above keep the fetch pinned to
    // the exact permitted listing-page surface (SSRF defence).
    const html = await ctx.fetchText(url, { redirect: 'error', headers: { accept: ACCEPT_HEADER } });
    const jobs = extractJobsFromHtml(html);
    return jobs.map(j => normalizeWorkAtAStartupJob(j, entry.name)).filter(Boolean);
  },
};
