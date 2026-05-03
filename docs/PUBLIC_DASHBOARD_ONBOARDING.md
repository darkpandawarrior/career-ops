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

The seven-step wizard covers:

1. Personal details
2. Experience and summary
3. Skills
4. Target roles and seniority
5. Location and remote policy
6. Compensation
7. Confirmation preview

`POST /api/setup/preview` validates the edited result and stores `review.json`
inside the ignored onboarding draft. Validation requires a name, at least one
target role, at least one demonstrated skill, and a home country. Compensation
is optional, but a currency is required when a minimum is configured.

This reviewed draft is still inactive. Milestone 6 will generate and preview
the career-ops files, back up existing user data, and require explicit
confirmation before activation.
