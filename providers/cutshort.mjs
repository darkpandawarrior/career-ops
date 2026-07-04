// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// CutShort provider — reads the embedded Next.js JSON on CutShort's public,
// robots-permitted SEO job-listing pages (`https://cutshort.io/jobs/<slug>`,
// e.g. `android-developer-jobs-in-pune`). These are static-ish landing pages,
// NOT the interactive/login-gated search app (`cutshort.io/jobs?q=...`) —
// the listing app requires a session and is out of scope (see
// docs/liveness-bot-block-policy.md's cutshort.io entry for that surface).
//
// Verified live 2026-07-05: `/jobs/<slug>` returns HTML with a
// `<script id="__NEXT_DATA__">` blob containing
// `props.pageProps.dehydratedState.queries[0].state.data.data.pageData.jobs`,
// a fixed array of ~50 postings. There is no real pagination — `?page=N` is
// ignored (returns the identical page) — so one slug = one bounded snapshot.
// cutshort.io/robots.txt disallows `/view/j/`, `/vj/`, `/profile/`, `/apply/`;
// it does NOT disallow `/jobs/<slug>` (the page fetched here) or `/job/<slug>`
// (the per-posting detail URL embedded in the payload), so this stays inside
// the permitted surface.
//
// Not auto-detected: cutshort.io is a shared multi-tenant board, not a
// per-company subdomain, so there's no per-entry signal to key off. Configure
// explicitly with `provider: cutshort` + `careers_url` pointing at the desired
// `/jobs/<slug>` landing page.

const CUTSHORT_HOST = 'cutshort.io';

/** @param {string} url */
function assertCutshortUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`cutshort: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`cutshort: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== CUTSHORT_HOST) {
    throw new Error(`cutshort: untrusted hostname "${parsed.hostname}" — must be ${CUTSHORT_HOST}`);
  }
  if (!/^\/jobs\/[a-z0-9-]+$/i.test(parsed.pathname)) {
    throw new Error(`cutshort: careers_url must be a /jobs/<slug> listing page: ${url}`);
  }
  return url;
}

function resolveListingUrl(entry) {
  const raw = typeof entry.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  try {
    assertCutshortUrl(raw);
  } catch {
    return null;
  }
  return raw;
}

/**
 * Extract the embedded __NEXT_DATA__ job array out of a CutShort listing page.
 * Exported for unit tests (avoids re-fetching a live page to test parsing).
 *
 * @param {string} html
 * @returns {any[]}
 */
export function extractJobsFromHtml(html) {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html || ''));
  if (!m) return [];
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  const queries = data?.props?.pageProps?.dehydratedState?.queries;
  if (!Array.isArray(queries)) return [];
  for (const q of queries) {
    const jobs = q?.state?.data?.data?.pageData?.jobs;
    if (Array.isArray(jobs)) return jobs;
  }
  return [];
}

/**
 * Normalize a single CutShort job record. Exported for unit tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:    `headline`, trimmed.
 *   - url:      `publicUrl` — host-locked to cutshort.io; malformed/off-host
 *               drops the row. Display-only (never server-fetched), same
 *               rationale as recruitee/breezy's per-offer URL handling.
 *   - company:  `companyDetails.name`, falling back to the portal entry name
 *               (CutShort anonymizes some client postings behind a generic
 *               description instead of a real company name).
 *   - location: `locations[]` joined with ", ".
 *
 * @param {any} j
 * @param {string} [fallbackCompany]
 */
export function normalizeCutshortJob(j, fallbackCompany) {
  if (!j || typeof j !== 'object') return null;

  const title = typeof j.headline === 'string' ? j.headline.trim() : '';
  if (!title) return null;

  let url = '';
  const rawUrl = typeof j.publicUrl === 'string' ? j.publicUrl.trim() : '';
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:' && parsed.hostname === CUTSHORT_HOST) url = parsed.href;
    } catch {
      // malformed → leave url = '' → dropped below
    }
  }
  if (!url) return null;

  const company = (typeof j.companyDetails?.name === 'string' && j.companyDetails.name.trim())
    || (typeof fallbackCompany === 'string' ? fallbackCompany.trim() : '')
    || 'CutShort';

  const location = Array.isArray(j.locations)
    ? j.locations.filter(l => typeof l === 'string' && l.trim()).join(', ')
    : '';

  return { title, url, company, location };
}

/** @type {Provider} */
export default {
  id: 'cutshort',

  detect(entry) {
    if (entry.provider !== 'cutshort') return null;
    const url = resolveListingUrl(entry);
    return url ? { url } : null;
  },

  async fetch(entry, ctx) {
    const url = resolveListingUrl(entry);
    if (!url) throw new Error(`cutshort: careers_url must be a valid https://cutshort.io/jobs/<slug> page for ${entry.name}`);
    // redirect:'error' + the host/path check above keep the fetch pinned to
    // the exact permitted listing-page surface (SSRF defence).
    const html = await ctx.fetchText(url, { redirect: 'error' });
    const jobs = extractJobsFromHtml(html);
    return jobs.map(j => normalizeCutshortJob(j, entry.name)).filter(Boolean);
  },
};
