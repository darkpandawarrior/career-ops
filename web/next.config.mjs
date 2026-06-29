import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to web/ so Turbopack doesn't infer it from a parent
  // lockfile (the career-ops checkout has its own) — silences the multi-lockfile
  // warning and keeps file-tracing scoped to the app.
  turbopack: { root: __dirname },
  // Allow a throwaway build dir (e.g. BUILD_DIST=.next-prod) so a production
  // `next build` can run without clobbering a live `next dev` .next.
  ...(process.env.BUILD_DIST ? { distDir: process.env.BUILD_DIST } : {}),
  // Reach the dev server from other devices (e.g. an iPad over Tailscale) without
  // Next's cross-origin dev warning. Set NEXT_DEV_ORIGINS=ip-or-host,another in
  // .env.local (comma-separated). Unset → no extra origins (clean default).
  ...(process.env.NEXT_DEV_ORIGINS
    ? { allowedDevOrigins: process.env.NEXT_DEV_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean) }
    : {}),
};

export default nextConfig;
