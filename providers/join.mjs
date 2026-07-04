// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// join.com provider — reads the embedded Next.js SSR data blob off a public
// company career page (`https://join.com/companies/<slug>`). join.com is a
// shared multi-tenant domain (like cutshort.io), so this is NOT auto-detected
// — set `provider: join` explicitly per portal entry.
//
// The page ships a `<script id="__NEXT_DATA__" type="application/json">` blob
// containing `props.pageProps.initialState.jobs.items` — the full job list
// for that company, no auth, no extra request. There is no separate public
// JSON/REST endpoint (the `/candidate-api/graphql` endpoint exists but has
// introspection disabled and no documented public jobs-by-company query); the
// SSR blob is the only zero-token surface, so this provider is a one-shot
// HTML fetch + JSON extraction — no pagination, since job.com pages we've
// observed render the whole per-company list server-side in one response.

const JOIN_HOST = 'join.com';

function resolveSlug(entry) {
  const raw = typeof entry.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== JOIN_HOST) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  // Expect /companies/<slug>
  if (parts[0] !== 'companies' || !parts[1]) return null;
  return parts[1];
}

function buildPageUrl(slug) {
  return `https://${JOIN_HOST}/companies/${encodeURIComponent(slug)}`;
}

/**
 * Extract the `__NEXT_DATA__` JSON blob from a join.com company page.
 * Exported for unit tests.
 *
 * @param {string} html
 * @returns {any|null}
 */
export function extractNextData(html) {
  if (typeof html !== 'string') return null;
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/**
 * Parse the join.com `initialState.jobs.items` array into normalized jobs.
 * Exported for unit tests.
 *
 * join.com job items look like:
 *   { id, idParam, title, workplaceType, city: {cityName, countryName}, country: {iso3166} }
 * `idParam` is the URL slug used on the public job detail page
 * (`https://join.com/companies/<slug>/jobs/<idParam>`).
 *
 * @param {any} nextData
 * @param {string} companySlug
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseJoinJobs(nextData, companySlug, companyName) {
  const items = nextData?.props?.pageProps?.initialState?.jobs?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map(j => {
      const title = String(j?.title || '').trim();
      const idParam = j?.idParam;
      if (!title || !idParam) return null;
      const city = j?.city?.cityName || '';
      const country = j?.city?.countryName || '';
      const remote = j?.workplaceType === 'REMOTE' ? 'Remote' : '';
      const location = [city, country].filter(Boolean).join(', ') || remote;
      return {
        title,
        url: `https://${JOIN_HOST}/companies/${encodeURIComponent(companySlug)}/jobs/${encodeURIComponent(idParam)}`,
        company: companyName,
        location,
      };
    })
    .filter(Boolean);
}

/** @type {Provider} */
export default {
  id: 'join',

  // Not auto-detected — join.com is a shared multi-tenant host with no
  // per-entry signal beyond the /companies/<slug> path, same rationale as
  // cutshort.io. Require explicit `provider: join` configuration.
  detect() {
    return null;
  },

  async fetch(entry, ctx) {
    const slug = resolveSlug(entry);
    if (!slug) throw new Error(`join: cannot derive company slug for ${entry.name} (expected careers_url like https://join.com/companies/<slug>)`);
    const pageUrl = buildPageUrl(slug);
    const html = await ctx.fetchText(pageUrl, { redirect: 'error' });
    const nextData = extractNextData(html);
    if (!nextData) throw new Error(`join: could not find __NEXT_DATA__ blob for ${entry.name} — page structure may have changed`);
    return parseJoinJobs(nextData, slug, entry.name);
  },
};
