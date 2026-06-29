import { NextResponse, type NextRequest } from "next/server";

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
 * runtime; middleware only sanitizes the slug grammar (it runs on the edge
 * runtime and must not touch the filesystem). No/invalid slug → header not set
 * → the data layer falls back to the single-profile root, exactly as before.
 */

const SLUG_RE = /^[a-z0-9_-]+$/;
export const PROFILE_HEADER = "x-co-profile";
const PROFILE_COOKIE = "co-profile";

export function middleware(req: NextRequest) {
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

export const config = {
  // Run on app routes + API, skip Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
