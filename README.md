<div align="center">

```
██╗  ██╗██╗██████╗ ███████╗███████╗██╗ ██████╗ ███╗   ██╗ █████╗ ██╗
██║  ██║██║██╔══██╗██╔════╝██╔════╝██║██╔════╝ ████╗  ██║██╔══██╗██║
███████║██║██████╔╝█████╗  ███████╗██║██║  ███╗██╔██╗ ██║███████║██║
██╔══██║██║██╔══██╗██╔══╝  ╚════██║██║██║   ██║██║╚██╗██║██╔══██║██║
██║  ██║██║██║  ██║███████╗███████║██║╚██████╔╝██║ ╚████║██║  ██║███████╗
╚═╝  ╚═╝╚═╝╚═╝  ╚═╝╚══════╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝
```

**Local-first career intelligence — evidence-backed scoring, not spray-and-pray.**

---

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat-square&logo=playwright&logoColor=white)
![Local-first](https://img.shields.io/badge/local--first-111827?style=flat-square)
![Built on career-ops](https://img.shields.io/badge/built_on-career--ops-6366f1?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-64748b?style=flat-square)

</div>

---

## What Is This

HireSignal is a focused career dashboard built on top of the open-source [career-ops](https://github.com/santifer/career-ops) project by Santiago Fernandez de Valderrama.

career-ops provides the foundation: the job-search pipeline, AI-agent workflow, scanner architecture, tracker conventions, PDF generation flow, liveness checks, and the philosophy of quality applications over spray-and-pray automation.

HireSignal extends that foundation with a **local web dashboard** that helps a candidate:

- upload and review a resume locally
- convert resume evidence into a structured search profile
- discover jobs from ATS feeds, configured sources, remote boards, and search leads
- score opportunities against candidate facts instead of shallow title matching
- generate evidence-preserving tailored resumes
- keep career-ops compatibility for scans, reports, trackers, modes, and templates

> **The intent is simple: fewer random applications, more informed decisions.**

---

## Why HireSignal Exists

Most job tools either track applications after the fact or encourage volume. HireSignal is designed for the earlier decision point: **should this role deserve your attention at all?**

It treats your resume and preferences as the source of truth, then searches and ranks opportunities by signals that matter:

| Signal | What it gates |
|--------|--------------|
| Demonstrated skills | Direct evidence from your CV |
| Adjacent & excluded skills | Avoid roles you'd hate or underqualify for |
| Experience range | Seniority match — not just title match |
| Location & remote eligibility | Automatically applied to every result |
| Compensation gates | Flags anything below your target range |
| Joining availability | Matched against notice-period language in postings |
| Candidate-controlled preferences | Your call, not the algorithm's |

**It does not submit applications. It helps you decide what is worth applying to.**

---

## Features

| Feature | What it does |
|---------|-------------|
| Local resume onboarding | Upload a PDF resume, extract text locally, and review inferred profile facts before activation |
| Evidence-backed profile review | Converts resume sections into editable candidate facts: target roles, skills, seniority, location policy, and compensation preferences |
| Profile-driven search | Builds discovery queries from candidate facts, combining ATS providers, remote feeds, configured portals, scan history, and pipeline entries |
| Fit scoring | Scores roles using skills, experience, eligibility, compensation, availability, and preferences — not title-only matching |
| Tailored resumes | Generates tailored HTML/PDF resumes while preserving factual claims from the canonical CV |
| Privacy audit | Verifies local dashboard code does not leak private resume/profile data into system-layer files |
| career-ops compatibility | Keeps core tracker files, reports, scanner scripts, modes, templates, and data contract available |

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the dashboard
npm run dashboard:web

# 3. Open in browser
open http://127.0.0.1:4173
```

The dashboard guides you through:

1. Uploading a resume PDF
2. Extracting and reviewing resume evidence
3. Activating a local profile
4. Running a first job search
5. Reviewing ranked opportunities

---

## Commands

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

---

## Architecture

```
Resume PDF
  └─▶ onboarding draft (ignored local storage)
        └─▶ PDF extraction  ──────────────────────────────────────┐
              └─▶ resume-normalizer.mjs                           │
                    └─▶ profile-inference.mjs                     │
                          └─▶ [user reviews facts]                │
                                └─▶ profile-writer.mjs            │
                                      ├─▶ cv.md                   │
                                      ├─▶ config/profile.yml      │ user-layer
                                      ├─▶ config/job-search.yml   │ career-ops
                                      ├─▶ modes/_profile.md       │ files
                                      └─▶ portals.yml             │
                                                                   │
query-builder.mjs ◀────────────────────────────────────────────────┘
  └─▶ job-search-runner.mjs
        ├─▶ scan.mjs + scan-ats-full.mjs  (zero-token ATS feeds)
        ├─▶ provider feeds + remote boards
        ├─▶ pipeline entries + scan history
        └─▶ search leads
              └─▶ scorer.mjs  (skills × experience × availability)
                    └─▶ data/job-dashboard.json
                          └─▶ dashboard review
                                └─▶ resume-tailor.mjs
                                      └─▶ output/tailored-resumes/
```

Private candidate data stays in the local user layer throughout. System-layer code and public docs never contain real resume details, salary targets, or application history.

---

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

---

## Workflow

| Step | Module | What happens |
|------|--------|-------------|
| 1. Resume upload | `upload-intake.mjs` | PDF validated (type, size, filename), staged in ignored draft storage — active profile unchanged |
| 2. Local extraction | `resume-extractor.mjs`, `pdf-layout.mjs`, `resume-normalizer.mjs` | Text extracted locally; sections identified (summary, experience, projects, education, skills); warnings shown for image-heavy PDFs |
| 3. Profile inference | `profile-inference.mjs` | Proposes candidate facts: target roles, skills, seniority, location, compensation, availability, exclusions — user reviews before activation |
| 4. Activation | `profile-writer.mjs` | Writes reviewed data into career-ops user-layer files; validates YAML; keeps rollback data; clears stale caches |
| 5. Search | `query-builder.mjs`, `job-search-runner.mjs` | Builds search plan from profile; combines career-ops scanner, ATS discovery, provider feeds, pipeline entries, scan history |
| 6. Scoring | `scorer.mjs` | Every job normalized and scored; results cached in `data/job-dashboard.json`; displayed as Recommended / Review / Source searches |
| 7. Resume tailoring | `resume-tailor.mjs` | Reorders existing CV evidence around job keywords; produces HTML, PDF, notes, editing prompt in `output/tailored-resumes/`; never invents bullets |

---

## Scoring

The main relevance score uses three evidence signals:

| Signal | How it's measured |
|--------|-----------------|
| **Skills** | Demonstrated and supporting skills from reviewed profile matched against job text |
| **Experience** | Extracted job seniority and years compared with candidate's reviewed experience band |
| **Availability** | Joining-window language compared with candidate's notice period |

Scores are on a **1–10 scale**. A strong score can still be gated by compensation, eligibility, exclusions, or missing verification.

| Group | Threshold |
|-------|----------|
| Recommended | Score 7+ with no hard gates |
| Review | Lower score or jobs with caveats |
| Source searches | Search-result leads requiring manual opening before treatment as real postings |

### Filtering

Applied before and during scoring:
- title filters from reviewed target roles and adjacent roles
- excluded titles and excluded skills cap or block a role
- search scopes decide local, remote, and international eligibility
- international search requires explicit target countries or regions
- compensation gates flag roles below the reviewed target
- eligibility gates flag work authorization or sponsorship uncertainty
- stale or duplicate results reduced via career-ops scan history and tracker conventions

### Extraction Rules

- selectable PDF text preferred; layout recovery handles single-column, sidebar, and multi-column layouts
- only resume evidence used for demonstrated skills — gaps surfaced as gaps, not counted as experience
- tailored resumes reuse existing claims; no bullets invented

---

## How HireSignal Uses career-ops

HireSignal is not a separate job-search engine bolted next to career-ops. It is a dashboard layer over the parts of career-ops that are useful for a local, candidate-specific workflow.

| career-ops capability | How HireSignal uses it |
|----------------------|----------------------|
| Data contract | Candidate data kept in user-layer files: `cv.md`, `config/profile.yml`, `config/job-search.yml`, `modes/_profile.md`, `portals.yml`, `data/`, `reports/`, `output/` |
| Scanner architecture | Reuses `scan.mjs`, `scan-ats-full.mjs`, provider feeds, scan history, and pipeline conventions — no hosted service needed |
| Tracker model | `data/applications.md`, `data/pipeline.md`, status normalization, deduplication, and report links remain career-ops compatible |
| Modes and templates | Role evaluation prompts, profile narrative, resume templates, and PDF generation flow remain available for agent-assisted review |
| Liveness and quality rules | Job links checked, low-fit roles discouraged, no automatic submission |

HireSignal removed upstream files that do not affect this local dashboard: upstream release automation, GitHub community workflows, Docker/Nix packaging, old demo assets, example packs, the npm scaffolder, the old Go dashboard, and non-Codex CLI adapter bundles.

---

## Built On career-ops

This project uses [santifer/career-ops](https://github.com/santifer/career-ops) as its upstream base.

- career-ops created the original AI job-search command center
- career-ops established the scanner, tracker, report, PDF, and agent-skill workflow
- career-ops provides the ethical stance: quality applications, human review, no automated spam
- HireSignal adds a dashboard/product layer for resume onboarding, search configuration, scoring, and job review

The original code is MIT licensed. The `career-ops` name and brand belong to the upstream project; HireSignal is a distinct project that describes its lineage without implying official endorsement.

---

## Relationship to Upstream Updates

This repository keeps `upstream` pointed at `https://github.com/santifer/career-ops.git` to periodically inspect new scanner, provider, mode, and safety improvements — without treating this repo as a direct mirror.

**Do not blindly merge or rebase upstream into `main`.** A normal upstream merge can reintroduce intentionally removed files.

Use a review branch instead:

```bash
git fetch upstream
git checkout -b upstream-review upstream/main

# Compare
git log --oneline dev..upstream-review
git diff --name-status dev..upstream-review

# Port only useful runtime changes
git checkout dev
git checkout upstream-review -- scan.mjs scan-ats-full.mjs providers modes templates
npm run dashboard:check
npm run dashboard:audit
```

Prefer scanner, provider, liveness, mode, template, parser, and safety fixes. Avoid reintroducing: GitHub workflows, Release Please config, Docker/Nix packaging, demo assets, examples, scaffolder files, non-Codex CLI adapters.

---

## Data & Privacy

HireSignal is local-first. Nothing leaves the machine.

- Resume uploads staged in ignored local draft storage
- Profile activation writes to user-layer career-ops files only
- Generated search caches live under `data/`
- Dashboard code must not commit private candidate data

```bash
npm run dashboard:audit   # verify data boundaries are intact
```

---

## Ethics

HireSignal inherits career-ops' core principle: **use automation to improve judgment, not to spam employers.**

- Do not auto-submit applications
- Review every generated resume and application answer
- Avoid low-fit applications unless there is a strong human reason to override
- Optimize for fewer, more thoughtful applications

---

## Attribution

HireSignal is derived from and built on [career-ops](https://github.com/santifer/career-ops), created by Santiago Fernandez de Valderrama and contributors.

The upstream project made this dashboard possible by providing the core job-search pipeline, agent instructions, scanner ecosystem, tracker model, PDF tooling, and update-safe data contract.

## License

This project includes MIT-licensed code from career-ops. See [LICENSE](LICENSE).

The `career-ops` name and brand are governed by the upstream project's trademark policy. HireSignal is a separate project name and does not claim official endorsement by career-ops.
