# Public Dashboard Setup

## Requirements

- Node.js 20 or newer
- Git

## Install

```powershell
npm install
```

## Start the local dashboard

```powershell
npm run dashboard:web
```

Open `http://127.0.0.1:4173`.

To preview the scoring dashboard with fictional data:

```powershell
$env:CAREER_DASHBOARD_DEMO='1'
npm run dashboard:web
```

Demo mode reads only committed fictional fixtures and never creates a private
profile.

A clean clone opens PDF resume onboarding. The resume is extracted locally,
reviewed in an editable wizard, and activated only after explicit confirmation.
The wizard requires reviewed experience years (use `0` for freshers),
experience level, notice period, at least one target title, at least five
demonstrated skills, relocation preference, and at least one of local, remote,
or international search. International search also requires target countries
or regions. Target
titles are intentionally editable because resume-derived suggestions are not
an exhaustive search vocabulary.
Replacement keeps temporary rollback files while the first job search runs.
After the new job list loads successfully, the previous profile, old onboarding
drafts, and profile archives are permanently removed. If that search fails, the
previous profile is restored.

After activation, the dashboard performs a fresh profile-driven search.
Subsequent **Refresh jobs** actions run the same career-ops scan and configured
source discovery again. Results are cached locally in
`data/job-dashboard.json`.

Search combines configured providers, a reverse scan of Greenhouse, Lever,
Ashby, and Workday company boards, direct board feeds, and generated discovery
across ATS, remote, startup, general, and regional job sites. See
`docs/PUBLIC_DASHBOARD_SEARCH_STRATEGY.md`.

Real job cards expose two actions:

- **Tailor resume** creates an HTML resume, PDF, Markdown change notes, and an
  editing prompt under `output/tailored-resumes/`.
- **Open job** opens the original listing.

The dashboard does not queue jobs, submit applications, or fill application
forms.

Do not expose this server directly to the internet.
