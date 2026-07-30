# Scripts Reference

All scripts live in the project root as `.mjs` modules. Most are exposed via `npm run <name>`; a few (`build-cv-latex.mjs`, `add-entry.mjs`, `salary-gap.mjs`, `stats.mjs`, `invite-match.mjs`) don't have an npm alias yet and are run directly with `node`.

## Quick Reference

| Command | Script | Purpose |
|---------|--------|---------|
| `npm run doctor` | `doctor.mjs` | Validate setup prerequisites |
| `npm run verify` | `verify-pipeline.mjs` | Check pipeline data integrity |
| `npm run normalize` | `normalize-statuses.mjs` | Fix non-canonical statuses |
| `npm run dedup` | `dedup-tracker.mjs` | Remove duplicate tracker entries |
| `npm run merge` | `merge-tracker.mjs` | Merge batch TSVs into applications.md |
| `npm run pdf` | `generate-pdf.mjs` | Convert HTML to ATS-optimized PDF |
| `node build-cv-latex.mjs` | `build-cv-latex.mjs` | Build .tex from structured JSON payload |
| `npm run sync-check` | `cv-sync-check.mjs` | Validate CV/profile consistency |
| `npm run patterns` | `analyze-patterns.mjs` | Analyze tracker outcomes and report patterns |
| `node add-entry.mjs` | `add-entry.mjs` | Dedup + insert a `/career-ops add` entry into cv.md / article-digest.md |
| `npm run liveness` | `check-liveness.mjs` | Test if job URLs are still active |
| `npm run extract` | `browser-extract.mjs` | Headless read-only page extractor (opt-in `scan.extractor: cli`) — compact JSON for scan/JD |
| `npm run scan` | `scan.mjs` | Zero-token portal scanner |
| `npm run scan:full` | `scan-ats-full.mjs` | Reverse ATS discovery scanner |
| `npm run validate:portals` | `validate-portals.mjs` | Validate portals.yml shape before scanning |
| `npm run tracker` | `tracker.mjs` | SQLite derived index over applications.md — sync/query/history/export |
| `npm run find` | `find.mjs` | Resolve a report#/tracker#/company query to its full pipeline identity |
| `node invite-match.mjs` | `invite-match.mjs` | Fuzzy-match a pasted interview-invite email against `data/applications.md` |
| `node salary-gap.mjs` | `salary-gap.mjs` | Desired vs. advertised vs. actual compensation gap analysis |
| `node stats.mjs` | `stats.mjs` | Lifetime pipeline stats aggregator (tracker, scanner, portals, follow-ups, runs) |
| `npm run freshness` | `check-table-freshness.mjs` | Staleness validator for jurisdiction data tables (`as_of` / `next_effective` watchdog) |

---

## doctor

Validates that all prerequisites are in place: Node.js >= 18, dependencies installed, Playwright chromium, required files (`cv.md`, `config/profile.yml`, `portals.yml`), fonts directory, and auto-creates `data/`, `output/`, `reports/` if missing.

```bash
npm run doctor
```

**Exit codes:** `0` all checks passed, `1` one or more checks failed (fix messages printed).

---

## verify

Health check for pipeline data integrity. Validates `data/applications.md` against thirteen checks: canonical statuses (per `templates/states.yml`), no duplicate company+role pairs, all report links point to existing files, scores match `X.XX/5` / `N/A` / `DUP`, rows have proper pipe-delimited format, no pending TSVs in `batch/tracker-additions/`, no markdown bold in scores, no stale report-number reservation sentinels, no duplicate report numbers, no orphan reports (link-text only), no two `reports/*.md` files covering the same company+role (#1425), a 3-way orphan-report resolution across row #/link-text/filename-prefix (#1425), and Via channel consistency — confidentiality-word detection plus a cross-channel same-role duplicate warning (#1596). The report-duplication and orphan checks are warning-level: duplicates and stray reports can be legitimate (re-evaluation after a JD change, a superseded tracker dedup), so they never fail the run on their own.

```bash
npm run verify
```

**Exit codes:** `0` pipeline clean (zero errors), `1` errors found. Warnings (e.g. possible duplicates) do not cause a non-zero exit.

---

## normalize

Maps non-canonical statuses to their canonical equivalents and strips markdown bold and dates from the status column. Aliases like `Enviada` become `Aplicado`, `CERRADA` becomes `Descartado`, etc. DUPLICADO info is moved to the notes column.

```bash
npm run normalize             # apply changes
npm run normalize -- --dry-run  # preview without writing
```

Creates a `.bak` backup of `applications.md` before writing.

**Exit codes:** `0` always (changes or no changes).

---

## dedup

Removes duplicate entries from `applications.md` by grouping on normalized company name + fuzzy role match, with a req/job-ID guard (broader than bare numeric — also matches `R_…`, `JR…`, hyphenated `REQ-…`, and `Posting ID …` forms) so two distinct same-title postings at one company are never collapsed. Keeps the entry with the highest score. If a removed entry had a more advanced pipeline status, that status is promoted to the keeper.

```bash
npm run dedup             # apply changes
npm run dedup -- --dry-run  # preview without writing
```

Creates a `.bak` backup before writing.

**Exit codes:** `0` always.

---

## merge

Merges batch tracker additions (`batch/tracker-additions/*.tsv`) into `applications.md`. Handles 9-column TSV, 8-column TSV, and pipe-delimited markdown formats. Detects duplicates by report number, entry number, and company+role fuzzy match — with the same req/job-ID guard as `dedup` and a cross-channel guard so the same role reached via two different agencies (or an unknown employer) is never silently merged. Higher-scored re-evaluations update existing entries in place.

```bash
npm run merge                 # apply merge
npm run merge -- --dry-run    # preview without writing
npm run merge -- --verify     # merge then run verify-pipeline
```

Processed TSVs are moved to `batch/tracker-additions/merged/`.

**Exit codes:** `0` success, `1` verification errors (with `--verify`).

---

## validate:portals

Validates `portals.yml` before running the scanner. The validator is offline: it reads YAML, loads local provider IDs from `providers/*.mjs`, and checks common configuration mistakes without fetching any job boards.

It reports errors for invalid YAML shape, unknown explicit providers, malformed URLs, empty filter keywords, and invalid local parser blocks. It also validates `content_filter.by_title_keyword` (an optional, stricter positive/negative override scoped to jobs whose title matched a specific `title_filter.positive` keyword) — a `by_title_keyword` entry that doesn't match any `title_filter.positive` keyword is a warning (it will never apply), not an error. Duplicate enabled company names are warnings because they may be intentional during migrations, but they are worth reviewing.

```bash
npm run validate:portals
npm run validate:portals -- --file templates/portals.example.yml
node validate-portals.mjs --self-test
```

**Exit codes:** `0` no errors (warnings allowed), `1` one or more errors found.

---

## pdf

Renders an HTML file to a print-quality, ATS-parseable PDF via headless Chromium. Resolves font paths from `fonts/`, normalizes Unicode for ATS compatibility (em-dashes, smart quotes, zero-width characters), and reports page count and file size.

```bash
npm run pdf -- input.html output.pdf
npm run pdf -- input.html output.pdf --format=letter   # US letter
npm run pdf -- input.html output.pdf --format=a4        # A4 (default)
```

**Exit codes:** `0` PDF generated, `1` missing arguments or generation failure.

---

## build-cv-latex.mjs

Builds a `.tex` file from a structured JSON payload, handling template merge and LaTeX escaping automatically. The JSON is produced by the agent during evaluation — this script replaces the manual LaTeX generation step in `modes/latex.md`.

```bash
node build-cv-latex.mjs input.json output.tex
node build-cv-latex.mjs --test
```

**Exit codes:** `0` file generated, `1` missing inputs, invalid JSON, unresolved placeholders, or template not found.

---

## sync-check

Validates that the career-ops setup is internally consistent: `cv.md` exists and is not too short, `config/profile.yml` exists with required fields, no hardcoded metrics in `modes/_shared.md` or `batch/batch-prompt.md`, and `article-digest.md` freshness (warns if older than 30 days).

```bash
npm run sync-check
```

**Exit codes:** `0` no errors (warnings allowed), `1` errors found.

---

## patterns

Analyzes application outcomes, scores, archetypes, blockers, remote policy, and company size from `data/applications.md` and linked reports. New reports should include `## Machine Summary` YAML; `analyze-patterns.mjs` uses it first and falls back to legacy markdown parsing for older reports. Tech-stack-gap frequencies are normalized through a canonical spelling map (`NODEJS`/`node.js` → `Node.js`, `react native` → `React Native`, etc.) so case variants of the same technology don't fragment into separate buckets.

```bash
npm run patterns
npm run patterns -- --summary
npm run patterns -- --min-threshold 3
node analyze-patterns.mjs --self-test
```

**Exit codes:** `0` analysis succeeded, `1` insufficient data or parser self-test failure.

---

## salary-gap.mjs

Folds compensation observations into per-application desired/advertised/actual values and gap aggregates. Sources: `reports/*.md` Machine Summary `advertised_comp` (advertised, source `jd` — historical reports backfill automatically), `data/salary-observations.tsv` (desired/actual, append-only), and `config/profile.yml` `compensation.target_range` (desired default). Fold precedence: highest trust tier wins, then latest date (`actual`: contract > offer-letter > recruiter-verbal > user). Aggregates group by (company, role) and per currency — no FX conversion. Unparseable amounts, orphaned tracker numbers, sample sizes, and staleness are always reported.

```bash
node salary-gap.mjs             # JSON
node salary-gap.mjs --summary   # table + data-quality section
node salary-gap.mjs --self-test
```

Observation line format (TSV, one per line, `#`-prefixed lines are comments):

```text
{tracker#}\t{YYYY-MM-DD}\t{desired|advertised|actual}\t{amount}\t{currency}\t{source}\t{note}
```

Amounts: number + optional k/K suffix, ranges allowed ("80-90k"), annual gross unless noted. Sources: jd | profile | user | recruiter-verbal | offer-letter | contract.

**Exit codes:** `0` always (missing sources produce an explanatory empty result), `1` self-test failure.

---

## liveness

Tests whether job posting URLs are still live using headless Chromium. Detects expired patterns (e.g. "job no longer available"), HTTP 404/410, ATS redirect patterns, and apply-button presence. Supports multi-language expired patterns (English, German, French).

```bash
npm run liveness -- https://example.com/job/123
npm run liveness -- https://a.com/job/1 https://b.com/job/2
npm run liveness -- --file urls.txt
```

Each URL gets a verdict: `active`, `expired`, or `uncertain` with a reason.

**Exit codes:** `0` all URLs active, `1` any expired or uncertain.

---

## scan

Zero-token portal scanner. Runs configured local parsers for SSR/static career pages and hits ATS APIs (Greenhouse, Ashby, Lever) directly — no LLM tokens consumed. Reads `portals.yml` for target companies, outputs matching listings to stdout, and optionally appends to `data/pipeline.md`.

`scan_history.recheck_after_days` in `portals.yml` lets old `added` URLs become eligible for recheck after the configured number of days. If absent, scan-history dedup keeps the historical behavior and dedups forever. Permanent invalid statuses such as blocked host and malformed URL remain permanent.

For custom SSR pages, configure a tracked company with `scan_method: local_parser` and a `parser` block. The parser can be written in JavaScript, Python, or any language available as a local executable. Company-specific parsers usually already know their source URL and only need to print JSON jobs to stdout:

```yaml
parser:
  command: node
  script: scripts/parsers/example-company-jobs.js
  format: jobs-json-v1
```

Use `args` only for reusable parsers that intentionally accept runtime parameters such as `{careers_url}` or `{company}`.

If a parser writes full extraction artifacts for debugging or audit, store them under `data/parser-output/{company}/`. `scan.mjs` reads stdout and does not require those JSON files after parsing. Keep generated JSON artifacts out of git; `.gitkeep` placeholders are the only exception for preserving directory structure.

`content_filter.by_title_keyword` (optional, in `portals.yml`) scopes a stricter positive/negative content pair to only the jobs whose title matched a specific `title_filter.positive` keyword — for example, requiring an "AI Engineer" title match to also mention a concrete AI tool in the description, without that requirement leaking onto unrelated title categories.

After each non-dry run, one row of run counters is appended to `data/scan-runs.tsv` (see below) — this is what `stats.mjs`'s `runs` section reads.

```bash
npm run scan
```

**Exit codes:** `0` scan completed, `1` configuration error or no portals.yml found.

---

## scan:full

Reverse ATS discovery scanner. Where `scan.mjs` scans the companies you track in `portals.yml`, this inverts the direction: it walks public directories of companies per ATS (Greenhouse, Lever, Ashby, Workday) and surfaces fresh postings matching your `portals.yml` `title_filter` / `location_filter` — no manual company curation. Company directories come from the public [job-board-aggregator](https://github.com/Feashliaa/job-board-aggregator) dataset, cached in `data/cache/` for 24 hours.

Postings without a usable publish date are skipped — a reverse scan is only useful for fresh postings. New matches are appended to `data/pipeline.md` and `data/scan-history.tsv` in the same format as `scan.mjs`.

```bash
npm run scan:full                              # all ATS directories, last 3 days
node scan-ats-full.mjs --since 7               # postings from the last 7 days
node scan-ats-full.mjs --ats greenhouse,workday # subset of sources
node scan-ats-full.mjs --limit 200             # max companies per ATS
node scan-ats-full.mjs --dry-run               # preview without writing
node scan-ats-full.mjs --liveness              # Playwright-verify matches first
node scan-ats-full.mjs --md-out notes/scans    # also write a dated markdown digest
```

**Exit codes:** `0` scan completed, `1` configuration error (no portals.yml, unknown `--ats` source) or fatal scan error.

---

## tracker

SQLite **derived index** for the applications tracker (RFC #918, phase 1). `data/applications.md` stays the source of truth; `data/applications.db` is built from it by `sync` and is safe to delete at any time — it regenerates on the next sync. All writes keep going to the markdown exactly as today (`merge-tracker.mjs`, `set-status.mjs`, hand edits); the index is read-only infrastructure.

Why: at hundreds of rows a markdown table degrades structurally (encoding corruption, column drift, `|` inside cells shifting columns), and agents grepping it get model-dependent results. The index normalizes on sync, so a query returns the same rows for every model on every CLI — and corruption is detected at sync time instead of propagating silently.

Zero new dependencies — uses `node:sqlite`, built into Node ≥ 22.5.

```bash
node tracker.mjs sync                     # (re)build applications.db from applications.md
node tracker.mjs sync --check             # diagnose corruption only, no write (exit 1 if issues found)
node tracker.mjs query --status Applied --since 2026-05-01
node tracker.mjs query --company acme --json
node tracker.mjs history --id 42          # status transitions observed across syncs (Applied → Interview → ...)
node tracker.mjs export                   # inverse: index → canonical markdown table on stdout
node tracker.mjs export --out repaired.md # write to a file (existing file backed up to .bak first)
```

`query` and `history` auto-resync when the markdown changed since the last sync, so the index can never serve stale reads.

`sync` detects and reports the corruption classes markdown accumulates — mojibake placeholder cells, scores stranded in the status column, non-canonical statuses (resolved via `templates/states.yml` aliases), missing/duplicate ids, stray pipes — and normalizes them **in the index only**; the markdown is never modified. Fix at the source with `normalize-statuses.mjs` / `dedup-tracker.mjs`, then re-sync. Status changes between syncs accumulate in a `status_events` table, which gives `analyze-patterns.mjs` a real funnel instead of only the current snapshot.

`export` is the inverse of `sync` (round-trip `md → db → md` is lossless for clean input — enforced by `test-all.mjs`). It writes to stdout by default and never touches `applications.md` unless you explicitly pass it as `--out`. Phase 2 of #918 (DB becomes source of truth, markdown becomes a rendered view) is a separate, explicit per-user opt-in — not part of this script yet.

**Exit codes:** `0` success, `1` validation error, missing prerequisites (Node < 22.5, no `applications.md` to index), or corruption found by `sync --check`.

---

## find

Resolves a report number, tracker number, or company/role fragment to its full pipeline identity: company, role, tracker#, report#, canonical status, PDF path (from `data/pdf-index.tsv`), and report path. "Apply to #13" is ambiguous — report numbers and tracker row numbers diverge — and answering it used to require opening three files; this does it in one read-only lookup.

Zero dependencies, strictly read-only. Numeric queries match **both** the tracker # column and the report number from the Report link (`012` and `12` are the same number), so collisions between the two numbering schemes surface as multiple rows instead of a silent wrong pick. Text queries match company/role by case-insensitive substring, with the shared fuzzy matcher (`role-matcher.mjs`) as fallback for multi-word phrases.

```bash
node find.mjs 13                # report# OR tracker# 13 — shows both if they differ
node find.mjs acme              # company fragment
node find.mjs "data engineer"   # role phrase (fuzzy via role-matcher)
node find.mjs acme --json       # machine-readable output
```

Multiple matches print as a table; zero matches print a clean message.

**Exit codes:** `0` at least one match, `1` no match, missing query, or no `applications.md`.

---

## invite-match.mjs

Fuzzy-matches a pasted interview-invite email against `data/applications.md`: extracts company, date, and a req/job ID from the invite text, then ranks tracker rows by name similarity with a large confidence boost when a req/job ID appears in the row's Notes cell (compared case-insensitively, since an invite and the tracker notes may case the same ID differently).

```bash
node invite-match.mjs --file invite.txt
node invite-match.mjs --file invite.txt --json
```

**Exit codes:** `0` at least one candidate row, `1` no match or missing input.

---

## stats.mjs

Aggregates lifetime pipeline stats into one JSON report. Stats include tracker, scanner, portals, follow-ups and runs. Reads from `data/applications.md`, `data/scan-history.tsv`, `portals.yml`, `data/follow-ups.md` and `data/scan-runs.tsv`. If a file doesn't exist yet, the section turns into null.

```bash
node stats.mjs --summary             # returns human-readable table
node stats.mjs                       # returns json
```

On a fresh clone, with no data yet, the JSON format is as follows:

```json
{
  "metadata": {
    "generatedAt": "2026-07-07",
    "sources": {
      "tracker": false,
      "scanHistory": false,
      "followups": false,
      "portals": false,
      "scanRuns": false
    }
  },
  "tracker": null,
  "funnel": null,
  "scan": null,
  "portals": null,
  "followups": null,
  "runs": null
}
```

With `--summary` it returns:

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pipeline Stats — 2026-07-07
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tracker:    — no data (data/applications.md missing)
Scanner:    — no data (data/scan-history.tsv missing)
Portals:    — no data (portals.yml missing)
Follow-ups: — no data (data/follow-ups.md missing)
Runs:       — no data (data/scan-runs.tsv missing; created by the next scan)
```

---

## check-table-freshness

Staleness validator for the jurisdiction data tables (umbrella #2026). The tables' correctness decays on a schedule — minimum wages adjust annually, pre-announced legal changes land on known dates — and every row already carries the metadata to watch: a mandatory `as_of` verification date and, for rate-style rows, `next_effective`. This script is the watchdog: zero LLM, zero network, zero writes.

Discovery is schema-agnostic: any `templates/*.yml` (non-recursive) whose parsed YAML contains at least one object row with an `as_of` field is treated as a jurisdiction table — rows may sit in a top-level array or in an array under any top-level key (e.g. `covenants:`). Files without `as_of` rows (`states.yml`, `portals.example.yml`, `benchmarks.yml`) are silently skipped, so new tables are picked up automatically with no per-table registration. On a checkout with no jurisdiction tables yet, the script reports zero tables and exits `0` — that is the designed empty state, not an error.

Two finding types:

- **`expired`** (hard) — the row has a `next_effective` date, today ≥ `next_effective`, and the row was not re-verified on or after that date (`as_of` < `next_effective`): the pre-announced change has arrived and the table hasn't been updated.
- **`review-due`** (soft) — `as_of` is older than the review threshold (default 12 months): nobody has re-verified the row in a legal cycle. Threshold precedence: `--max-age-months` flag > `config/profile.yml` `table_freshness.max_age_months` > default. Thresholds are strict positive integers — an invalid flag value is a usage error (exit 1, fail-fast, never a silent fallback); an invalid config value is reported as a warning and the default applies.

Each finding copies the row's `sources`, so whoever picks it up knows exactly where to re-verify. Malformed or missing dates produce a warning entry and the row is skipped — never a crash: once an array qualifies as a row-set (≥1 row with `as_of`), a sibling row that *forgot* its mandatory `as_of` warns too, instead of silently vanishing from validation. All date math is UTC-midnight calendar math (no time-of-day drift); dates in tables are quoted `YYYY-MM-DD` strings.

```bash
npm run freshness
node check-table-freshness.mjs                    # JSON
node check-table-freshness.mjs --summary          # human-readable table
node check-table-freshness.mjs --max-age-months 6 # override review threshold
node check-table-freshness.mjs --today 2026-10-02 # deterministic date for tests
node check-table-freshness.mjs --self-test
```

**Exit codes (CI-friendly):** `1` if any `expired` finding or on invalid usage (bad `--max-age-months` / `--today` values), `0` otherwise — `review-due` alone never fails the run, so a scheduled job only goes red when a known legal change has actually landed unaddressed.

---

## data/scan-runs.tsv

`scan.mjs` appends one row to this file after each non-dry scan run, recording how many companies/boards it checked, how many postings it found vs. filtered out vs. flagged as duplicates vs. added, and how many errors occurred. `--dry-run` scans never write to this file. This is your personal data (see `DATA_CONTRACT.md`) — gitignored, never committed. Fields:

* `timestamp` — ISO timestamp of the scan
* `status` — always `completed` for now
* `companies` — number of companies scanned this run
* `boards` — number of job boards scanned this run
* `found` — total postings found
* `filtered_title` — filtered out by title mismatch
* `filtered_tier` — filtered out by tier
* `filtered_location` — filtered out by location
* `filtered_salary` — filtered out by salary
* `filtered_content` — filtered out by content
* `filtered_cooldown` — skipped because you recently applied to the same company + role and are still in the waiting period
* `dupes` — duplicate postings skipped
* `new_added` — new postings actually added to the pipeline
* `errors` — number of errors during the run
