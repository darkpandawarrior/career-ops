# Public Dashboard Onboarding

## Milestone 3 behavior

A clean clone opens the resume-upload screen.

A returning user sees two choices:

- Continue to the dashboard with the current active profile.
- Upload a new resume to begin a replacement draft.

The dashboard's Change Profile action returns to the same choice screen.

## Upload boundary

`POST /api/setup/upload` accepts standard browser `multipart/form-data` with
exactly one file field named `resume`.

Supported format:

- PDF

Controls:

- 10 MB maximum file size
- One file only
- Sanitized filename
- Extension and declared MIME validation
- Basic PDF signature validation
- No macro, embedded-object, or uploaded-file execution

The file is streamed into:

```text
data/onboarding-drafts/{draft-id}/
```

This path is ignored by Git. Uploading creates only a draft; it does not modify
`cv.md`, profile configuration, portals, trackers, reports, or job caches.

## Local extraction

`POST /api/setup/extract` accepts a staged `draftId` and extracts PDF text
locally through PDF.js. Coordinate-aware reconstruction preserves reading
order for conventional, sidebar, two-column, and three-column resumes.

The normalized result is stored as `extraction.json` in the same ignored draft
directory. It contains the full extracted text, recognized section blocks,
diagnostics, and warnings. The API returns bounded previews rather than the
entire resume text.

Image-only PDFs are not sent to an external OCR service. They receive a warning
that selectable text is insufficient. OCR can be considered as an explicit
future local enhancement.

Extraction safety limits include 100 PDF pages and 2 million extracted
characters.

The browser keeps the draft id in the local URL after upload, so refreshing the
page restores the staged file and its extraction preview.

## Profile inference and review

`POST /api/setup/infer` creates deterministic suggestions from extracted resume
evidence. Suggested fields include:

- Contact details and professional links
- Summary
- Employment-year estimate
- Skills and evidence state
- Likely role families
- Seniority

Every inferred value carries a confidence score and source description. The
system does not infer compensation, visa requirements, relocation preferences,
or remote-work eligibility.

Review uses two visible columns on desktop and stacks vertically on mobile:

- **Candidate Profile:** personal details, one current role, experience and
  seniority, one unified Skills selector, editable education/certifications,
  summary, and notice period.
- **Job Preferences:** multi-value Interested Roles, industries, local/remote/
  international scopes, locations/countries/remote regions, work mode,
  employment type, relocation/visa needs, and compensation.

Current Role is single-value. Skills and Interested Roles allow arbitrary custom
values. Evidence confidence remains internal; candidates do not classify skills
as demonstrated, supporting, or learning.

`POST /api/setup/preview` validates the edited result and stores `review.json`
inside the ignored onboarding draft. Validation requires a name, current role,
at least one interested role, at least one skill, and a home country. Compensation
is optional, but a currency is required when a minimum is configured.

This reviewed draft remains inactive until explicit confirmation. Confirmation
generates the local profile/search files, runs the first profile-scoped search,
and rolls back the previous profile if that search fails.
