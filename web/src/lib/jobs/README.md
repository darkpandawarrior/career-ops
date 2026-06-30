# lib/jobs

The job-feed library boundary over the **vendored, pure-function scorer**
(`lib/{scoring,search}/*.mjs`, byte-identical copies of the CLI's). Restores
deterministic, server-side job scoring driven by the active profile's
`config/job-search.yml`, with `jobDashboard()` as the dashboard read path.

| File | Responsibility |
|------|----------------|
| `scoring.ts` | TS wrappers over the `.mjs` scorer: `loadRawJobSearchConfig` / `validateConfig` (read + validate `config/job-search.yml`), `scoreJobs` / `scoreOne` (score raw jobs), `searchPlan` (generated query plan), and `jobDashboard` (read `data/job-dashboard.json`, re-score unless cached `scored`, compute stats + diagnostics) |
| `types.ts` | Public-surface types for the untyped `.mjs`: `RawJob`, `ScoredJob`, `JobSearchConfig`, `ConfigValidation`, `SearchPlan` |
| `scoring.test.ts` | Full coverage of `scoring.ts` against real tmpdir fixtures (every export, every branch) |

**Conventions**
- **Profile-aware:** every export takes an explicit `root`, defaulting to `careerOpsRoot()` (single-profile back-compat). Callers pass `await requestRoot()` to score against a specific `?profile`.
- **Pure reads:** `jobDashboard` and friends never write — they only read `config/job-search.yml` and `data/job-dashboard.json` under the given root.
- **Config gates scoring:** when validation fails, `scoreJobs` / `jobDashboard` return no jobs plus the errors (so the UI can say "fix your config"); `scoreOne` is the only export that skips the validity gate.
- **Cache trust:** a cache marked `scored: true` is passed through verbatim; otherwise every job is re-scored via `normalizeJob` against the current config.
- **Stats:** `searchLead` entries count as `sources` and are excluded from `total` / `excellent` (`score >= 8`); `Number(score)` coercion means a missing score is never "excellent".
- **Tolerant I/O:** missing / malformed YAML or JSON degrades to `{}` / empty rather than throwing.
- The `.mjs` scorer is intentionally unmodified — see `scoring/VENDORED.md`. These types describe it; they don't touch it.
