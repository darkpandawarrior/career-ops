# HireSignal — career-ops web

The official **local-first** web experience for career-ops. A Next.js 16 (App
Router, Turbopack) dashboard over the user's own job-search data: pipeline,
A–F scored roles, CV, analytics, and an AI assistant that runs on the user's own
coding CLI. Nothing leaves the machine.

## Quickstart

```bash
cd web
npm install
npm run dev          # http://localhost:3000  (dev)
# or a production build:
npm run build && npm start
```

The app reads the user's data from the career-ops checkout it lives in (the parent
of `web/`). Override with `CAREER_OPS_ROOT=/path/to/checkout` to point at a separate
(gitignored) data checkout. See [`../docs/MULTI_PROFILE.md`](../docs/MULTI_PROFILE.md).

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Dev server (Turbopack). |
| `npm run build` / `npm start` | Production build / serve. |
| `npm run typecheck` | `tsc --noEmit` over the whole project (incl. tests). |
| `npm run test` | Vitest watch mode. |
| `npm run test:run` | Run the full unit suite once. |
| `npm run test:coverage` | Run with v8 coverage (text + html + json-summary in `coverage/`). |

## Architecture notes

- **Multi-profile.** `?profile=<slug>` → `src/proxy.ts` sets the `x-co-profile`
  header → `src/lib/profile-registry.ts requestRoot()` resolves the active
  candidate's data root. Every server page and API route threads that root into the
  synchronous readers in `src/lib/career-ops.ts`. A route that forgets to pass the
  root silently reads the engine root — the bug class the test suite guards against.
- **Per-profile AI CLI.** `GET/POST /api/cli` ↔ `<root>/config/cli.yml` (auto-defaults
  to the first installed CLI). The assistant, AI search, CV parsing, and the
  Evaluate/Apply workers all resolve their engine from here — never a global
  `localStorage` key. See `../docs/MULTI_PROFILE.md`.
- **Local-first AI.** AI actions shell out to the user's installed CLI
  (`src/lib/clis.ts`) with read-only tool scoping and stream stdout
  (`api/assistant`, `api/run`, `api/explore/ai`, `api/cv/ingest`).
- **Dev HMR.** Turbopack's dev HMR WebSocket needs the loopback origin allowlisted
  (`allowedDevOrigins` in `next.config.mjs`); without it, hydration can stall in some
  browsers. Production builds are unaffected.

## Testing

Unit tests live next to the code they cover (`*.test.ts` / `*.test.tsx`), run by
**Vitest 4** (`vitest.config.ts`, alias `@→src`, `vitest.setup.ts` for jest-dom +
a jsdom `localStorage` shim).

- **node env (default)** — lib logic + API route handlers. Routes are tested by
  calling their exported `GET`/`POST(Request)` directly with `next/headers`,
  `@/lib/career-ops`, and `node:child_process` mocked, and `os.tmpdir()` fixtures.
  Tests **never** read the user's real `profiles/` or `data/`.
- **jsdom env** — components opt in with a `// @vitest-environment jsdom` docblock and
  React Testing Library; stub `fetch` with `vi.stubGlobal`.

Coverage is concentrated on the unit-testable **logic layer** (`src/lib/**` and the
read/parse API routes). Presentation components and RSC pages are exercised by the
in-browser verification flow rather than unit tests.

```bash
npm run test:run        # all tests
npm run test:coverage   # + coverage report
```
