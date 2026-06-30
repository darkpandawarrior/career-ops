# app/api

The HTTP route layer (Next.js App Router route handlers). These are thin: every
route resolves the active candidate's data root, then delegates to `lib/` —
reading/writing the user's career-ops checkout, or spawning the real CLI engine.
Routes hold **no business logic of their own**; they orchestrate, they never
reimplement the engine.

## The isolation contract

The dashboard is multi-profile. **Any route that touches a candidate's data MUST
`await requestRoot()`** (from `@/lib/profile-registry`) and pass that root into
the reader/writer — never read a hard-coded path. `requestRoot()` resolves the
`?profile=` slug to a filesystem root, so one origin serves many candidates and a
draft never crosses profiles. When spawning the CLI engine, the same root is
forwarded as the `CAREER_OPS_ROOT` env var so a web run is byte-identical to a CLI one.

The only routes that legitimately skip `requestRoot()` are **system-wide** (not
profile-scoped): `clis`, `logo`, `version`, `usage`, the `profiles*`/`onboarding`
registry routes (they create/select profiles), and the `apply/*` routes that act
on an already-opened in-memory session keyed by `sessionId`.

## Per-profile CLI convention

CLI *detection* (`/api/clis`) is machine-wide, but **which** CLI drives a
candidate's AI work is a per-profile choice persisted at
`<root>/config/cli.yml` via `/api/cli` (GET reads + auto-defaults to the first
installed CLI; POST saves). It is never a single global localStorage key shared
across profiles.

## Routes by kind

| Group | Routes | Role |
|-------|--------|------|
| **Data / read** (`requestRoot()` → `lib` readers) | `pipeline`, `pipeline-toggle`, `portals` (+`verify`), `jobs/*`, `scans`, `patterns`, `cadence`, `followups` (+`log`), `notes`, `memory`, `queue`, `runs/save`, `status`, `doctor`, `cv`(+`ingest`), `cv-pdf`, `coach`, `explore`(+`add`,`ai`) | Serve the user's pipeline/tracker/reports/CV to the client; small persisted writes |
| **Action / spawn** (delegate to the real engine, often streaming NDJSON) | `run`, `ops/run`, `assistant`, `liveness` | Spawn the agnostic CLI headless to evaluate/research/pdf/fix-portal; stream progress |
| **Apply** (headed-Chrome form proxy) | `apply/session`, `apply/fill`, `apply/drive`, `apply/prefill`, `apply/handoff`, `apply/close`, `apply/remember` | Open the real application form, fill behind the scenes, hand off to the human — **never auto-submits** |
| **Portfolio** (delegate to `lib/portfolio`) | `portfolio` (GET/DELETE draft), `generate`, `theme`, `version`, `analyze`, `save-local`, `export` | Generate/refine/version/export the per-profile portfolio site |
| **Profiles / onboarding** (registry, system-wide) | `profiles`, `profiles/create`, `profile`, `onboarding/extract`, `onboarding/infer`, `onboarding/activate` | List/create profiles; extract→infer→activate writes the new profile's files |
| **System / meta** (no profile root) | `clis`, `cli`, `version`, `whats-new`, `usage`, `logo` | CLI detection, app version/channel, token-usage windows, cached logo proxy |

## Conventions

- Most routes set `export const runtime = "nodejs"` (need `child_process`/`fs`)
  and `export const dynamic = "force-dynamic"` (always read fresh local files).
- Spawning routes raise `maxDuration` and surface honest failures — they refuse a
  fake green "done" when the CLI no-op'd, lacked write auth, or never persisted.
- Input is validated and errors are short, user-facing strings; absolute
  filesystem paths are never leaked to the client.
- Tests live next to the handler (`route.test.ts`); most read/system routes are
  covered, the heavier spawn/apply orchestration routes lean on `lib`-level tests.
