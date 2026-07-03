// Dev-server cross-origin allow-list. Next 16's dev server only trusts `localhost`
// and `*.localhost` (plus the bind host) by default; the loopback IP `127.0.0.1` is
// treated as a *different* origin. Loading the app at http://127.0.0.1:PORT therefore
// makes the HMR WebSocket upgrade fail Next's cross-origin guard (blockCrossSiteDEV),
// which writes a raw "Unauthorized" to the socket → the browser sees
// ERR_INVALID_HTTP_RESPONSE and, in the App Router dev runtime, that aborts client
// hydration entirely (SSR HTML only, zero /api fetches). This is NOT a proxy/matcher
// issue — the HMR upgrade is handled in the server's `upgrade` event and never reaches
// `src/proxy.ts`. The matcher exclusion of `_next/` has no bearing on it.
//
// So we always trust the loopback IP in dev, and merge any extra hosts from
// NEXT_DEV_ORIGINS (comma-separated) for reaching the dev server from other devices
// (e.g. an iPad over Tailscale). `allowedDevOrigins` is dev-only — `next build`/`start`
// ignore it, so this never affects the production build.
const devOrigins = [
  "127.0.0.1",
  ...(process.env.NEXT_DEV_ORIGINS
    ? process.env.NEXT_DEV_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow a throwaway build dir (e.g. BUILD_DIST=.next-prod) so a production
  // `next build` can run without clobbering a live `next dev` .next.
  ...(process.env.BUILD_DIST ? { distDir: process.env.BUILD_DIST } : {}),
  output: "standalone",
  allowedDevOrigins: devOrigins,
};

export default nextConfig;



