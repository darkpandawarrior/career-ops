// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// JazzHR provider — parses the public hosted careers page job table.
// Auto-detects from careers_url pattern `https://<slug>.applytojob.com`.
//
// JazzHR's public API (https://api.jazz.co) requires a per-account auth
// token — no zero-token surface there. The hosted careers page
// (`/apply/jobs/` or `/apply/jobs`) is server-rendered HTML with a stable
// table structure across tenants (verified against 3 live tenants):
//   <table id="jobs_table"><tr id="row_job_...">
//     <td><a class="job_title_link" href="/apply/jobs/details/<id>?&">Title</a>
//         <span class="resumator_department">Dept/status</span></td>
//     <td>Location</td>
//   </tr></table>
// There is no pagination on this page — JazzHR renders the full open-job
// list in one response.

import { decodeEntities } from './_html-entities.mjs';

const ALLOWED_JAZZHR_HOST_RE = /^[a-z0-9][a-z0-9-]*\.applytojob\.com$/;

function resolveListUrl(entry) {
  const raw = typeof entry.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!ALLOWED_JAZZHR_HOST_RE.test(parsed.hostname)) return null;
  return `https://${parsed.hostname}/apply/jobs/`;
}

/** @param {string} s */
function clean(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Parse a JazzHR `/apply/jobs/` careers page. Exported for unit tests.
 *
 * @param {string} html
 * @param {string} origin — e.g. `https://nro.applytojob.com`
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseJazzhrJobs(html, origin, companyName) {
  if (typeof html !== 'string') return [];
  const jobs = [];
  const rowRe = /<tr id="row_job_[^"]*"[^>]*>([\s\S]*?)<\/tr>/g;
  let row;
  while ((row = rowRe.exec(html)) !== null) {
    const block = row[1];
    const linkM = block.match(/<a[^>]*class="job_title_link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkM) continue;
    const title = clean(linkM[2]);
    if (!title) continue;

    let href = decodeEntities(linkM[1]).trim();
    // JazzHR renders a trailing `?&` query string on every link — harmless but
    // pointless downstream, so normalize it away.
    href = href.replace(/\?&$/, '');
    if (!href) continue;
    const url = /^https?:\/\//i.test(href) ? href : `${origin}${href.startsWith('/') ? href : '/' + href}`;

    // Two <td> cells per row: first holds title+department, second holds location.
    const cells = [...block.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
    const location = cells[1] ? clean(cells[1][1]) : '';

    jobs.push({ title, url, company: companyName, location });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'jazzhr',

  detect(entry) {
    const listUrl = resolveListUrl(entry);
    return listUrl ? { url: listUrl } : null;
  },

  async fetch(entry, ctx) {
    const listUrl = resolveListUrl(entry);
    if (!listUrl) throw new Error(`jazzhr: cannot derive careers page URL for ${entry.name}`);
    const origin = new URL(listUrl).origin;
    const html = await ctx.fetchText(listUrl, { redirect: 'error', headers: { accept: 'text/html' } });
    return parseJazzhrJobs(html, origin, entry.name);
  },
};
