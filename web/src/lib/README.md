# lib

The non-UI core of the HireSignal web app — filesystem readers, the vendored
scoring engine, the explorer/apply/report/portfolio backends, and the pure
client-safe helpers shared by server routes and components.

## The profile-isolation contract

A single career-ops checkout can host several candidate **profiles**, each with its
own data root (`cv.md`, `data/`, `reports/` …). Two modules carry the whole contract:

- **`career-ops.ts`** — every reader takes an explicit `root` argument that defaults
  to `careerOpsRoot()`. The functions stay **synchronous**; root resolution happens
  once, upstream, at the request entry point.
- **`profile-registry.ts`** — resolves the active `?profile` slug (forwarded by
  `middleware.ts` as the `x-co-profile` header) against `<root>/profiles.yml`.
  Request entry points call `await requestRoot()` and pass the result into the
  `career-ops.ts` readers; subprocess spawns use `requestSpawnEnv()`.

The rule: **resolve the root once with `requestRoot()`, then thread it through.** No
registry/header read happens deep in the call tree, and an install with no
`profiles.yml` falls back to `careerOpsRoot()` — single-profile behaves unchanged.

The role-adaptive data model (archetypes, role-neutral sections) lives in
[`../../../docs/PORTFOLIO.md`](../../../docs/PORTFOLIO.md).

## Index

| Module / dir | Responsibility |
|--------------|----------------|
| `career-ops.ts` | Root resolution (`careerOpsRoot` / `engineRoot` / `rootScript`) + all profile-scoped readers (inbox, applications, reports, scan history, agent inbox, memory) |
| `profile-registry.ts` | Multi-profile registry: slug grammar, `profiles.yml` parse, `requestRoot()` / `requestSpawnEnv()` |
| `tracker-edit.ts` | Sanctioned, atomic, profile-scoped user-data writes (notes, pipeline checkboxes, agent inbox) |
| `clis.ts` | Agnostic headless-CLI registry (Claude / others) career-ops can delegate to |
| `coach.ts` | Interview-coach state reader (`coaching_state.md`), profile-local then global fallback |
| `explore.ts` / `explore-ai.ts` / `explore-cost.ts` | Client-safe Explorer contract: filter/offer/stream shapes, tolerant `<<offer:>>` stream parser, FREE-vs-$ cost taxonomy |
| `format.ts` | Pure status/score normalization + display colours (no fs) |
| `company.ts` | Pure company name → domain / monogram logo helpers |
| `commands.ts` / `nav-items.ts` / `portals-meta.ts` / `profile-meta.ts` | ⌘K command catalog, primary nav source-of-truth, `portals.yml` / `config/profile.yml` read-only meta |
| `cn.ts` / `fonts.ts` | Tailwind class joiner; `next/font` definitions |
| `scoring/` | Vendored A–G scorer (`.mjs`, byte-identical to `dashboard-web/`; see `VENDORED.md`) — compensation / eligibility / experience |
| `search/` | Vendored config schema, query builder, ATS `SOURCE_REGISTRY` |
| `jobs/` | TS types + scoring glue over the vendored `.mjs` engine |
| `core/` | Server-only Explorer plumbing: ATS scan, portals, pipeline writes, discovery, atomic `safe-write` |
| `report/` | In-app bug reporter: error ring buffer + PII-scrubbing GitHub-issue payload |
| `cv/` | Client-safe, zero-token CV readiness signal (advisory, never blocks) |
| `apply/` | Agentic auto-apply: Playwright session, field extraction, the observe→act drive loop, diagnostics |
| `onboarding/` | Spawns the engine's onboarding bridge (`onboarding-cli.mjs`) and reads back one JSON object |
| `portfolio/` | Portfolio-site generator (schema → render → scaffold → zip) |

## Conventions

- **Readers are synchronous and take `root`.** All profile awareness funnels through
  `requestRoot()` at the entry point — never re-resolved downstream.
- **Pure vs node-only is deliberate.** Files with no `node:` imports (`format`,
  `company`, `explore*`, `cv/quality`) are client-safe and shared both ways; fs-touching
  logic stays in `career-ops.ts` / `core/`.
- **The engine is spawned, never reimplemented.** `core/`, `onboarding/`, and the
  CLI bridges shell out to the canonical `.mjs` scripts; the scorer under `scoring/`
  is a vendored verbatim copy (do not hand-edit — see `scoring/VENDORED.md`).
- **All user-data writes are atomic** (`core/safe-write.ts`) and reject table-breaking
  chars; AI/untrusted output is coerced and escaped before it lands.
- Subdirectories `cv/`, `jobs/`, `core/`, and `portfolio/` carry their own READMEs.
  Tests live next to each file (`*.test.ts`).
