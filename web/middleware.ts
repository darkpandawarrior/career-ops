import { NextResponse, type NextRequest } from "next/server";

/**
 * Multi-profile context propagation.
 *
 * HireSignal selects a candidate profile with `?profile=slug`. We resolve that
 * once, here, and forward it to every downstream page / route handler as the
 * `x-co-profile` request header — so the data layer can resolve the right data
 * root via `requestRoot()` without each call site re-parsing the query string.
 *
 * The registry lookup (filesystem) happens in `requestRoot()` on the Node
 * runtime; middleware only sanitizes the slug grammar (it runs on the edge
 * runtime and must not touch the filesystem). An absent or malformed slug is
 * simply not forwarded → the data layer falls back to the single-profile root,
 * preserving the existing single-profile behavior exactly.
 */

const SLUG_RE = /^[a-z0-9_-]+$/;
export const PROFILE_HEADER = "x-co-profile";

export function middleware(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("profile");
  const headers = new Headers(req.headers);
  // Never let a client spoof the resolved-profile header.
  headers.delete(PROFILE_HEADER);
  if (slug && SLUG_RE.test(slug)) headers.set(PROFILE_HEADER, slug);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Run on app routes + API, skip Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
