# Data Contract

This document defines which files belong to the **system** (auto-updatable) and which belong to the **user** (never touched by updates).

## User Layer (NEVER auto-updated)

These files contain your personal data, customizations, and work product. Updates will NEVER modify them.

| File | Purpose |
|------|---------|
| `cv.md` | Your CV in markdown |
| `config/profile.yml` | Your identity, targets, comp range |
| `config/cv-facts.json` | Your CV fact-check allowlist and forbidden phrases (optional; seeded from `config/cv-facts.example.json`) |
| `modes/_profile.md` | Your archetypes, narrative, negotiation scripts |
| `modes/_custom.md` | Your house rules, custom workflows & output preferences (procedural — survives updates) |
| `modes/_brief.md` | Your triage brief. `modes/_brief.template.md` is TRACKED; `doctor.mjs` copies it to this working copy on first run, and the working copy is gitignored (same convention as `modes/_profile.md`). |
| `voice-dna.md` | Your writing-voice profile. Fork-only split: `voice-dna.template.md` is TRACKED, this working copy is gitignored, and `doctor.mjs` copies template -> working copy on first run (same convention as `modes/_profile.md`). Upstream tracks `voice-dna.md` directly; personalizing a tracked file would publish your voice via the public sibling fork. |
| `article-digest.md` | Your proof points from portfolio |
| `interview-prep/story-bank.md` | Your accumulated STAR+R stories |
| `interview-prep/{company}-{role}.md` | Company-specific interview prep reports (written by `/career-ops interview-prep`) |
| `portals.yml` | Your customized company list |
| `config/plugins.yml` | Your plugin activation toggles (opt-in; seeded from `config/plugins.example.yml`) |
| `plugins.local/` | Your own / private plugins (never auto-updated) |
| `plugins.lock` | Integrity pins + recorded consent for your enabled plugins (generated; never auto-updated) |
| `data/applications.md` | Your application tracker (source of truth) |
| `data/applications.db` | Derived query index over `applications.md` (SQLite, rebuilt by `node tracker.mjs sync` — safe to delete) |
| `data/pipeline.md` | Your URL inbox |
| `data/scan-history.tsv` | Your scan history (tab-separated, append-only trailing columns; header `url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation`, then col 8: local SimHash JD fingerprint for cross-listing detection, col 9: posting date, cols 10-11: trust score/flags). Older rows may have fewer columns — readers index by position and tolerate the absence. |
| `data/scan-runs.tsv` | Your per-run scan counters (companies/boards scanned, found/filtered/dupe/new-added tallies; appended by `scan.mjs`, read by `stats.mjs`) |
| `data/portal-health.tsv` | Consecutive reachability status per scanned portal (`timestamp\tcompany\tstatus`; appended by `scan.mjs`, read by `stats.mjs` to flag portals persistently down. Statuses: `reachable`, `empty`, `slug_gone`, `network` — a `slug_gone`/`network` row extends the failure streak, a `reachable`/`empty` row resets it) |
| `data/dead-boards.tsv` | Dead-board memory for the reverse-ATS sweep (`ats\tslug\tmisses\tlast_checked`; written and read by `scan-ats-full.mjs`). Records only boards that returned 404, retiring one after three consecutive misses so repeat sweeps skip it instead of re-probing; re-probed every 30 days. Unlike `data/portal-health.tsv`, it does not track your configured portals. No personal data — public ATS slugs only. Regenerable: deleting it costs a few slower sweeps, nothing more. |
| `data/follow-ups.md` | Your follow-up history |
| `data/status-log.tsv` | Your status-transition ledger (`report#\tdate\tfrom\tto\tset-status\t`; appended by `set-status.mjs`, read by `funnel-velocity.mjs` and `company-history.mjs`) |
| `data/apply-queue.md` | Your ranked apply queue (generated from your pipeline + profile) |
| `data/salary-observations.tsv` | Your append-only compensation observation log (desired/advertised/actual pay per application; read by `salary-gap.mjs`) |
| `data/blacklist.md` | Your do-not-apply list (companies to skip; read by `scan.mjs`, opt-in via `--include-blacklisted`) |
| `data/h1b/` | Local H-1B/PERM sponsorship index installed by the `h1b-sponsor` plugin's `install-h1b-index.mjs` (public DOL disclosure data, ~8 MiB gzipped, plus its `.meta.json` sidecar). Not personal — a public dataset snapshot — but a downloaded binary artifact, never committed; already covered by the blanket `data/*` gitignore rule. Re-download with `--force` to refresh a quarter. |
| `data/cache/h1b/` | Your `h1b-sponsor` plugin lookup cache (one JSON file per company checked, keyed by name). Reveals which employers you are evaluating for sponsorship — treat as sensitive job-search-target data, same class as `data/pipeline.md`. Safe to delete (rebuilt on next lookup); already covered by the blanket `data/*` gitignore rule. |
| `documents/` | Source documents you drop in for the intake flow (master CV, LinkedIn export, diplomas, references). Gitignored and backed up via the career-ops-active registry entry. Declared before the upstream `intake` feature is ported, so a later sync cannot land the directory unprotected. |
| `data/hq/` | Your personal HQ page (`hq.html`, served at `/hq` by the dashboard) and its progress state (`state.json`, read/written by `/api/hq-state`) |
| `profiles.json` | Root profile registry — candidate name / email / owner handle per profile. Same class as `profiles.yml` |
| `profiles.yml.bak-*` | Timestamped backups written by `migrate-profile.mjs`; carry the same per-candidate private config as `profiles.yml` |
| `index.db` | Root SQLite index used by the web dashboard. **Most sensitive file in this table** — alongside `applications` / `status_events` / `pipeline_inbox` / `scan_history` it holds `auth_users` and `auth_sessions` (dashboard credentials and live session tokens). Derived and regenerable; safe to delete. Never commit — this repo pushes PRs to a public upstream |
| `writing-samples/*` | Your personal writing samples for style calibration (except `writing-samples/README.md`, which is system-owned documentation delivered by updates) |
| `reports/*` | Your evaluation reports |
| `output/*` | Your generated PDFs |
| `jds/*` | Your saved job descriptions |

## System Layer (safe to auto-update)

These files contain system logic, scripts, templates, and instructions that improve with each release.

| File | Purpose |
|------|---------|
| `modes/_shared.md` | Scoring system, global rules, tools |
| `modes/_custom.template.md` | Template seed for the user's `modes/_custom.md` |
| `modes/oferta.md` | Evaluation mode instructions |
| `modes/pdf.md` | PDF generation instructions |
| `modes/text.md` | Tailored markdown CV instructions |
| `modes/scan.md` | Portal scanner instructions |
| `modes/batch.md` | Batch processing instructions |
| `modes/apply.md` | Application assistant instructions |
| `modes/auto-pipeline.md` | Auto-pipeline instructions |
| `modes/contacto.md` | LinkedIn outreach instructions |
| `modes/deep.md` | Research prompt instructions |
| `modes/regional/*` | Regional market calibration modes |
| `modes/ofertas.md` | Comparison instructions |
| `modes/pipeline.md` | Pipeline processing instructions |
| `modes/project.md` | Project evaluation instructions |
| `modes/tracker.md` | Tracker instructions |
| `modes/training.md` | Training evaluation instructions |
| `modes/patterns.md` | Pattern analysis instructions |
| `modes/followup.md` | Follow-up cadence instructions |
| `modes/interview/*` | Interview prep planning, practice, and debrief skills |
| `modes/de/*` | German language modes |
| `modes/es/*` | Spanish language modes |
| `modes/fr/*` | French language modes |
| `modes/it/*` | Italian language modes |
| `modes/ja/*` | Japanese language modes |
| `modes/pl/*` | Polish language modes |
| `modes/pt/*` | Portuguese language modes |
| `modes/ru/*` | Russian language modes |
| `modes/heuristics/*` | Shared candidate-facing application heuristics |
| `CLAUDE.md` | Agent instructions (Claude Code) |
| `OPENCODE.md` | Agent instructions (OpenCode) |
| `GEMINI.md` | Legacy no-op context guard (prevents Antigravity duplicate imports) |
| `AGENTS.md` | Canonical agent instructions (imported by CLI-specific wrappers) |
| `*.mjs` | Utility scripts |
| `plugins/` | Bundled plugins + the plugin engine (opt-in external integrations) |
| `plugins.mjs` | Plugin CLI (list/run/available/add/new/enable/skill/trust/remove) |
| `plugins-registry.json` | Curated list of approved community plugins (the trust root) |
| `plugin-install.mjs` / `plugin-audit.mjs` / `validate-plugin-registry.mjs` | Plugin install/audit/registry-validation utilities |
| `config/plugins.example.yml` | Plugin activation template (seed for `config/plugins.yml`) |
| `config/cv-facts.example.json` | CV fact-check template (seed for `config/cv-facts.json`) |
| `batch/batch-prompt.md` | Batch worker prompt |
| `batch/batch-runner.sh` | Batch orchestrator |
| `dashboard/*` | Go TUI dashboard |
| `templates/*` | Base templates |
| `fonts/*` | Self-hosted fonts |
| `.claude/skills/*` | Skill definitions (Claude Code) |
| `.opencode/skills/*` | Skill definitions (OpenCode) |
| `.qwen/skills/*` | Skill definitions (Qwen Code) |
| `.antigravitycli/skills/*` | Skill definitions (Antigravity CLI) |
| `.grok/skills/*` | Skill definitions (Grok Build CLI) |
| `docs/*` | Documentation |
| `VERSION` | Current version number |
| `DATA_CONTRACT.md` | This file |
| `writing-samples/README.md` | System-owned onboarding documentation for the writing-samples directory |

## The Rule

**If a file is in the User Layer, no update process may read, modify, or delete it.**

**If a file is in the System Layer, it can be safely replaced with the latest version from the upstream repo.**

## Custom Data Directory

By default, all User Layer files reside inside the engine checkout root. You can configure a separate, external directory for your personal data — this is also what the fork's multi-profile launcher (`./profile <name>`) uses under the hood.

### Resolution Precedence:
1. **Environment Variables (`CAREER_OPS_ROOT` or `CAREER_OPS_DATA_DIR`):** Set this to the absolute or relative path of your custom data directory (a relative path is resolved against the engine root).
2. **Marker File (`.career-ops-data`):** A file named `.career-ops-data` in the engine root containing the path (absolute or relative) to the user data directory.
3. **Repository Default:** Defaults to the engine/checkout root directory.

When resolved, all User Layer files/directories (e.g. `cv.md`, `config/profile.yml`, `modes/_profile.md`, `modes/_custom.md`, `data/`, `reports/`, `output/`, `portals.yml`) are resolved relative to that path. System Layer files continue to resolve relative to the engine root, keeping code and personal data completely separate. Scripts reach both roots through `resolveCareerOpsRoot(import.meta.url)` (`{engineRoot, dataRoot}`) or `getCareerOpsRoot()` in `path-resolver.mjs` — never their own directory.

### Tracker Path & Writes:
- **`CAREER_OPS_TRACKER`** can be set to override the applications tracker file path directly.
- **Read Resolution:** If no tracker override is set, reading resolves to `{DATA_ROOT}/data/applications.md` if it exists; otherwise falls back to `{DATA_ROOT}/applications.md`.
- **Write Resolution:** All writes (including merge operations and first-run creation) target the canonical location `{DATA_ROOT}/data/applications.md`.
