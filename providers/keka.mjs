// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Keka provider — Indian HR/ATS platform (keka.com), common among mid-size
// Indian tech companies. Auto-detects from careers_url pattern
// `https://<tenant>.keka.com/careers[...]`.
//
// The public careers page (`<tenant>.keka.com/careers`) is a thin shell that
// client-side fetches a static HTML fragment from
// `/ats/documents/{identifier}/careerportal/{hash}.html`, where `{identifier}`
// is a UUID unique per tenant. That same identifier is the path segment used
// by the real jobs feed, a zero-auth JSON endpoint:
//   https://<tenant>.keka.com/careers/api/embedjobs/default/active/{identifier}
// Confirmed live against two independent tenants (jupiter.keka.com,
// cars24.keka.com) — same UUID extracted from the shell's fetch() call works
// directly against embedjobs without needing to fetch the fragment page.
//
// Two-request flow (both zero-token, no JS execution needed):
//   1. GET <tenant>.keka.com/careers → regex out the identifier UUID.
//   2. GET <tenant>.keka.com/careers/api/embedjobs/default/active/{identifier}
//      → JSON array of jobs.
//
// Per-tenant subdomains are the variable part, so SSRF defence uses a regex
// match on `<safe-tenant>.keka.com` rather than a static allowlist (same
// approach as recruitee/bamboohr/breezy).

const KEKA_HOST_RE = /^[a-z0-9][a-z0-9-]*\.keka\.com$/;

// Matches the identifier UUID out of the shell's client-side fetch() call:
//   fetch('/ats/documents/{uuid}/careerportal/{hash}.html')
const IDENTIFIER_RE = /\/ats\/documents\/([0-9a-f-]{36})\/careerportal\//i;

/** @param {string} url */
function assertKekaUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`keka: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`keka: URL must use HTTPS: ${url}`);
  if (!KEKA_HOST_RE.test(parsed.hostname)) {
    throw new Error(`keka: untrusted hostname "${parsed.hostname}" — must match <tenant>.keka.com`);
  }
  return url;
}

/**
 * Resolve the tenant origin (`https://<tenant>.keka.com`) and careers page URL
 * from an entry. Honours an explicit `api:` URL (treated as the careers page
 * to scrape the identifier from), else parses `careers_url`.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {{ origin: string, careersUrl: string } | null}
 */
function resolveOrigin(entry) {
  const rawApi = typeof entry.api === 'string' ? entry.api : '';
  const rawCareers = typeof entry.careers_url === 'string' ? entry.careers_url : '';
  const raw = (rawApi || rawCareers).trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!KEKA_HOST_RE.test(parsed.hostname)) return null;
  const origin = `https://${parsed.hostname}`;
  return { origin, careersUrl: `${origin}/careers` };
}

/** @type {Provider} */
export default {
  id: 'keka',

  detect(entry) {
    const resolved = resolveOrigin(entry);
    return resolved ? { url: resolved.careersUrl } : null;
  },

  async fetch(entry, ctx) {
    const resolved = resolveOrigin(entry);
    if (!resolved) throw new Error(`keka: cannot derive careers URL for ${entry.name}`);
    const { origin, careersUrl } = resolved;
    assertKekaUrl(careersUrl);

    const html = await ctx.fetchText(careersUrl, { redirect: 'error' });
    const m = html.match(IDENTIFIER_RE);
    // Fail closed: a missing identifier is a scraper break (Keka changed its
    // shell template), not an empty board — throw so the scan logs it instead
    // of silently reporting zero jobs.
    if (!m) throw new Error(`keka: ${entry.name} careers page is missing the embedjobs identifier (structure changed?)`);
    const identifier = m[1];

    const apiUrl = `${origin}/careers/api/embedjobs/default/active/${identifier}`;
    assertKekaUrl(apiUrl);
    const json = await ctx.fetchJson(apiUrl, { redirect: 'error' });
    return parseKekaResponse(json, entry.name, origin);
  },
};

/**
 * Parse a Keka `/careers/api/embedjobs/default/active/{identifier}` response.
 * Exported for unit tests.
 *
 * Keka returns a top-level array of jobs:
 *   [{ id, title, jobLocations: [{ name?, city?, state?, countryName? }], ... }]
 *
 * - url: built as `<origin>/careers/jobdetails/{id}` — the public job detail
 *   page (confirmed live to resolve HTTP 200). Rows without a numeric id are
 *   dropped (no stable URL, and url is the scanner's dedup key).
 * - location: prefer the ready-made `jobLocations[0].name`; else assemble from
 *   city/state/countryName. Multiple locations are joined with "; ".
 *
 * @param {any} json
 * @param {string} companyName
 * @param {string} origin  e.g. "https://jupiter.keka.com"
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseKekaResponse(json, companyName, origin) {
  const rows = Array.isArray(json) ? json : [];
  return rows
    .filter(j => j && j.title && Number.isFinite(j.id))
    .map(j => {
      const locs = Array.isArray(j.jobLocations) ? j.jobLocations : [];
      const location = locs
        .map(loc => {
          if (typeof loc?.name === 'string' && loc.name.trim()) return loc.name.trim();
          return [loc?.city, loc?.state, loc?.countryName].filter(Boolean).join(', ');
        })
        .filter(Boolean)
        .join('; ');

      return {
        title: String(j.title),
        url: `${origin}/careers/jobdetails/${j.id}`,
        company: companyName,
        location,
      };
    });
}
