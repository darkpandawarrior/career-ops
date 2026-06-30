# lib/core

The anti-corruption layer between the web app and the career-ops **engine** (the
`.mjs` scripts + YAML contracts at `CAREER_OPS_ROOT`). Each file owns one contract
entry-point so the web never re-implements core logic — it spawns the real scripts
or reads the canonical config, with `CAREER_OPS_ROOT` threaded through for profile
isolation.

| File | Responsibility |
|------|----------------|
| `scan.ts` | `runDiscovery()` — spawns `scan-ats-full.mjs --dry-run` (free, zero-token reverse-ATS scan), parses its stdout into streamed `ScanEvent`s; writes nothing |
| `portals.ts` | ACL for `portals.yml`: `serializePortals`/`writeTempPortals` build an EPHEMERAL filter file (injection-safe via `JSON.stringify`); `seedExploreFilters` tolerantly seeds first-search defaults from the real `portals.yml` / `config/profile.yml` |
| `pipeline.ts` | `addOffersToPipeline()` — spawns the core's own `appendToPipeline`/`appendToScanHistory` (from `scan.mjs`) in a short-lived node process so the engine owns the line format |
| `discover.ts` | `assembleDedupContext()` — pure-read of `scan-history.tsv` + inbox + applications into a compact "already known" block + canonical URL set for AI-search dedup |
| `safe-write.ts` | `atomicWrite` / `backup` / `atomicWriteWithBackup` — the one crash-safe, non-clobbering path for every user-layer write (temp file + rename, timestamped `.bak`) |
| `states.ts` | ACL for `templates/states.yml` — reads canonical application states live (cached), `canonicalizeStatus()` maps label/id/alias → label; hardcoded `FALLBACK` only if unreadable |

**Conventions**
- **Profile isolation:** every entry-point takes a `root` arg (default `careerOpsRoot()`, supplied per-request from `requestRoot()`). Spawned scripts get `cwd` = engine root but `CAREER_OPS_ROOT` (and `CAREER_OPS_PORTALS`) = the active profile, so reads/writes never cross candidates.
- **Spawn, don't reimplement:** `scan.ts`/`pipeline.ts` run the engine's `.mjs` so the core stays the single source of truth; only stdout parsing lives here (and `scan.ts`'s `--dry-run` format is the one non-formal contract — a `--json` mode is the planned fix).
- **Tolerant + safe by construction:** YAML/file reads never throw (fall back to defaults/`FALLBACK`); ephemeral filters never touch the user's real `portals.yml`; all writes go through `safe-write`.
- **Data-only checkouts** (no `scan.mjs`) fail with an actionable message instead of a silent `added: 0`.

Tests live next to each file (`*.test.ts`).
