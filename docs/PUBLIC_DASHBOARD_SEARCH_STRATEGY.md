# Public Dashboard Job Search Strategy

## Goal

Maximize relevant discovery without turning the dashboard into a mass-application
tool. Every result is still scored against the reviewed profile and must pass
title or strong skill-evidence checks.

The strategy is generated from four independent profile dimensions:

- interested roles, title synonyms, and seniority variants;
- unified candidate skills and preferred industries;
- career stage: intern/fresher/entry-level versus experienced;
- mandatory geographic scopes: local, remote, international, or any combination.

International search additionally requires explicit target countries or regions.

## Career-stage routing

### Intern, fresher, graduate, and entry-level

Prioritize:

- internships, apprenticeships, trainee schemes, graduate programs, campus
  hiring, fellowships, and junior roles;
- local early-career portals such as Internshala, Unstop, Apna, NATS,
  Apprenticeship India, and National Career Service for India;
- global early-career portals such as Prosple, GradConnection, WayUp,
  Handshake, university/research boards, Wellfound, and YC startup jobs;
- universal ATS and company career sites, but with graduate/intern/entry-level
  query terms added.

### Experienced candidates

Prioritize:

- major general portals, specialist profession boards, startup/scale-up boards,
  ATS networks, and direct company careers;
- seniority terms only when the reviewed profile selects them;
- country-specific experienced-hire portals such as Naukri, Instahyre,
  Cutshort, Hirist, IIMJobs, StepStone, Reed, Job Bank, NodeFlair, Bayt, SEEK,
  and equivalent regional sources.

The routing is profession-neutral. Engineering, marketing, sales, customer
success, finance, accounting, HR/recruiting, operations, design, healthcare,
nonprofit, and other roles use the same profile-generated title/skill/domain
queries.

## Geographic routing

- **Local:** home-country portals, home-country company pages, general portals,
  ATS networks, and preferred cities.
- **Remote:** remote APIs and remote-first boards plus remote terms on ATS,
  company, startup, and general portals.
- **International:** only the countries/regions explicitly selected by the
  user, including their country-specific portals and visa/relocation scoring.

## Implemented search layers

1. **Configured provider scan**
   - Runs `scan.mjs`.
   - Uses provider modules for company boards and board-wide feeds.
   - Supports Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee,
     Workday, RemoteOK, Remotive, Working Nomads, SolidJobs, and other providers
     already present in `providers/`.

2. **Reverse ATS scan**
   - Runs `scan-ats-full.mjs` on every activation and Refresh.
   - Checks up to 50 company boards per ATS by default across Greenhouse,
     Lever, Ashby, and Workday.
   - Looks back 14 days by default.
   - Runs at most once every 24 hours by default; normal Refresh actions reuse
     its pipeline/history results while all other sources refresh immediately.
   - Both values can be tuned with `CAREER_DASHBOARD_ATS_LIMIT` and
     `CAREER_DASHBOARD_ATS_DAYS`; cadence uses
     `CAREER_DASHBOARD_ATS_INTERVAL_HOURS`.

3. **Direct board-wide feeds**
   - RemoteOK
   - Remotive
   - Jobicy
   - Himalayas
   - Arbeitnow
   - Working Nomads
   - SolidJobs

4. **Generated web discovery**
   - ATS: Greenhouse, Ashby, Lever, Workable, SmartRecruiters, Workday,
     Recruitee.
   - Remote/startup: RemoteOK, Remotive, Himalayas, We Work Remotely,
     Working Nomads, Jobicy, Arbeitnow, Wellfound, YC Work at a Startup.
   - General: LinkedIn, Indeed, Glassdoor, Monster, Google-indexed jobs,
     Built In, and Dice.
   - India: Naukri, Indeed India, Foundit, Shine, TimesJobs, Instahyre,
     Cutshort, Hirist, IIMJobs, AmbitionBox, Apna, Hirect, Internshala,
     Unstop, NATS, Apprenticeship India, and National Career Service.
   - Remote: RemoteOK, Remotive, Himalayas, We Work Remotely, Working Nomads,
     Jobicy, Remote.co, NoDesk, JustRemote, Remote Rocketship, Arc, Turing,
     Contra, FlexJobs, and Arbeitnow.
   - Country-specific: Germany, UK, Canada, Singapore, UAE/Gulf, Australia/New
     Zealand, USA, France, pan-Europe, and Asia-Pacific portal families.
   - Specialist: engineering, design, marketing, sales, finance/accounting,
     healthcare/life sciences, nonprofit/social impact, university/research.
   - Company careers: major technology, global product, enterprise software,
     consulting/professional services, and India product-company groups.
   - Interested roles and generated synonyms are split into traceable queries.
     Independent skill queries preserve recall, and every query records the role,
     skills, industries, locations, and selected scopes that produced it.

5. **Deduplication and scoring**
   - Results from every layer are normalized to one contract.
   - Duplicate URLs/jobs collapse to the highest-scoring copy.
   - Candidate evidence drives fit; preferences drive role/geographic scope and
     assist eligibility and secondary scoring.
   - Valid lower-fit jobs remain available. Only irrelevant, expired, explicitly
     incompatible, or confirmed-over-60-day jobs are excluded.

## Why this is broader than the previous implementation

The earlier dashboard generated at most 30 searches across seven source groups.
It also invoked the tracked-company scanner even though onboarding generated no
tracked companies. The updated pipeline connects the private project's reverse
ATS strategy, raises generated discovery to 100 queries, expands to more than
dozens of profile-selected source groups, and reads up to 12 results per query.

## Reliability boundaries

- Provider-native/public feeds are preferred because their job identity,
  location, and posting status are more structured.
- Search-engine discovery is a fallback. It can be stale, incomplete, or
  throttled, so these results should be opened and verified.
- LinkedIn, Indeed, Glassdoor, and similar sites are discovery sources only.
  The dashboard does not automate login, scrape authenticated pages, or apply.
- Workable's documented REST API requires a customer API token. The existing
  public markdown feed remains best-effort for boards that expose it.
- Workday does not provide one universal public job-search API. The scanner
  uses each public careers site's CXS endpoint and keeps safety/page limits.

## Recommended next additions

1. **Optional Adzuna connector**
   - Good structured multi-country aggregation and pagination.
   - Requires an `app_id` and `app_key`; keep it opt-in and local-secret based.

2. **Country-specific provider configuration**
   - Generate JobStreet/SEEK and Glints board entries only for supported
     countries.
   - Add country mappings rather than sending every profile to every regional
     board.

3. **Freshness and liveness**
   - Normalized postings use 0–14, 15–30, and 31–60-day bands.
   - Confirmed postings older than 60 days are excluded; unknown dates are kept
     with a warning.
   - Liveness checks remain sequential and bounded for visible jobs.

4. **Search telemetry**
   - Cache per-source counts, errors, duration, and last successful refresh.
   - Show which sources contributed real jobs versus only search leads.
   - This makes weak or blocked sources visible instead of silently reducing
     coverage.

5. **Incremental refresh**
   - Keep provider cursors/timestamps and fetch only changes after the first
     broad scan.
   - This will allow a larger initial scope without making every Refresh slow.

## Primary references

- Greenhouse Job Board API:
  https://developers.greenhouse.io/job-board.html
- Lever Postings API:
  https://github.com/lever/postings-api
- Ashby Job Postings API:
  https://developers.ashbyhq.com/docs/public-job-posting-api
- SmartRecruiters Posting API:
  https://developers.smartrecruiters.com/docs/posting-api
- Workable API guidance:
  https://help.workable.com/hc/en-us/articles/115012771647-Using-the-Workable-API
- Remotive public jobs API:
  https://github.com/remotive-com/remote-jobs-api
- Adzuna API:
  https://developer.adzuna.com/overview
