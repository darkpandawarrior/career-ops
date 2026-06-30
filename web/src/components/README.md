# components

The HireSignal client-component layer (React Server-on-the-edge + `"use client"`).
`app-shell.tsx` is the root frame: it wraps every page in four context providers,
mounts the global chrome (sidebar nav, command palette, assistant console), and
runs all long jobs through the active profile's CLI resolved over `/api/cli`.

## Top-level files

| File | Responsibility |
|------|----------------|
| `app-shell.tsx` | Root layout shell: nests `JobsProvider` → `PipelineProvider` → `ApplyProvider` → `ExploreProvider`, renders sidebar + nav, command palette, assistant console, mobile nav, beta banner |
| `assistant-console.tsx` | The chat assistant: parses `<<act:ID {json}>>` envelopes, dispatches via `app/actions/registry`, renders inline worker cards; consumes all four providers |
| `config-form.tsx` | CLI / API-key / manual setup form; lists installed CLIs, selects the per-profile CLI (writes `config/cli.yml` via `/api/cli`) |
| `command-palette.tsx` | ⌘K palette (opens on the `co:command-palette` event) for search + quick actions |
| `profile-switcher.tsx` | Active-profile picker driving the per-profile data root |
| `mobile-nav.tsx` / `brand.tsx` / `co-mark.tsx` / `theme-toggle.tsx` / `hero-glow.tsx` | Chrome: mobile drawer nav, brand lockup, logo mark, dark-mode toggle, decorative glow |
| `pipeline-view.tsx` / `status-select.tsx` | Pipeline table + per-row status writeback control |
| `portals-view.tsx` / `report-view.tsx` / `score-methodology.tsx` / `quick-evaluate.tsx` | Job-portal links, run report, score-methodology explainer, one-shot evaluate widget |
| `apply-button.tsx` / `generate-pdf-button.tsx` / `cv-editor.tsx` | Action buttons that kick off CLI jobs; inline CV editor |
| `company-logo.tsx` / `copyable-command.tsx` / `usage-meter.tsx` / `onboarding-banner.tsx` | Logo resolver, copy-to-clipboard command chip, token-usage meter, first-run banner |

## Component areas (subdirectories)

| Dir | What lives here |
|-----|-----------------|
| `home/` | Today dashboard surfaces — KPI hero, needs-action, decision/follow-up cards, board + interview snapshots, first-run home |
| `explore/` | Job discovery: `ExploreProvider` (scan + AI-hunt over `/api/explore*`), search box, filter builder, results list, AI-hunt trace, first-score view |
| `jobs/` | `JobsProvider` (`job-store.tsx`) — the global running-job store streamed from `/api/run`; worker cards + pills |
| `pipeline/` | `PipelineProvider` — client mirror of inbox/applications hydrated from `/api/pipeline`, refetched on focus/demand |
| `apply/` | `ApplyProvider` — drives the assisted-apply session (`/api/apply/*`) plus the apply backdrop overlay; full UI in `apply-view.tsx` |
| `portfolio/` | Portfolio generator UI: `portfolio-view.tsx` + sandboxed `preview-frame.tsx` (renders `lib/portfolio` output) |
| `onboarding/` | `onboarding-flow.tsx` — multi-step intake/review form mirroring `onboarding-cli.mjs` |
| `ui/` | Primitives: `button`, `card`, `badge`, `stat-card` |
| `board/`, `intel/`, `ops/`, `cost/`, `cv/`, `beta/` | Job board, company intel, ops view, cost badge, CV ingest, beta banner |

## Conventions

- **Provider order is load-bearing.** `app-shell` nests the four stores so sibling subtrees (a page and the assistant console) share one source of truth; each `use*` hook throws if used outside its provider.
- **AI dispatch is profile-scoped.** Every worker/AI path (`JobsProvider`, `ExploreProvider.discoverAI`, `ApplyProvider`, assistant console) fetches `/api/cli` for the active profile's CLI (`config/cli.yml`, auto-defaulting to the first installed CLI) — never a global `localStorage` key — then streams NDJSON from `/api/run`, `/api/explore/ai`, `/api/apply/*`, or `/api/assistant`.
- **Job streams are NDJSON.** `tool` / `status` / `text` / `done` / `error` events are read line-by-line and patched into state; the verdict line is latched separately so the truncated tail can't drop it.
- **Persistence is client-local.** Job history, chat, and config live under `career-ops:*` `localStorage` keys; running jobs left over from a prior session are marked interrupted on restore.
- Tests sit next to their component (`*.test.tsx`): `app-shell`'s providers, `job-store`, `apply-view`, `assistant-console`, `config-form`, `onboarding-banner`, and the `explore`, `portfolio`, `cv` areas are covered.
