# HireSignal

<p align="center">
  <strong>Local-first career intelligence for focused job discovery, resume onboarding, and evidence-based fit scoring.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/Local--first-111827?style=flat" alt="Local-first">
  <img src="https://img.shields.io/badge/Built_on-career--ops-blue?style=flat" alt="Built on career-ops">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT">
</p>

## What Is This

HireSignal is a focused career dashboard built on top of the open-source [career-ops](https://github.com/santifer/career-ops) project by Santiago Fernandez de Valderrama.

career-ops provides the foundation: the job-search pipeline, AI-agent workflow, scanner architecture, tracker conventions, PDF generation flow, liveness checks, and the philosophy of quality applications over spray-and-pray automation.

HireSignal extends that foundation with a local web dashboard that helps a candidate:

- upload and review a resume locally
- convert resume evidence into a structured search profile
- discover jobs from ATS feeds, configured sources, remote boards, and search leads
- score opportunities against candidate facts instead of shallow title matching
- generate evidence-preserving tailored resumes
- keep career-ops compatibility for scans, reports, trackers, modes, and templates

The intent is simple: fewer random applications, more informed decisions.

## Why HireSignal Exists

Most job tools either track applications after the fact or encourage volume. HireSignal is designed for the earlier decision point: should this role deserve your attention at all?

It treats your resume and preferences as the source of truth, then searches and ranks opportunities by signals that matter:

- demonstrated skills
- adjacent and excluded skills
- experience range
- location and remote eligibility
- compensation gates
- joining availability
- candidate-controlled preferences

It does not submit applications. It helps you decide what is worth applying to.

## Built On career-ops

This project uses [santifer/career-ops](https://github.com/santifer/career-ops) as its upstream base.

Credit where it is due:

- career-ops created the original AI job-search command center
- career-ops established the scanner, tracker, report, PDF, and agent-skill workflow
- career-ops provides the ethical stance: quality applications, human review, no automated spam
- HireSignal adds a dashboard/product layer for resume onboarding, search configuration, scoring, and job review

The original code is MIT licensed. The `career-ops` name and brand belong to the upstream project; HireSignal is a distinct project that describes its lineage without implying official endorsement.

## Features

| Feature | What it does |
| --- | --- |
| Local resume onboarding | Upload a PDF resume, extract text locally, and review inferred profile facts before activation. |
| Evidence-backed profile review | Converts resume sections into editable candidate facts, target roles, skills, seniority, location policy, and compensation preferences. |
| Profile-driven search | Builds discovery queries from candidate facts and combines ATS providers, remote feeds, configured portals, scan history, and pipeline entries. |
| Fit scoring | Scores roles using skills, experience, eligibility, compensation, availability, and preferences rather than title-only matching. |
| Tailored resumes | Generates tailored HTML/PDF resumes while preserving factual claims from the canonical CV. |
| Privacy audit | Checks that local dashboard code does not leak private resume/profile data into system-layer files. |
| career-ops compatibility | Keeps the core tracker files, reports, scanner scripts, modes, templates, and data contract available. |

## Quick Start

Install dependencies:

```bash
npm install
```

Run the dashboard:

```bash
npm run dashboard:web
```

Open:

```text
http://127.0.0.1:4173
```

The dashboard will guide you through:

1. Uploading a resume PDF
2. Extracting and reviewing resume evidence
3. Activating a local profile
4. Running a first job search
5. Reviewing ranked opportunities

## Useful Commands

```bash
npm run doctor              # Check required career-ops setup files
npm run dashboard:web       # Start the HireSignal web dashboard
npm run dashboard:check     # Run dashboard tests
npm run dashboard:audit     # Check private-data boundaries
npm run scan                # Run the zero-token career-ops scanner
npm run scan:full           # Reverse-discover jobs from public ATS APIs
npm run tracker             # Open the career-ops tracker
npm run pdf                 # Generate a career-ops PDF resume
```

## Project Structure

```text
dashboard-web/
  public/                 Web dashboard UI
  onboarding/             Resume extraction, profile inference, activation
  scoring/                Candidate-fit scoring
  search/                 Query generation and job discovery
  test/                   Dashboard-focused tests

config/
  job-search.example.yml  Example search profile structure

data/
  applications.md         career-ops tracker
  pipeline.md             pending job URLs
  job-dashboard.json      generated dashboard cache

docs/
  PUBLIC_DASHBOARD_*.md   Design, privacy, setup, scoring, and search notes
```

## How HireSignal Uses career-ops

HireSignal is not a separate job-search engine bolted next to career-ops. It is a dashboard layer over the parts of career-ops that are useful for a local, candidate-specific workflow.

| career-ops capability | How HireSignal uses it |
| --- | --- |
| Data contract | Keeps candidate data in user-layer files such as `cv.md`, `config/profile.yml`, `config/job-search.yml`, `modes/_profile.md`, `portals.yml`, `data/`, `reports/`, and `output/`. |
| Scanner architecture | Reuses `scan.mjs`, `scan-ats-full.mjs`, provider feeds, scan history, and pipeline conventions to discover jobs without relying on a hosted service. |
| Tracker model | Keeps `data/applications.md`, `data/pipeline.md`, status normalization, deduplication, and report links compatible with career-ops workflows. |
| Modes and templates | Keeps role evaluation prompts, profile narrative, resume templates, and PDF generation flow available for agent-assisted review. |
| Liveness and quality rules | Preserves the idea that job links should be checked, low-fit roles should be discouraged, and applications should never be submitted automatically. |

HireSignal removed upstream files that do not affect this local dashboard: upstream release automation, GitHub community workflows, Docker/Nix packaging, old demo assets, example packs, the npm scaffolder, the old Go dashboard, and non-Codex CLI adapter bundles.

## Workflow

The normal dashboard flow is:

1. **Resume upload**
   The browser sends a PDF to the local Node server. `dashboard-web/onboarding/upload-intake.mjs` validates the file type, size, and filename, then stages it in ignored draft storage. The active profile is not changed.

2. **Local extraction**
   `dashboard-web/onboarding/resume-extractor.mjs` and `pdf-layout.mjs` extract selectable PDF text locally. `resume-normalizer.mjs` identifies sections such as summary, experience, projects, education, and skills. Extraction warnings are shown when the PDF is image-heavy or too sparse.

3. **Profile inference and review**
   `profile-inference.mjs` proposes candidate facts from resume evidence: target roles, demonstrated skills, supporting skills, seniority, location preferences, compensation expectations, joining availability, and exclusions. The user reviews these facts before activation.

4. **Activation**
   `profile-writer.mjs` writes reviewed data into career-ops user-layer files:
   `cv.md`, `config/profile.yml`, `config/job-search.yml`, `modes/_profile.md`, `portals.yml`, and starter tracker/pipeline files when needed. It validates YAML and search rules before replacing active files, keeps rollback data during the first search, and clears stale dashboard caches after a successful activation.

5. **Search**
   `query-builder.mjs` builds a search plan from the reviewed profile. `job-search-runner.mjs` combines career-ops scanner output, reverse ATS discovery, configured provider feeds, board-wide feeds, pipeline entries, scan history, and search leads.

6. **Scoring and dashboard review**
   Every discovered job is normalized and scored by `dashboard-web/scoring/scorer.mjs`. Results are cached in `data/job-dashboard.json` and displayed as recommended roles, review roles, or source searches.

7. **Resume tailoring**
   For a selected real posting, `dashboard-web/resume-tailor.mjs` reorders existing CV evidence around job keywords and creates HTML, PDF, notes, and an editing prompt in `output/tailored-resumes/`. It does not invent new claims.

## Dataflow

```text
Resume PDF
  -> ignored onboarding draft
  -> local PDF extraction
  -> normalized resume sections
  -> reviewed profile facts
  -> career-ops user files
       cv.md
       config/profile.yml
       config/job-search.yml
       modes/_profile.md
       portals.yml
  -> generated search plan
  -> career-ops scanners + provider feeds + ATS discovery + search leads
  -> normalized jobs
  -> fit scoring and gates
  -> data/job-dashboard.json
  -> dashboard review + tailored resume output
```

Private candidate data stays in the local user layer. System-layer code and public docs should not contain real resume details, salary targets, private job notes, or application history.

## Decision Logic

HireSignal decisions are profile-driven. The dashboard does not score a role just because the title looks attractive.

### Filtering

Filtering happens before and during scoring:

- title filters come from reviewed target roles and adjacent roles
- excluded titles and excluded skills can cap or block a role
- search scopes decide whether local, remote, and international roles are considered
- international search requires explicit target countries or regions
- compensation gates flag roles below the reviewed target range
- eligibility gates flag work authorization or sponsorship uncertainty
- stale or duplicate scan results are reduced through career-ops scan history and tracker conventions

### Scoring

The main relevance score is based on three evidence signals:

- **skills:** demonstrated and supporting skills from the reviewed profile are matched against the job text
- **experience:** extracted job seniority and years are compared with the candidate's reviewed experience band
- **availability:** joining-window language is compared with the candidate's notice period or availability

The final dashboard score is shown on a 1-10 scale. A strong score can still be gated by compensation, eligibility, exclusions, or missing verification. Jobs are grouped roughly as:

- `Recommended`: score of 7+ with no hard gates
- `Review`: lower score or jobs with caveats
- `Source searches`: search-result leads that need opening before they can be treated as real postings

### Extraction Rules

Resume extraction is intentionally conservative:

- selectable PDF text is preferred
- layout recovery handles single-column, sidebar, and multi-column resumes
- only resume evidence is used for demonstrated skills
- recommended gaps are surfaced as gaps, not counted as existing experience
- generated tailored resumes reuse existing claims instead of inventing bullets

## Data And Privacy

HireSignal is local-first.

- Resume uploads are staged in ignored local draft storage.
- Profile activation writes to user-layer career-ops files such as `cv.md`, `config/profile.yml`, `config/job-search.yml`, `modes/_profile.md`, and `portals.yml`.
- Generated search caches live under `data/`.
- The dashboard avoids committing private candidate data.

Run:

```bash
npm run dashboard:audit
```

## Relationship To Upstream Updates

This repository keeps `upstream` pointed at:

```text
https://github.com/santifer/career-ops.git
```

That lets HireSignal periodically inspect new career-ops scanner, provider, mode, and safety improvements without treating this repository as a direct mirror.

Because HireSignal is now a separate project, do not blindly merge or rebase upstream into `main`. A normal upstream merge can reintroduce files that HireSignal intentionally removed if those files changed upstream or if Git sees them as newly added again.

Use a review branch instead:

```bash
git fetch upstream
git checkout -b upstream-review upstream/main
```

Then compare the upstream update against HireSignal:

```bash
git log --oneline dev..upstream-review
git diff --name-status dev..upstream-review
```

Port only useful runtime changes back into `dev`. Prefer scanner, provider, liveness, mode, template, parser, and safety fixes. Avoid reintroducing upstream-only project files such as GitHub workflows, Release Please config, Docker/Nix packaging, demo assets, examples, scaffolder files, and non-Codex CLI adapters.

Useful selective commands:

```bash
git checkout dev
git checkout upstream-review -- scan.mjs scan-ats-full.mjs providers modes templates
npm run dashboard:check
npm run dashboard:audit
```

If an upstream change touches the same area as HireSignal dashboard code, review it manually instead of copying the file wholesale. The dashboard should remain the product boundary; career-ops should remain the upstream engine and data-contract source.

## Ethics

HireSignal inherits career-ops' core principle: use automation to improve judgment, not to spam employers.

- Do not auto-submit applications.
- Review every generated resume and application answer.
- Avoid low-fit applications unless there is a strong human reason to override the score.
- Optimize for a smaller number of thoughtful applications.

## Attribution

HireSignal is derived from and built on [career-ops](https://github.com/santifer/career-ops), created by Santiago Fernandez de Valderrama and contributors.

The upstream project made the dashboard possible by providing the core job-search pipeline, agent instructions, scanner ecosystem, tracker model, PDF tooling, and update-safe data contract.

## License

This project includes MIT-licensed code from career-ops. See [LICENSE](LICENSE).

The `career-ops` name and brand are governed by the upstream project's trademark policy. HireSignal is a separate project name and does not claim official endorsement by career-ops.
