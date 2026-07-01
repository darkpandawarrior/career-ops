# Vendored scoring engine

The `.mjs` files under `web/src/lib/scoring/` and `web/src/lib/search/` are
**byte-identical copies** of the legacy HireSignal scoring engine:

| Vendored copy | Source of truth |
|---|---|
| `scoring/scorer.mjs` | `dashboard-web/scoring/scorer.mjs` |
| `scoring/compensation.mjs` | `dashboard-web/scoring/compensation.mjs` |
| `scoring/eligibility.mjs` | `dashboard-web/scoring/eligibility.mjs` |
| `scoring/experience.mjs` | `dashboard-web/scoring/experience.mjs` |
| `search/config-schema.mjs` | `dashboard-web/search/config-schema.mjs` |
| `search/query-builder.mjs` | `dashboard-web/search/query-builder.mjs` |
| `search/source-registry.mjs` | `dashboard-web/search/source-registry.mjs` |

## Why copies, not cross-imports

Next's production file tracer scopes to the `web/` package; importing sibling
`.mjs` from `../../dashboard-web` is not reliably bundled. Copying keeps the
**exact same pure functions** (so scoring stays identical to the CLI/legacy
dashboard) while living inside the bundle. They are pure, dependency-light ES
modules — no Node-only or third-party imports — so they bundle cleanly.

## Rules

- **Do not edit the `.mjs` logic here.** Fix bugs upstream in `dashboard-web/…`
  then re-copy, so the two never drift. Verify with:
  `diff web/src/lib/scoring/scorer.mjs dashboard-web/scoring/scorer.mjs`
- The adjacent `*.d.mts` files are the **only** hand-written additions — typed
  declarations so the TS app type-checks the JS boundary. Types live in
  `web/src/lib/jobs/types.ts`.
- The typed facade `web/src/lib/jobs/scoring.ts` is the app-facing API; route
  handlers import from there, never from the raw `.mjs`.
