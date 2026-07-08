# End-to-End Requirements Conformance Audit

Updated: 2026-06-29

Authority: `PLAN.md`, then Job Search Strategy Update, then Generic Job Search
Strategy. This report describes runtime behavior, not intended documentation.

## Override register

| Earlier requirement | Effective requirement |
|---|---|
| 35/25/15/10/10/5 or earlier match matrices | Application Fit uses Skills 45, Experience 25, Eligibility 15, Notice+Education 10, Other 5. |
| Multi-state candidate skill controls | One visible Skills field; evidence confidence remains internal. |
| Primary/adjacent/excluded title controls | One Current Role and multi-value Interested Roles; legacy primary/adjacent roles normalize into Interested Roles. |
| Sequential multi-page discovery form | Candidate Profile left and Job Preferences right; mobile stacks profile first. |
| Precision-first/score cutoff | Recall-first; valid low-fit jobs remain available. |
| Old/reposted jobs merely rank lower | Confirmed dates over 60 days are excluded; unknown dates remain flagged. |
| Manual profile refresh after switching | Cached profile jobs render first, then only the selected profile refreshes in background. |

## Traceability matrix

| Effective requirement | Runtime implementation | Automated evidence | Status / remediation |
|---|---|---|---|
| Upload creates local draft only | `api/onboarding/extract/route.ts`, `api/cv/ingest/route.ts` | `api/cv/ingest/route.test.ts`, `lib/onboarding/resume-extractor.test.mjs` | Pass |
| Replacement clears stale inference and rolls back on failed search | upload intake + `profile-writer.mjs` | upload/profile-writer suites | Pass |
| Candidate Profile / Job Preferences two-column responsive review | `public/index.html`, `styles.css` | onboarding UI suite | Pass |
| Only Current Role, Skills, Interested Roles controls | `public/index.html`, `app.js` | onboarding UI suite | Pass |
| Editable education, certifications, notice period | onboarding UI, inference, writer | profile inference/writer suites | Pass |
| Unified fields with legacy migration | `config-schema.mjs`, inference/writer | search-plan/profile suites | Pass |
| Broad technical and non-technical role catalog | `public/option-catalog.js` | onboarding UI catalog assertions | Pass |
| Custom role/skill values | chip selector custom-add path | onboarding UI contract | Pass |
| Preferences drive role/industry/geographic queries | `query-builder.mjs` | search-plan suite | Pass |
| Profile evidence drives weighted fit | `scoring/scorer.mjs` | scorer suite | Pass |
| Query provenance | `query-builder.mjs` `signals` | search-plan suite | Pass |
| Broad ATS/company/remote/startup/aggregator/regional sources | source registry + runner | search-plan/runner suites | Pass |
| 50–100 verified jobs where inventory permits | runner depth/dedup | controlled 84-job fixture | Pass |
| Observable raw/verified/duplicate/expired/old/unknown/final funnel | runner telemetry + Jobs panel | runner/UI suites | Pass |
| No score-4 admission cutoff | `isDiscoverableJob` | score-1 admission assertion | Pass |
| Low-fit jobs retained | runner + Low Fit dashboard section | runner/UI suites | Pass |
| 0–14 / 15–30 / 31–60 freshness | `classifyFreshness` | scorer suite | Pass |
| >60-day confirmed jobs excluded; unknown dates retained | runner + normalized freshness | scorer/runner suites | Pass |
| Eligibility unknown lowers rank; explicit conflict caps | eligibility + scorer | scorer suite | Pass |
| Exact 45/25/15/10/5 breakdown | scorer/config schema | scorer suite | Pass |
| Mandatory/preferred/related/transferable skill handling | requirements + scorer | scorer suite | Pass |
| Education neutral unless required | education scorer | scorer suite | Pass |
| Compact cards with explanations and decision fields | `public/app.js`, styles | onboarding UI static contract | Pass; visual QA pending |
| Jobs/Tracker/Ops/Intel explanations | `public/index.html` | onboarding UI suite | Pass |
| Agent inbox/command console hidden | dashboard markup/styles | onboarding UI suite | Pass |
| Per-profile cache/config/draft/tracker roots | server root routing + local paths | upload/profile isolation suites | Pass |
| Per-profile refresh state and cached-first switching | server refresh map + client background refresh | profile-isolation suite | Pass |
| Provider-native posted timestamps | provider adapters vary | scorer covers aliases; provider-by-provider fixture coverage incomplete | Partial - Medium |
| Automatic batch enrichment of promising leads | bounded four-lead post-discovery batch reuses verify/promote path | runner lead batch assertions | Pass |
| Live browser desktop/mobile QA | browser execution required | checklist below | Deferred - environment/session |

## Automated results

- Dashboard product assertions: 68 passed across config, discovery, onboarding,
  profile inference/writer, extraction, scoring, query generation, upload, and
  profile isolation.
- Resume tailoring logic: 1 passed; PDF artifact assertion blocked only by
  Playwright Chromium `spawn EPERM`.
- Pipeline verification: 0 errors, 0 warnings.
- Privacy audit equivalent: 212 tracked files checked, no forbidden user-layer
  paths. The wrapper script itself could not spawn Git inside the managed
  sandbox, so its exact `git ls-files` predicate was run directly.
- Doctor: onboarding complete; warning only that Playwright MCP tools were not
  detected.

## Controlled discovery funnel

The deterministic acceptance fixture supplies seven groups of 12 unique
verified jobs, followed by repeated groups across the remaining generated
queries. The runtime produces 84 final distinct jobs, reports duplicate losses,
and retains unknown-date jobs. This validates capacity and funnel accounting;
live inventory remains source-dependent and must report shortages in telemetry.

## Browser QA checklist

- [ ] Desktop: Candidate Profile is left; Job Preferences is right.
- [ ] Mobile: Candidate Profile stacks before Job Preferences.
- [ ] Searchable Current Role is single-value; Skills and Interested Roles are multi-value.
- [ ] Custom role and skill additions persist through preview/confirmation.
- [ ] Compact description is three lines; details expand/collapse.
- [ ] Strengths, primary concern, missing information, action, freshness, and source are legible.
- [ ] Low Fit is not selected by default but remains reachable.
- [ ] Switching two fictional profiles shows each cache immediately without mixed jobs.
- [ ] Background refresh indicator belongs only to the selected profile.

## Residual gap report

- **Medium:** Add provider-contract fixtures proving posted/updated timestamps,
  employment type, and authorization fields survive every native adapter.
- **Deferred:** Complete browser visual QA and PDF generation in an environment
  where Chromium can launch. Treat `spawn EPERM` as environmental, not product
  non-conformance.

No Critical or High gaps remain. Browser QA is still required for final visual
sign-off in an environment where Chromium can launch.
