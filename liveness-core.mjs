const HARD_EXPIRED_PATTERNS = [
  /job (is )?no longer available/i,
  /job.*no longer open/i,
  /position has been filled/i,
  /this job has expired/i,
  /job posting has expired/i,
  /no longer accepting applications/i,
  /this (position|role|job) (is )?no longer/i,
  /this job (listing )?is closed/i,
  /job (listing )?not found/i,
  /the page you are looking for doesn.t exist/i,
  /applications?\s+(?:(?:have|are|is)\s+)?closed/i,
  /closed on \d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  /closed on (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}/i,
  /diese stelle (ist )?(nicht mehr|bereits) besetzt/i,
  /offre (expirée|n'est plus disponible)/i,
];

const LISTING_PAGE_PATTERNS = [
  /\d+\s+jobs?\s+found/i,
  /search for jobs page is loaded/i,
];

// Anti-bot interstitials (Cloudflare "Just a moment...", hCaptcha walls, etc.)
// render a tiny challenge page instead of the posting. Headless Playwright trips
// these on portals like pracuj.pl. They must NOT be read as expired: the body is
// short and lacks an apply control, so without this guard they fall through to
// `insufficient_content` → expired, and scan --verify would write live jobs to
// scan-history and permanently filter them out. Treat as uncertain instead.
const BOT_CHALLENGE_PATTERNS = [
  /just a moment/i,
  /performing security verification/i,
  /checking your browser before/i,
  /verify you are (a |not a )?human/i,
  /enable javascript and cookies to continue/i,
  /attention required.*cloudflare/i,
  /\bray id\b/i,
  /\bcf-ray\b/i,
  /please complete the security check/i,
];

const EXPIRED_URL_PATTERNS = [
  /[?&]error=true/i,
];

const APPLY_PATTERNS = [
  /\bapply\b/i,
  /\bsolicitar\b/i,
  /\bbewerben\b/i,
  /\bpostuler\b/i,
  /submit application/i,
  /easy apply/i,
  /start application/i,
  /ich bewerbe mich/i,
  // Polish (pracuj.pl, justjoin.it, bulldogjob.pl): "Aplikuj" / "Aplikuj teraz" /
  // "Wyślij CV" / "Przejdź do panelu aplikowania". Without these, a fully-loaded
  // Polish posting has no recognized apply control and falls to no_apply_control.
  /\baplikuj\b/i,
  /panelu aplikowania/i,
  /wyślij (cv|aplikacj)/i,
];

const MIN_CONTENT_CHARS = 300;

// ── Bot-block classification policy (docs/liveness-bot-block-policy.md) ──────
//
// Four-bucket taxonomy layered over the legacy result/code wire format:
//   live         — positive proof of an open posting
//   dead         — positive proof of closure (404/410, expiry banner, listing bounce)
//   blocked      — positive proof we were prevented from reading the page (a wall);
//                  says NOTHING about liveness. Never downgrade to dead on a block alone.
//   unverifiable — loaded but no definitive signal (no apply control, thin body, nav error)
//
// `bucket` is additive: classifyLiveness still returns the same result/code, so
// every existing caller/test keeps working. The bucket is the policy-level view.

// Codes that mean "a wall stopped us", not "the posting is gone".
const BLOCKED_CODES = new Set(['bot_challenge', 'access_blocked']);
const DEAD_CODES = new Set([
  'http_gone', 'expired_url', 'expired_body', 'listing_page', 'insufficient_content',
]);

// Map a (result, code) pair to the four-bucket taxonomy.
export function bucketFor(result, code = '') {
  if (result === 'active') return 'live';
  if (result === 'expired') return 'dead';
  // result === 'uncertain' from here
  if (BLOCKED_CODES.has(code) || code.startsWith('domain_block:')) return 'blocked';
  return 'unverifiable'; // no_apply_control, insufficient_content (block-prone), navigation_error, guards
}

// Per-domain handling map. `blockedSignature` fires BEFORE the generic content
// heuristics so a login-walled HTTP-200 thin shell (instahyre/cutshort/linkedin)
// is caught as `blocked`, never leaked to insufficient_content → dead.
// `treatBlockedAs` is always 'blocked' — the map recognises the wall; liveness
// behind it is resolved by escalation or decay, not guessed here.
export const DOMAIN_LIVENESS = {
  'linkedin.com': {
    checkMethod: 'authed-session',
    blockedSignature: { status: [999], finalUrl: [/\/(login|authwall)/i], body: [/sign in to view/i, /join linkedin to/i] },
    treatBlockedAs: 'blocked',
  },
  'naukri.com': {
    checkMethod: 'apify',
    blockedSignature: { status: [403], finalUrl: [], body: [/verify you are a human/i, /access denied/i] },
    treatBlockedAs: 'blocked',
  },
  'foundit.in': {
    checkMethod: 'headed',
    blockedSignature: { status: [403], finalUrl: [], body: [/access denied/i] },
    treatBlockedAs: 'blocked',
  },
  'instahyre.com': {
    checkMethod: 'headless',
    blockedSignature: { status: [], finalUrl: [/\/login/i], body: [/log ?in to apply/i, /sign in to continue/i] },
    treatBlockedAs: 'blocked',
  },
  'cutshort.io': {
    checkMethod: 'authed-session',
    blockedSignature: { status: [], finalUrl: [/\/login/i, /\/signin/i], body: [/log ?in to/i] },
    treatBlockedAs: 'blocked',
  },
};

function domainEntryFor(rawUrl) {
  let host;
  try {
    host = new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
  for (const [domain, entry] of Object.entries(DOMAIN_LIVENESS)) {
    if (host === domain || host.endsWith(`.${domain}`)) return { domain, entry };
  }
  return null;
}

// True if the signals match the domain's block signature (any axis matches).
function matchesBlockSignature(sig, { status, finalUrl, bodyText }) {
  if (sig.status?.includes(status)) return true;
  if (sig.finalUrl?.some((re) => re.test(finalUrl))) return true;
  if (sig.body?.some((re) => re.test(bodyText))) return true;
  return false;
}

// Soft-expiry decay (docs §3.4). PURE — no I/O, no deletion. Returns the new
// scan-history status for a provisional row that has aged past N=21 days with no
// corroboration, or null to leave it unchanged. A genuine expiry banner is
// authoritative and bypasses decay entirely (that row is already `dead`).
export const DECAY_AFTER_DAYS = 21;
export function decayBucketFor(firstSeen, today, { bucket, corroborated = false, decayAfterDays = DECAY_AFTER_DAYS } = {}) {
  if (bucket !== 'blocked' && bucket !== 'unverifiable') return null;
  if (corroborated) return null;
  const start = Date.parse(`${firstSeen}T00:00:00Z`);
  const end = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const ageDays = Math.floor((end - start) / 86_400_000);
  return ageDays >= decayAfterDays ? 'skipped_probable_expired' : null;
}

function firstMatch(patterns, text = '') {
  return patterns.find((pattern) => pattern.test(text));
}

function hasApplyControl(controls = []) {
  return controls.some((control) => APPLY_PATTERNS.some((pattern) => pattern.test(control)));
}

// Attach the additive policy `bucket` to a legacy {result, code, reason}.
function withBucket(r) {
  return { ...r, bucket: bucketFor(r.result, r.code) };
}

// URL-aware classifier (decision-tree step 2): runs the per-domain block
// signature BEFORE the generic content heuristics, so a login-walled HTTP-200
// thin shell is `blocked`, not a false `dead`. An authoritative expiry banner
// still wins (a closed posting on a block-prone domain is genuinely dead).
// Callers that don't have/pass a URL get the unchanged generic path.
export function classifyLivenessForUrl({ url = '', status = 0, finalUrl = '', bodyText = '', applyControls = [] } = {}) {
  if (status !== 404 && status !== 410) {
    const expiredBody = firstMatch(HARD_EXPIRED_PATTERNS, bodyText);
    if (!expiredBody) {
      const hit = domainEntryFor(url);
      if (hit && matchesBlockSignature(hit.entry.blockedSignature, { status, finalUrl, bodyText })) {
        return withBucket({
          result: 'uncertain',
          code: `domain_block:${hit.domain}`,
          reason: `${hit.domain} block signature matched (treated as blocked, not expired)`,
        });
      }
    }
  }
  return classifyLiveness({ status, finalUrl, bodyText, applyControls });
}

export function classifyLiveness({ status = 0, finalUrl = '', bodyText = '', applyControls = [] } = {}) {
  return withBucket(classifyLivenessInner({ status, finalUrl, bodyText, applyControls }));
}

function classifyLivenessInner({ status = 0, finalUrl = '', bodyText = '', applyControls = [] } = {}) {
  if (status === 404 || status === 410) {
    return { result: 'expired', code: 'http_gone', reason: `HTTP ${status}` };
  }

  // Bot/anti-scraping walls — never expired. Check before the content-length and
  // listing-page heuristics, which would otherwise misread the short challenge
  // body as a dead posting. 403/503 are access-blocked signals, not "gone"
  // (a genuinely removed posting returns 404/410 or a hard-expired banner).
  const botChallenge = firstMatch(BOT_CHALLENGE_PATTERNS, bodyText);
  if (botChallenge) {
    return { result: 'uncertain', code: 'bot_challenge', reason: `anti-bot challenge: ${botChallenge.source}` };
  }
  if (status === 403 || status === 503) {
    return { result: 'uncertain', code: 'access_blocked', reason: `HTTP ${status} (access blocked, likely anti-bot)` };
  }

  const expiredUrl = firstMatch(EXPIRED_URL_PATTERNS, finalUrl);
  if (expiredUrl) {
    return { result: 'expired', code: 'expired_url', reason: `redirect to ${finalUrl}` };
  }

  const expiredBody = firstMatch(HARD_EXPIRED_PATTERNS, bodyText);
  if (expiredBody) {
    return { result: 'expired', code: 'expired_body', reason: `pattern matched: ${expiredBody.source}` };
  }

  if (hasApplyControl(applyControls)) {
    return { result: 'active', code: 'apply_control_visible', reason: 'visible apply control detected' };
  }

  const listingPage = firstMatch(LISTING_PAGE_PATTERNS, bodyText);
  if (listingPage) {
    return { result: 'expired', code: 'listing_page', reason: `pattern matched: ${listingPage.source}` };
  }

  if (bodyText.trim().length < MIN_CONTENT_CHARS) {
    return { result: 'expired', code: 'insufficient_content', reason: 'insufficient content — likely nav/footer only' };
  }

  return { result: 'uncertain', code: 'no_apply_control', reason: 'content present but no visible apply control found' };
}
