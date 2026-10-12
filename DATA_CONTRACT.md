# Data Contract

This document defines which files belong to the **system** (auto-updatable) and which belong to the **user** (preserved by updates).

## User Layer (preserved by updates)

These files contain your personal data, customizations, and work product. Updates preserve user-owned files. The updater may create or replace only these system-owned `.gitkeep` scaffolds inside user-layer directories: `data/.gitkeep`, `data/offers/.gitkeep`, `data/parser-output/.gitkeep`, `jds/.gitkeep`, `output/.gitkeep`, and `reports/.gitkeep`. It never checks out or modifies any other user file in those directories.

| File | Purpose |
|------|---------|
| `.career-ops-web/chats/*.json` | Local assistant conversation history (gitignored, not verified profile facts); only the chat API writes these files |
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
| `interview-prep/sessions/*.md` | Interview sessions — real transcripts + mock sessions (sensitive: real names/companies; gitignored except scaffold). Drives `patterns` Step 1b targeting signal and `interview-redflag` analysis. Scaffold files (`README.md`, `.gitkeep`) are system-owned. |
| `documents/*` | Your profile intake sources — master CV, LinkedIn export, diplomas, reference letters (PII — gitignored except scaffold; read locally by `intake.mjs`, see `modes/intake.md`). Scaffold files (`README.md`, `.gitkeep`) are system-owned. |
| `data/.gitkeep` | System-owned empty directory scaffold; the updater writes only this exact file and preserves all user files in `data/` |
| `data/offers/.gitkeep` | System-owned empty directory scaffold; the updater writes only this exact file and preserves all user files in `data/offers/` |
| `data/parser-output/.gitkeep` | System-owned empty directory scaffold; the updater writes only this exact file and preserves all user files in `data/parser-output/` |
| `data/intake-state.json` | Fingerprints of already-ingested intake sources (written by `node intake.mjs --commit`; makes re-runs propose only new material — safe to delete, next intake re-proposes everything) |
| `portals.yml` | Your customized company list |
| `config/plugins.yml` | Your plugin activation toggles (opt-in; seeded from `config/plugins.example.yml`) |
| `plugins.local/` | Your own / private plugins (never auto-updated) |
| `plugins.lock` | Integrity pins + recorded consent for your enabled plugins (generated; never auto-updated) |
| `data/applications.md` | Your application tracker (source of truth) |
| `data/career-profile.yml` | Your source-backed Master Career Profile; written only after explicit review of imported CV facts |
| `data/applications.db` | Derived query index over `applications.md` (SQLite, rebuilt by `node tracker.mjs sync` — safe to delete) |
| `data/pipeline.md` | Your URL inbox |
| `data/scan-history.tsv` | Your scan history: one tab-separated row per posting the scanners have seen. Columns are append-only — a new column goes at the end and existing ones never move — so older rows may have fewer columns, and a missing cell reads as empty. The column order is declared in `lib/scan-history-columns.mjs`; what each column holds is in the Scan History table of `modes/scan.md`. A cell that would run as a spreadsheet formula is stored with one extra leading `'`; `parseScanHistoryLine` removes it. |
| `data/scan-runs.tsv` | Your per-run scan counters (appended by `scan.mjs`, read by `stats.mjs`) |
| `data/scheduled-jobs.json` | Your local scheduled-scan definitions, queue, and bounded run history (written by the web UI and `web/scripts/scheduled-jobs-runner.mjs`) |
| `data/portal-health.tsv` | Consecutive reachability status for scanned portals (appended by `scan.mjs`; statuses: `reachable`, `empty`, `slug_gone`, `network`, `auth`, `server`, `unknown`, `unverified_zero` — the last four joined the vocabulary later, so older files carry only the first four; `unverified_zero` means a provider returned no jobs without any observed successful HTTP response and counts toward the failure streak) |
| `data/dead-boards.tsv` | Boards that returned three consecutive 404s during mass reverse ATS sweeps (written by `scan-ats-full.mjs`; unlike `data/portal-health.tsv`, this does not track the user's configured portals; re-probed after 30 days — safe to delete, the next sweep rebuilds it) |
| `data/follow-ups.md` | Your follow-up history |
| `data/active-interviews.md` | Your active interview processes, incl. inline `[process-friction]` notes (read by `process-quality.mjs`) |
| `data/agent-inbox.md` | Your append-only request queue drained at session start (written by `agent-inbox.mjs`) |
| `data/reply-candidates.json` | Your normalized employer-reply candidates (subject, body, sender, signal, plus optional `received_at`/`date` — read by `reply-watch.mjs`; a reliable received date is required for date-guarded company-wide rejection suggestions) |
| `data/reply-proposals/*.json` | Local integration status proposals with quoted evidence; read-only until explicit review in `reply-watch.mjs`. Acceptance writes status plus a `[reply-proposal:<digest>]` Notes receipt atomically through `set-status.mjs`; keep receipts to prevent replay. See `docs/REPLY_PROPOSALS.md` for the v1 draft contract; the format may change until a real producer writes to the directory. |
| `data/pdf-index.tsv` | PDF↔report linkage manifest (written by `generate-pdf.mjs`, read by `find.mjs`, the dashboard, and the `email` mode) |
| `data/offers/*` | Your received offers/contracts, promise notes, prep reports, and reply drafts (PII — gitignored, written by the `offer-prep` mode) |
| `data/outcomes/*` | Your application outcome logs and archived application artifacts (written by the `outcome` mode) |
| `data/salary-observations.tsv` | Your append-only compensation observation log: `{tracker#}\t{date}\t{desired\|advertised\|actual}\t{amount}\t{currency}\t{source}\t{note}`. Written by interactive modes when a figure is stated/confirmed; never edited in place. Column 1 is a **tracker#** — the `#` of the row in the active tracker file (`data/applications.md` in the default layout), not a report number. The two counters diverge permanently once any row exists without a report, so a number copied off a `reports/{###}-*.md` filename can name a different application; padding is not identity, so `29` and `029` are the same row. Advertised figures come from reports' `advertised_comp` instead — reports are themselves observation sources, reached through the tracker row's Report link rather than by matching numbers. Read by `salary-gap.mjs` |
| `data/apply-queue.md` | Your ranked apply queue (generated from your pipeline + profile) |
| `data/h1b/` | Local H-1B/PERM sponsorship index installed by the `h1b-sponsor` plugin's `plugins/h1b-sponsor/install-h1b-index.mjs` (public DOL disclosure data, ~8 MiB gzipped, plus its `.meta.json` sidecar). Not personal — a public dataset snapshot — but a downloaded binary artifact, never committed; already covered by the blanket `data/*` gitignore rule. Re-download with `--force` to refresh a quarter. |
| `data/cache/h1b/` | Your `h1b-sponsor` plugin lookup cache (one JSON file per company checked, keyed by name). Reveals which employers you are evaluating for sponsorship — treat as sensitive job-search-target data, same class as `data/pipeline.md`. Safe to delete (rebuilt on next lookup); already covered by the blanket `data/*` gitignore rule. |
| `data/hq/` | Your personal HQ page (`hq.html`, served at `/hq` by the dashboard) and its progress state (`state.json`, read/written by `/api/hq-state`) |
| `profiles.json` | Root profile registry — candidate name / email / owner handle per profile. Same class as `profiles.yml` |
| `profiles.yml.bak-*` | Timestamped backups written by `migrate-profile.mjs`; carry the same per-candidate private config as `profiles.yml` |
| `index.db` | Root SQLite index used by the web dashboard. **Most sensitive file in this table** — alongside `applications` / `status_events` / `pipeline_inbox` / `scan_history` it holds `auth_users` and `auth_sessions` (dashboard credentials and live session tokens). Derived and regenerable; safe to delete. Never commit — this repo pushes PRs to a public upstream |
| `status-log.tsv` (sibling of the active tracker file — `data/status-log.tsv` in the default layout) | Your append-only status transition ledger: `{tracker#}\t{date}\t{from}\t{to}\t{source}\t{note}`. Appended by `set-status.mjs` next to wherever the tracker lives, on every real status change (the tracker stays the source of truth for *state*; the ledger records *when* transitions happened); never edited in place — corrections are new `correction`-source lines. An unknown from- or to-state is the sentinel `-`, never an empty cell; the two columns then diverge, with a from of `-` parsing to null (no prior state) and a to of `-` preserved as the literal unknown-target sentinel, while an empty cell is rejected as `unknown from-state ""` or `unknown to-state ""` for its own column. The source column is a closed set whose members are `VALID_SOURCES` in `funnel-velocity.mjs` — that declaration is the authority, so this contract points at it rather than restating a list that goes stale the next time a writer is added. Any value outside the set parses but is counted as an unknown source and excluded from the funnel, so per-writer detail belongs in the note column rather than namespaced onto the source. Read by `funnel-velocity.mjs` and `company-history.mjs` |
| `data/upskill/*` | Your skill-gap analysis reports (written by the `upskill` mode) |
| `data/blacklist.md` | Your do-not-apply list (opt-in — absence = no filtering; never auto-populated: only you, or the agent on your explicit instruction, write to it. Its `Scope` is `company` (default: normalized feed company name) or `domain` (the Company cell is a hostname suffix matched to the posting URL); no parent/subsidiary relationship is inferred. Respected by `scan.mjs` and the `auto-pipeline`/`oferta`/`apply` gates; never a scoring input) |
| `data/assessments.tsv` | Your append-only skills-assessment log: `{date}\t{company}\t{report#\|-}\t{platform}\t{subject}\t{threshold%\|-}\t{score%\|-}\t{stale_note}`. Appended by `node assessment-log.mjs add`; never edited in place. Empty stale_note = no staleness observed. Read by `assessment-log.mjs` |
| `data/contacts.tsv` | Your job-search phonebook (third-party PII — gitignored): `{name}\t{company}\t{type}\t{title}\t{phone}\t{email}\t{linkedin}\t{tracker#\|-}\t{notes}`. `type` optional; when present must be one of the enum (recruiter\|hiring-manager\|peer\|interviewer\|internal-referral\|other), else flagged in `quality`. Written by the `contacto` mode only after you confirm; lines are updated in place when a contact's details change (unlike the append-only salary log). Read by `contacts.mjs` |
| `data/Connections.csv` | Your LinkedIn connections export (third-party PII — gitignored, never committed, never touched by the updater). Placed here by you: LinkedIn → Settings → Data Privacy → Get a copy of your data → Connections. Read fresh on every run by `linkedin-join.mjs`, which writes no cache, index or sidecar state, so the file is disposable — delete it after use and re-export when you need it again. Never enters a prompt and never leaves the machine; only rows you paste by hand reach `data/contacts.tsv` |
| `writing-samples/*` | Your personal writing samples for style calibration (except `writing-samples/README.md`, which is system-owned documentation delivered by updates) |
| `reports/*` | Your evaluation reports; `reports/.gitkeep` is the system-owned directory scaffold and may be replaced by the updater |
| `output/*` | Your generated PDFs; `output/.gitkeep` is the system-owned directory scaffold and may be replaced by the updater |
| `jds/*` | Your saved job descriptions; `jds/.gitkeep` is the system-owned directory scaffold and may be replaced by the updater |
| `templates/cv-{candidate}-{company-slug}.html`, `templates/cover-{candidate}-{company-slug}.html` | Your per-application generated CVs/cover letters, for installs that save the HTML twin under `templates/` instead of `output/` (#3636). `templates/` is otherwise system-owned (base CV/cover templates), so these are recognized by name rather than directory: anything under `templates/` starting with `cv-` or `cover-` that is NOT one of the shipped `cv-template*.html` / `cover-letter-template*.html` files is treated as your data — see `isGeneratedTemplateArtifact()` in the upstream updater (not shipped in this fork) |
| `templates/cv-template.{name}.html` / `.tex`, `templates/cover-letter-template.{name}.html` / `.tex` | Your own named CV/cover-letter template variant, when `{name}` matches `config/profile.yml`'s `cv.template` / `cover_letter.template` (the convention `cv-templates.mjs`'s `resolveTemplate()` reads — see its `KINDS`). `templates/` is otherwise system-owned, and a variant file this install created shares that directory and naming shape with the real shipped variants (`cv-template.zh-minimal.html`, ...), so it is recognized by cross-referencing the configured template name rather than by directory — see `isUserConfiguredTemplateVariant()` in the upstream updater (not shipped in this fork). An unconfigured or differently-named `cv-template.*.html` file is not covered by this carve-out and is still managed as a system file (updated or pruned normally). This is distinct from `templates/cv-{candidate}-{company-slug}.html` / `templates/cover-{candidate}-{company-slug}.html`, which is generated per-application *output*, not an authored template *variant*. |

### Fork-local paths

The two lists above describe *this project*. A fork usually carries files the project has never heard of — a nightly runner, an `.mcp.json`, a private fixtures directory. Those files are in the user layer by every definition that matters, but they cannot be added to `USER_PATHS`: that array lives in the upstream updater, which this fork does not ship and which a sync would overwrite.

`config/local-paths.txt` moves the declaration outside that blast radius. It is gitignored by default, read at runtime, and merged into the user layer by any tool that honours it (this fork has no updater of its own):

```text
# one repo-relative path per line; blank lines and # comments ignored
run-nightly.ps1
.mcp.json
qa-fixtures/          # trailing slash = everything under this directory
```

Absent file means no extra paths — identical to the behaviour of every install that never creates one.

Three declarations are refused, loudly, naming the entry:

| Refused | Why |
|---------|-----|
| An absolute path, or one containing `..` | Would extend "never touch" over files outside the checkout |
| A path the system layer already ships | The file would silently stop receiving updates, with no other signal that it had been frozen |
| `config/local-paths.txt` itself | It is gitignored by default, so nothing updates it; listing it protects against a threat that does not exist and reads as though it did. A fork whose CI runs the suite un-ignores and commits it (see `config/local-paths.example.txt`); it is then tracked and not ignored, which both guards accept |

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

**If a file is user-owned, no update process may modify or delete it.** The only files the updater writes inside user-layer directories are the exact system-owned `.gitkeep` scaffolds listed above.

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
