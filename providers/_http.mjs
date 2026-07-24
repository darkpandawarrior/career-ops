// HTTP transport helpers shared across providers.
// Files prefixed with _ are never loaded as providers by scan.mjs.

import './_dns-cache.mjs'; // memoize dns.lookup process-wide (see that file)

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; career-ops/1.3)';

async function fetchWithTimeout(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, method = 'GET', body = null, redirect = 'follow' } = {}, consume) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'user-agent': DEFAULT_USER_AGENT, ...headers },
      body,
      redirect,
      signal: controller.signal,
    });
    if (!res.ok) {
      const responseText = await res.text().catch(() => '');
      // WAF/CDN challenge pages (seen live: Workday 429s) carry no actionable
      // text — HTML markup or a generic interstitial message, not worth
      // parsing or displaying. The status code and its standard reason
      // phrase are what a log line needs; the raw body is still attached as
      // err.body for callers that want to inspect it.
      const err = new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
      err.status = res.status;
      err.body = responseText;
      err.retryAfter = res.headers.get('retry-after');
      throw err;
    }
    // Body consumption must stay inside the timer window: a server that sends
    // headers and then stalls the body otherwise hangs the caller forever
    // (this froze full-directory sweeps silently — 20 workers all stuck on
    // stalled reads with the abort timer already cleared).
    return await consume(res);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, opts = {}) {
  return fetchWithTimeout(url, opts, (res) => res.json());
}

export async function fetchText(url, opts = {}) {
  return fetchWithTimeout(url, opts, (res) => res.text());
}

// Returns the raw Response (after the timeout + non-2xx guard) so providers that
// need response headers — e.g. startup.ch reads Set-Cookie to prime a session —
// can route through ctx instead of re-implementing fetch. Pass redirect:'error'
// like every other provider call so a 3xx can't be followed to a private IP.
// The response body is deliberately left unconsumed (identity consume) — the
// timeout-covers-the-body-read fix above doesn't apply here, since this
// function's whole contract is handing back headers/cookies before any body
// read happens; the timer is already cleared by the time a caller reads it,
// same as before this fix.
export async function fetchResponse(url, opts = {}) {
  return await fetchWithTimeout(url, opts, (res) => res);
}

export function makeHttpCtx() {
  return {
    transport: 'http',
    fetchJson,
    fetchText,
    fetchResponse,
  };
}

/**
 * Convert a date value to epoch milliseconds for freshness comparisons.
 * Handles ISO 8601 strings, RFC 2822 (RSS pubDate), Unix seconds, and epoch ms.
 * Returns null for missing or unparseable values.
 */
export function toEpochMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    // Heuristic: values < 1e12 are Unix seconds, >= 1e12 are already ms
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  const ms = Date.parse(value);
  return isNaN(ms) ? null : ms;
}
