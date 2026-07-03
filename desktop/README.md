# Career Ops Desktop

This folder is the first desktop-app scaffold.

What it does:
- Launches the existing Next.js dashboard in a desktop window
- Keeps user data in the app's writable `userData/career-ops-data` folder by default
- Still uses the user's locally installed AI CLI from `PATH`

What it is not yet:
- A finished signed Windows `.exe` / macOS `.dmg`
- A fully packaged offline bundle

Next step to ship binaries:
1. Install desktop dependencies
2. Build the web app
3. Package this Electron shell with `electron-builder`

## Why `packagedRoot()` nests an extra `web/`

`web/src/lib/fonts.ts` loads shared self-hosted fonts from the monorepo's
root-level `fonts/` directory (`../../../fonts/*.woff2`), so Next's standalone
tracer correctly picks the monorepo root — not `web/` — as the workspace root.
The traced output nests the actual app one level deeper:
`.next/standalone/web/server.js`, with `.next/standalone/node_modules`
(hoisted deps) as a sibling. `extraResources` in `package.json` copies the
whole tree, and `main.mjs`'s `packagedRoot()` points at that nested `web/`
subfolder — don't flatten either without keeping them in sync.
