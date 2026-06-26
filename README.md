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

career-ops provides the foundation: the job-search pipeline, AI-agent workflow, scanner architecture, tracker conventions, PDF generation flow, liveness checks, update system, and the philosophy of quality applications over spray-and-pray automation.

HireSignal extends that foundation with a local web dashboard that helps a candidate:

- upload and review a resume locally
- convert resume evidence into a structured search profile
- discover jobs from ATS feeds, configured sources, remote boards, and search leads
- score opportunities against candidate facts instead of shallow title matching
- generate evidence-preserving tailored resumes
- keep career-ops compatibility for scans, reports, trackers, and agent workflows

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
| career-ops compatibility | Keeps the existing `/career-ops` workflows, tracker files, reports, scanner scripts, and update conventions available. |

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

That lets HireSignal periodically rebase or merge new career-ops scanner, provider, mode, and safety improvements.

Recommended sync flow:

```bash
git fetch upstream
git rebase upstream/main
npm run dashboard:check
node test-all.mjs --quick
```

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
