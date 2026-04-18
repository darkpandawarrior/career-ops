# Public Dashboard Architecture

## Product boundary

This repository is a local, single-user career dashboard. Each clone has one
active profile and stores private career data on that user's computer.

It is not a hosted multi-user service. The server binds to `127.0.0.1` by
default and must not be exposed directly to the public internet.

## Data boundary

System code is tracked in Git. Candidate data is not.

Private user-layer files include:

- `cv.md`
- `config/profile.yml`
- `config/job-search.yml`
- `modes/_profile.md`
- `portals.yml`
- `.env`
- generated files under `data/`, `reports/`, `output/`, and `jds/`

Run `npm run dashboard:audit` before committing or publishing.

## Dashboard modules

- `dashboard-web/server.mjs` provides the local HTTP shell and API boundary.
- `dashboard-web/config.mjs` detects and reads the active local profile.
- `dashboard-web/onboarding/upload-intake.mjs` streams validated multipart
  resume uploads into ignored draft storage without changing active user files.
- `dashboard-web/onboarding/resume-extractor.mjs` performs bounded local PDF
  extraction with coordinate-aware layout recovery.
- `dashboard-web/onboarding/resume-normalizer.mjs` cleans text, identifies
  common and custom resume sections, and keeps employer/date blocks inside
  employment evidence.
- `dashboard-web/onboarding/profile-inference.mjs` creates evidence-labelled
  suggestions and validates the user-edited review draft.
- `dashboard-web/onboarding/profile-writer.mjs` generates and validates
  canonical user-layer files, retains temporary rollback state through the
  first search, then removes previous-profile caches.
- `dashboard-web/public/` contains the profession-neutral dashboard shell.
- `dashboard-web/search/config-schema.mjs` validates and normalizes targeting rules.
- `dashboard-web/search/query-builder.mjs` generates title, adjacent-role, and
  skill-rescue queries constrained by the reviewed local, remote, and
  international search scopes.
- `dashboard-web/search/job-search-runner.mjs` executes career-ops scanning,
  reverse ATS discovery, configured provider feeds, board-wide feeds, and
  generated search queries, then stores profile-scored results in the ignored
  dashboard cache.
- `dashboard-web/search/source-registry.mjs` defines reusable ATS and job-board
  search surfaces.
- `dashboard-web/scoring/` scores title, skill evidence, experience, eligibility,
  compensation, and preferences independently.
- `dashboard-web/resume-tailor.mjs` reorders existing CV evidence for a selected
  job and produces HTML, PDF, change notes, and a reusable editing prompt without
  inventing candidate claims.
- `config/job-search.example.yml` defines the search/scoring contract.

Resume extraction, review, and profile replacement remain separate
responsibilities. Activation writes only after validation and explicit user
confirmation.

## Skill evidence states

The scorer never treats a recommendation as candidate experience.

- `demonstrated`: supported by resume evidence.
- `confirmed_unlisted`: confirmed by the user but absent from the resume.
- `supporting`: useful secondary experience.
- `learning`: visible context with no full match credit.
- `recommended_gaps`: surfaced when a posting requests the skill, with no score
  credit.
- `excluded`: an explicit negative signal.

This separation lets the dashboard recommend development areas without
fabricating resume claims.
