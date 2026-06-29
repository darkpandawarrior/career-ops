# HireSignal "2.0 Fusion" — migration log

Porting HireSignal's superior features (multi-profile routing, scoring engine,
onboarding) onto the modern career-ops 2.0 Next.js app (`web/`), replacing the
legacy vanilla-Node dashboard (`dashboard-web/`).

Tracking the plan at
`AgentHarness/plans/hiresignal/2026-06-29-2.0-rc-eval-migration.md`.

## Status

| Phase | Scope | State |
|-------|-------|-------|
| 0 | Multi-profile `?profile=slug` routing | ✅ Done |
| 1 | Server-side scoring engine (library) | ✅ Done |
| 2 | Resume onboarding (streaming, multi-step) | ⏳ Next |
| 3 | Dashboard/search views + refresh | ⏳ |
| 4 | HireSignal branding | ⏳ |
| 5 | Deploy / data migration | ⏳ |

## Phase 0 — Multi-profile routing

A single career-ops checkout can host several candidate data roots, selected per
request with `?profile=slug`. **Fully backwards-compatible**: no `profiles.yml`,
or an absent/invalid/unknown slug, falls back to the existing single-profile
`careerOpsRoot()` — behavior is byte-identical for single-profile installs.

**Mechanism**

- `profiles.yml` at the data root maps `slug → { display_name, root, color }`
  (root relative to `careerOpsRoot()`), mirroring the legacy
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

- **Vendored byte-identical** from `dashboard-web` (see
  `web/src/lib/scoring/VENDORED.md`): `scoring/{scorer,compensation,eligibility,
  experience}.mjs`, `search/{config-schema,query-builder,source-registry}.mjs`.
  Kept verbatim so scoring never drifts from the CLI/legacy dashboard. (Copied,
  not cross-imported, because Next's production file tracer scopes to `web/`.)
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
queries. Output is deterministic. A parity test confirms the vendored
`normalizeJob` is byte-identical to the legacy one for the same inputs.

## Data-contract compliance

The web app remains read-only over user data except the two sanctioned writes
(profile edits + the managed memory block in `modes/_profile.md`). Private
per-candidate data (`profiles/`, `sync/`, `profiles.yml`) is gitignored and never
committed — these were **not** previously ignored, a gap this work closed.
