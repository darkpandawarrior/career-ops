# Public Dashboard Milestones

## Milestone 1: Foundation

- [x] Start from the exact `career-ops-v1.12.0` tag.
- [x] Create a dedicated product branch.
- [x] Preserve upstream license and attribution.
- [x] Add a profession-neutral local dashboard shell.
- [x] Add setup-status and profile API boundaries.
- [x] Add the machine-readable job-search configuration contract.
- [x] Add a tracked-file privacy audit.
- [x] Keep all candidate data outside Git.

## Milestone 2: Configuration-driven search and scoring

- [x] Load titles, skills, seniority, location, compensation, and weights.
- [x] Build generic query generation and source registry modules.
- [x] Build generic scoring with visible explanations.
- [x] Model demonstrated, confirmed, learning, recommended-gap, and excluded skills.
- [x] Add fictional fixtures and scoring tests.

## Milestone 3: Onboarding home and upload intake

- [x] Show resume upload on a clean first run.
- [x] Show Continue and New Profile choices for returning users.
- [x] Add Change Profile navigation from the dashboard.
- [x] Stage one local PDF upload with a 10 MB limit.
- [x] Validate extension, declared MIME type, and basic file signature.
- [x] Keep the active profile untouched until later review and confirmation.
- [x] Store draft uploads only under ignored local data.

## Milestone 4: Local resume extraction

- [x] Extract selectable text from PDF files with PDF.js.
- [x] Reconstruct one-, two-, and three-column PDF reading order from text coordinates.
- [x] Normalize whitespace and detect common resume sections.
- [x] Persist extraction output only inside ignored draft storage.
- [x] Surface extraction diagnostics and image-only PDF warnings.
- [x] Keep active user files unchanged.

## Milestone 5: Profile inference and review

- [x] Infer contact details with confidence and source metadata.
- [x] Estimate experience from the union of employment months without counting
  education, overlaps twice, or gaps between jobs.
- [x] Detect broad skills from resume evidence without inventing claims.
- [x] Suggest primary and adjacent role families with evidence.
- [x] Require user confirmation for target roles and skill states.
- [x] Require experience years and level, notice period, five demonstrated
  skills, target titles, local/remote/international search scopes, location,
  relocation, visa, and compensation policy.
- [x] Provide a seven-step editable review wizard.
- [x] Validate and store only a local reviewed draft without activating files.

## Milestone 6: Profile persistence

- [x] Generate canonical CV, profile, job-search, narrative, and portal files.
- [x] Validate generated YAML, search rules, portal rules, and Markdown.
- [x] Stage all replacement files before modifying the active profile.
- [x] Retain temporary rollback files until the replacement profile's first
  search succeeds.
- [x] Roll back partial replacements when activation fails.
- [x] Remove old profiles, onboarding drafts, and profile archives after the new
  job list appears.
- [x] Clear stale dashboard jobs after profile replacement.
- [x] Require explicit confirmation before activation.

## Milestone 7: Dashboard integration

- [x] Run career-ops scanning and configured source discovery on refresh.
- [x] Generate all source queries from the active profile.
- [x] Fetch configured Greenhouse, Lever, and Ashby company feeds.
- [x] Include remote feeds, pipeline history, scan history, and search fallbacks.
- [x] Port reverse ATS discovery across Greenhouse, Lever, Ashby, and Workday.
- [x] Expand generated discovery to ATS, startup, general, remote, and regional
  job sites.
- [x] Persist scored results in `data/job-dashboard.json` across sessions.
- [x] Re-score every discovered job using the active profile.
- [x] Start a fresh search immediately after profile activation.
- [x] Display organization, job site, score, urgency, eligibility, compensation,
  matched evidence, and score explanations.
- [x] Keep only Tailor Resume and Open Job actions on real job cards.
- [x] Generate evidence-preserving HTML, PDF, Markdown change notes, and an
  editing prompt for tailored resumes.
- [x] Exclude queue, automatic application, and form-fill actions.

## Milestone 8

Public release readiness follows the approved upgrade plan.
