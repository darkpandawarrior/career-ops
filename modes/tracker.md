# Mode: tracker — Applications Tracker

Read and display `data/applications.md`.

**Tracker Format:**

```markdown
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
```

With the optional Via column (intermediary channel, #1596) after Company:

```markdown
| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
```

- `Via` = the agency/recruiter firm the application goes through; `—` for direct applications. Add the column to an existing tracker with `node merge-tracker.mjs --migrate-via` (all scripts auto-detect both layouts via `resolveColumns()` in `tracker-parse.mjs`).
- **Unknown end employer** (recruiter hasn't named the client yet): Company = `?` (the structural marker — never the word "Confidential", which is locale-dependent and collides with real firm names), Via = the agency, and a distinguishing descriptor in Notes (e.g. `fintech, Leeds`). Display it to the user as "Confidential (via {Via})".
- Cross-channel dedup: `merge-tracker.mjs` never collapses two rows with the same company+role but a different Via — `applying twice through two channels IS two real submissions`, not a duplicate to merge.
- `Notes` is free text with one reserved segment: `posted: YYYY-MM-DD`, when the requisition went live. Write it as its own `;`-separated segment at the end of the note (`fintech, Leeds; posted: 2026-08-07`) and only from a pipeline entry's `| posted:` segment (`modes/pipeline.md`) — never from a guess. The dashboard reads it for the POSTED column (requisition age) and, having read it, excludes it from the last-contact calculation: a req going live is not an interaction with the company. Only a leading segment counts, so ordinary prose that happens to contain "posted" — "recruiter posted an update 2026-07-20" — stays a contact date, which is what it is.

Possible states: `Evaluated` → `Applied` → `Responded` → `Interview` → `Offer` / `Rejected` / `Discarded` / `SKIP`

- `Evaluated` = offer evaluated with report, pending decision
- `Applied` = the candidate submitted their application
- `Responded` = Company has responded (not yet interview)
- `Interview` = active interview process
- `Offer` = job offer received
- `Rejected` = rejected by company
- `Discarded` = discarded by candidate or offer closed
- `SKIP` = doesn't fit, don't apply

If the user asks to update a state, edit the corresponding row.

Also show statistics:
- Total applications
- Breakdown by state
- Average score
- % with PDF generated
- % with report generated

For the full lifetime stats view (cumulative funnel, scanner totals, portal
coverage, follow-up compliance), run `node stats.mjs --summary` and present its
output. Zero tokens — never recompute these numbers manually.

Run `node verify-pipeline.mjs` periodically as a cross-channel check: it flags
the same company+role appearing more than once as a "possible duplicate" —
including the case where it was submitted via two different channels (an
agency and direct, or two agencies). Never auto-merge these — both
submissions really happened; surface it and let the user decide which channel
owns the candidacy.

For per-agency advance-rate analytics (which recruiter firms actually convert
vs. which just re-list the same roles), run `node analyze-patterns.mjs` and
read its `viaChannelAnalysis` section, or see `modes/patterns.md`.

For desired-vs-advertised-vs-actual compensation, run `node salary-gap.mjs --summary`
and present its output. It folds the JD's advertised figure (from each report's
Machine Summary), the user's stated desired numbers, and any recorded actual
offers (`data/salary-observations.tsv`) — zero tokens, never recompute by hand.
