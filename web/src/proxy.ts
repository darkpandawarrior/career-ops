import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  checkRequest,
  parseAllowedHosts,
  parseAllowedOrigins,
} from "@/lib/origin-guard.mjs";

// Single choke point over everything the dashboard serves. Every request is
// gated on the same-origin + loopback guard before it can reach a route handler
// (which may spawn a child process or write the user's files) or a page (which
// renders the user's CV, pipeline and reports). See origin-guard.mjs for the
// two-layer rationale (F1 drive-by CSRF, F2 LAN reachability).
//
// Opt in to extra hosts (e.g. a trusted LAN box) with a comma/space separated
// CAREER_OPS_WEB_ALLOWED_HOSTS; unset means loopback only.
//
// Opt in to extra *origins* the same way with CAREER_OPS_ALLOWED_ORIGINS;
// unset means none, which is the default and leaves the guard as strict as it
// was. It is what a local companion client needs: a browser extension calls
// from a chrome-extension:// origin, which Fetch Metadata always reports as
// "cross-site", so every one of its requests is refused otherwise.

/**
 * Multi-profile context propagation.
 *
 * HireSignal selects a candidate profile with `?profile=slug`. We resolve that
 * once, here, and forward it to every downstream page / route handler as the
 * `x-co-profile` request header — so the data layer can resolve the right data
 * root via `requestRoot()` without each call site re-parsing the query string.
 *
 * Stickiness: an explicit `?profile=` is persisted in the `co-profile` cookie,
 * so plain navigations (bare nav links without the query string) keep the same
 * profile. Precedence: explicit query param > cookie. An explicit but empty /
 * invalid `?profile=` clears the cookie → back to the single-profile root.
 *
 * The registry lookup (filesystem) happens in `requestRoot()` on the Node
 * runtime; the proxy only sanitizes the slug grammar (it runs on the edge
 * runtime and must not touch the filesystem). No/invalid slug → header not set
 * → the data layer falls back to the single-profile root, exactly as before.
 *
 * This is Next 16's `proxy` convention (the former `middleware`); the file lives
 * in `src/` because the app dir is under `src/` (a root-level proxy is ignored).
 */

const SLUG_RE = /^[a-z0-9_-]+$/;
export const PROFILE_HEADER = "x-co-profile";
const PROFILE_COOKIE = "co-profile";

export function proxy(req: NextRequest) {
  // Same-origin + loopback guard over the whole /api surface — every /api
  // route may spawn a child process or write the user's files, so an
  // unauthenticated request is a remote-code-execution primitive, reachable
  // two ways: F1 drive-by (any page the user visits can POST to
  // localhost:3000/api/... in the background) and F2 LAN (if the dev server
  // is bound to 0.0.0.0). See origin-guard.mjs for the two-layer rationale.
  // Opt in to extra hosts with CAREER_OPS_WEB_ALLOWED_HOSTS; unset means
  // loopback only.
  {
    const decision = checkRequest({
      secFetchSite: req.headers.get("sec-fetch-site"),
      origin: req.headers.get("origin"),
      host: req.headers.get("host"),
      allowedHosts: parseAllowedHosts(process.env.CAREER_OPS_WEB_ALLOWED_HOSTS),
      allowedOrigins: parseAllowedOrigins(process.env.CAREER_OPS_ALLOWED_ORIGINS),
    });
    if (!decision.ok) {
      return NextResponse.json({ error: decision.reason }, { status: decision.status });
    }
  }

  const hasParam = req.nextUrl.searchParams.has("profile");
  const param = req.nextUrl.searchParams.get("profile");
  const cookie = req.cookies.get(PROFILE_COOKIE)?.value;

  // Explicit query param wins (and may clear); otherwise inherit the cookie.
  const slug = hasParam
    ? param && SLUG_RE.test(param) ? param : null
    : cookie && SLUG_RE.test(cookie) ? cookie : null;

  const headers = new Headers(req.headers);
  headers.delete(PROFILE_HEADER); // never let a client spoof the resolved profile
  if (slug) headers.set(PROFILE_HEADER, slug);

  const res = NextResponse.next({ request: { headers } });
  // Persist (or clear) the sticky cookie only when the param was explicit.
  if (hasParam) {
    if (slug) res.cookies.set(PROFILE_COOKIE, slug, { httpOnly: true, sameSite: "lax", path: "/" });
    else res.cookies.delete(PROFILE_COOKIE);
  }
  return res;
}

// Everything except build assets. Scoping this to /api left every page route
// ungated, which loopback does not cover: a page that re-resolves its own domain
// to 127.0.0.1 (DNS rebinding) fetches /pipeline same-origin from the user's own
// browser, and force-dynamic pages read the tracker off disk on each request.
// The Host header carries the attacker's domain there, so the guard refuses it —
// but only if it runs. Build assets stay out: they are the same for every user,
// carry nothing of theirs, and a caller who cannot read a page has no use for
// the chunk that renders it.
export const config = { matcher: "/((?!_next/static|_next/image|favicon.ico).*)" };
