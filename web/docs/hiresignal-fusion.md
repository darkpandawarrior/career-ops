# HireSignal "2.0 Fusion" — migration log

Ported HireSignal's superior features (multi-profile routing, scoring engine,
onboarding) onto the modern career-ops 2.0 Next.js app (`web/`), replacing the
legacy vanilla-Node dashboard (`dashboard-web/`, since deleted — `web/` is now
the only dashboard).

Tracking the plan at
`AgentHarness/plans/hiresignal/2026-06-29-2.0-rc-eval-migration.md`.

## Status

| Phase | Scope | State |
|-------|-------|-------|
| 0 | Multi-profile `?profile=slug` routing + switcher | ✅ Done |
| 1 | Server-side scoring engine (library) | ✅ Done |
| 2 | Resume onboarding (paste → infer → review → activate) | ✅ Done |
| 3 | Scored job board + filters + CSV export | ✅ Done |
| 4 | HireSignal branding | ✅ Done |
| 5 | Data migration CLI + deploy docs | ✅ Done |

All six phases of the fusion are implemented. See the per-phase notes below.

## Phase 0 — Multi-profile routing

A single career-ops checkout can host several candidate data roots, selected per
request with `?profile=slug`. **Fully backwards-compatible**: no `profiles.yml`,
or an absent/invalid/unknown slug, falls back to the existing single-profile
`careerOpsRoot()` — behavior is byte-identical for single-profile installs.

**Mechanism**

- `profiles.yml` at the data root maps `slug → { display_name, root, color }`
  (root relative to `careerOpsRoot()`), mirroring the now-retired legacy
  `dashboard-web/server.mjs` registry.
- `web/middleware.ts` reads `?profile`, sanitizes the slug (`^[a-z0-9_-]+$`), and
  forwards it as the `x-co-profile` request header (stripping any client-supplied
  value first — no spoofing). Registry/filesystem lookups never run on the edge.
- `web/src/lib/profile-registry.ts` — `resolveProfileRoot(slug)`,
  `listProfiles()`, and the request-scoped `requestRoot()` / `requestSlug()` /
  `requestSpawnEnv()` (the last injects `CAREER_OPS_ROOT` for subprocesses).
- `web/src/lib/career-ops.ts` — every reader takes an optional `root`
  (default `careerOpsRoot()`); request entry points pass `await requestRoot()`.
- Wired read paths: home, pipeline, pipeline report, analytics, `/api/pipeline`,
  `/api/memory`, `/api/doctor`. New `/api/profiles` lists profiles for a switcher.

**Deliberately deferred:** the write/spawn paths (`/api/run` evaluate + pdf) stay
single-root. They depend on an engine-vs-data split — scripts live in the engine
root, data in the profile root — and the spawned CLI writes `reports/…` relative
to its cwd. Making that correct per-profile (without writing one candidate's
evaluation into another's data) belongs with Phase 2/5; doing it carelessly in
Phase 0 would risk data corruption.

## Phase 1 — Scoring engine as a library

The 2.0 app delegated scoring to the CLI. This restores **deterministic,
in-process** scoring by importing HireSignal's pure scoring functions directly.

- **Vendored byte-identical** from the (now-retired) `dashboard-web`:
  `scoring/{scorer,compensation,eligibility,experience}.mjs`,
  `search/{config-schema,query-builder,source-registry}.mjs`. Once
  `dashboard-web/` was deleted, these became the sole canonical copies — the
  root CLI scripts (`job-search-cli.mjs`, `onboarding-cli.mjs`) import them
  directly from here. (Copied, not cross-imported, because Next's production
  file tracer scopes to `web/`.)
- **Typed boundary:** adjacent `*.d.mts` declarations + `web/src/lib/jobs/types.ts`
  let `tsc` check the JS boundary while SWC bundles the real `.mjs`.
- **Facade** `web/src/lib/jobs/scoring.ts` — `scoreJobs`, `scoreOne`,
  `searchPlan`, `jobDashboard` (ports `buildDashboardPayload`'s scoring section),
  all profile-aware. Config loaded from the active profile's
  `config/job-search.yml`.
- **Routes** (read-only, profile-aware):
  `POST /api/jobs/score`, `GET /api/jobs/search-plan`, `GET /api/jobs/cache`.

**Verification:** `npm run typecheck` + `npm run build` pass. Against a temp
two-profile root: the default Android config scores an Android role 8/Strong;
`alice`'s iOS config gates the same role (excluded Kotlin). Search-plan emits 108
queries. Output is deterministic. A parity test confirmed `normalizeJob` was
byte-identical to the legacy `dashboard-web` copy for the same inputs (before
that copy was deleted).

## Phase 3 — Scored job board

A new `/board` surface over the Phase 1 engine: `jobDashboard(requestRoot())`
re-scores the active profile's cached feed (`data/job-dashboard.json`) and ranks
roles, so **switching profiles re-ranks the board live**.

- `/board` (server) → `<JobBoard/>` (client): stat strip (scored/excellent/
  queries), search-config error banner, toolbar (text filter, section
  recommended/review/all, min-score), score-sorted cards with level / priority /
  matched-skill chips / gate warnings / posting links.
- Re-score button re-reads `/api/jobs/cache`; `GET /api/jobs/export` streams an
  RFC-4180 CSV of the ranked board.
- A live feed crawl (the search runner + providers) stays in the CLI; the board
  is read/score-only.

## Phase 2 — Resume onboarding

Multi-step flow that runs the REAL inference + profile-generation engine via a
spawn bridge (the `/api/run` pattern — never reimplemented).

- `onboarding-cli.mjs` (engine root): `infer` (structureResume → inferProfile,
  read-only) returns a flattened form prefill; `activate` (generateUserFiles +
  validateGeneratedFiles) writes the canonical user files into the target root,
  archiving any pre-existing file to `data/profile-archives/<ts>/` first.
- `web/src/lib/onboarding/run.ts` spawns the bridge (JSON over stdin/stdout).
  Routes: `POST /api/onboarding/infer` (read-only), `POST /api/onboarding/activate`
  (profile-aware via `requestRoot()`).
- `/onboarding` UI: paste resume → review (pre-filled, engine-validated) →
  activate → success → `/board`. The generated `config/job-search.yml` is exactly
  what the scoring engine reads, so onboarding → board scoring is one closed loop.
- PDF/DOCX upload (the engine supports it via `pdfjs`/`busboy`) is a future
  enhancement; the paste path needs no extra web deps.

## Phase 4 — HireSignal branding

- A "signal-strength" mark (ascending bars on the brand tile) + "HireSignal"
  wordmark across the sidebar, mobile nav, assistant avatar, favicon
  (`app/icon.svg`) and metadata. Burnt-orange brand retained.
- Profile switcher (`web/src/components/profile-switcher.tsx`) in the sidebar —
  lists `/api/profiles`, switches via `?profile=slug`, hidden in single-profile
  mode. Middleware makes the choice sticky via the `co-profile` cookie so plain
  nav links keep the active profile.

## Phase 5 — Migration + deploy

- `migrate-profile.mjs` (engine root): migrate a single-profile install into a
  named profile (`profiles/<slug>/` + `profiles.yml` entry). Copy-by-default
  (non-destructive), idempotent, `--dry-run` / `--move` / `--force`.
- `docs/MULTI_PROFILE.md`: registry format, migration usage, `?profile=` + cookie
  behavior, rollback, and a staging build/deploy section.

## Full legacy migration (Ops, Intel, job search, control)

Beyond Phases 0–5, the remaining legacy dashboard surfaces were ported so the 2.0
app became a superset of `dashboard-web` (since deleted), turned into a single
control center:

- **Ops** (`/ops`) — scan-history table (`scan-history.tsv`), the operations
  console (scan / scan+verify / liveness / pipeline-health, spawning the real
  `.mjs`), and the agent inbox (queue + remove tasks). `/api/scans`, `/api/ops/run`.
- **Intel** (`/intel`) — interview-coach state (`coach.ts` ports `parseCoachState`:
  storybank, outcomes, question bank, company patterns, drills, loops), plus
  rejection-pattern analysis (`analyze-patterns.mjs`) and full follow-up cadence.
  `/api/coach`, `/api/patterns`, `/api/cadence`.
- **Job search** — `job-search-cli.mjs` runs the real `refreshJobSearch` (crawls
  portals + ATS/remote feeds + queries → scored `job-dashboard.json`), streamed via
  `/api/jobs/refresh`; the board's "Run search" button drives it live.
- **⌘K command palette** (`command-palette.tsx`) — navigate, run ops, and copy
  career-ops / interview-coach CLI commands (`commands.ts`). Global control surface.
- **Tracker control** — `tracker-edit.ts` + `/api/notes`, `/api/pipeline-toggle`,
  `/api/queue` (profile-aware, atomic writes).
- **Profile management** — `/api/profiles/create` + inline switcher creator.

**Engine-vs-data split:** web-shipped bridge scripts resolve via `engineScript()`
against the code root (the server's `web/..`), while data resolves via
`CAREER_OPS_ROOT` — so a dev install with a separate data checkout still finds the
web-only bridges.

## Data-contract compliance

The web app remains read-only over user data except the sanctioned writes
(profile edits, the managed memory block in `modes/_profile.md`, and the
onboarding `activate` step which writes a fresh profile, archiving any existing
files first). Private per-candidate data (`profiles/`, `sync/`, `profiles.yml`)
is gitignored and never committed — these were **not** previously ignored, a gap
this work closed.
