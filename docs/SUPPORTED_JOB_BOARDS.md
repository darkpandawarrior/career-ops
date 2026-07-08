# Supported Job Boards

Career-Ops scans job sources through provider modules in `providers/`. Each
non-helper `*.mjs` file maps to one supported source. Files prefixed with `_`
are shared helpers and are not loaded as providers.

| Board | Type (API / RSS / parser) | Notes |
| --- | --- | --- |
| 4 Day Week | API | Reads the public `https://4dayweek.io/api/jobs` JSON feed (4-day-week / reduced-hours roles). Configure with `provider: 4dayweek`; paginates `?page=N` up to `max_pages` (default 3), drops expired postings, then scanner filters apply. |
| Arbeitnow | API | Reads the public `https://www.arbeitnow.com/api/job-board-api` JSON feed (EU/DACH-heavy, newest-first). Configure with `provider: arbeitnow`; paginates `?page=N` up to `max_pages` (default 3), then scanner filters apply. |
| Arbeitsagentur | API | Uses the public Bundesagentur fuer Arbeit Jobsuche REST API. Configure with `provider: arbeitsagentur`; title, location, and dedup filters run after fetch. |
| Amazon (amazon.jobs) | API | Auto-detects `amazon.jobs` careers URLs and hits the public `amazon.jobs` search JSON API (offset-paginated). The board is global; narrow it per-entry with an `amazon:` config block (e.g. `loc_query`, `base_query`, array facet filters like `normalized_country_code[]`). |
| Ashby | API | Auto-detects `https://jobs.ashbyhq.com/<slug>` boards and uses Ashby's public posting API. |
| Avature | Parser | Auto-detects `*.avature.net` careers URLs and parses the public `/careers/SearchJobs` result pages (6 results/page). A branded custom domain that proxies Avature needs `provider: avature` + `api:` pointing at the Avature origin. |
| BambooHR | API | Auto-detects `<tenant>.bamboohr.com` careers pages, reads `/careers/list`, and follows public detail endpoints for job URLs. |
| Breezy HR | API | Auto-detects `<tenant>.breezy.hr` boards and reads the public JSON position feed. |
| Comeet / Spark Hire Recruit | API | Uses Comeet's public careers API. Provide the full API URL with `api:` or `careers_url`; it cannot derive the endpoint from a branded careers page. |
| Consider (getconsider.com) | API | VC "talent network" portfolio boards (Founderful, Creandum, Balderton, Lightspeed, Notion Capital, …). Configure with `provider: consider` + `consider_board` (the board id, e.g. `wingman` for Founderful — NOT the host) and `careers_url` for the board origin. Optional `consider_size` (default 500). |
| Cornerstone OnDemand | API | Auto-detects `*.csod.com` careersite URLs (e.g. `career-<tenant>.csod.com/ux/ats/careersite/<id>/home`). Bootstraps an anonymous JWT off the branded home page, then reads the public search API. Configure with `provider: csod` for a custom domain proxying CSOD. |
| CutShort | Parser | Reads the embedded `__NEXT_DATA__` JSON off CutShort's public, robots-permitted SEO listing pages (`https://cutshort.io/jobs/<slug>`, e.g. `android-developer-jobs-in-pune`) — India product/startup board. Not auto-detected (shared multi-tenant domain); configure with `provider: cutshort` + `careers_url` pointing at the desired `/jobs/<slug>` page. One slug returns a fixed ~50-job snapshot with no real pagination. The interactive `cutshort.io/jobs?q=...` search app is a separate, session-gated surface and is out of scope. |
| Dassault Systèmes | API | Single-company provider for `3ds.com` careers, hitting the public Exalead card-search XML API behind `www.3ds.com/careers/jobs`. Auto-detects any `3ds.com` `careers_url`/`api`. |
| Deutsche Bahn | Parser | Single-company provider for `db.jobs` (Avature front). Auto-detects the `db.jobs` host; SSR search paginated over HTTP. |
| EchoJobs | API | Reads the board-wide `https://echojobs.io/api/jobs` JSON feed (tech jobs aggregated from company ATS boards). Configure with `provider: echojobs`; paginates `?page=N` up to `max_pages` (default 3), then scanner filters apply. Job URLs point at the original ATS posting. |
| Get on Board | API | Reads the board-wide `https://www.getonbrd.com/api/v0/categories/programming/jobs` public JSON:API feed (LatAm/remote tech board). Configure with `provider: getonbrd`; paginates up to `max_pages` (default 3). |
| Getro | API | VC "talent network" portfolio boards (b2venture, Cherry Ventures, Earlybird, Point Nine, Speedinvest, HV Capital, Atomico, …) — each job belongs to the portfolio company, not the fund. Configure with `provider: getro` + numeric `getro_collection` (the board's `network.id`). Paginates newest-first up to `getro_max_pages` (default 40), stopping past `getro_max_age_days` (default 90). |
| Glints | API | Uses Glints' public GraphQL job search endpoint (`searchJobsV3`, `v2-alc`). Configure with `provider: glints`; query and filters can be set on the portal entry. WAF blocks non-browser requests, so the provider sends a browser User-Agent. |
| Greenhouse | API | Handles explicit `api:` URLs and auto-detects public Greenhouse board URLs for the boards API. |
| Heckler & Koch | Parser | Single-company provider for `heckler-koch.com` careers (SSR Nuxt vacancy list). Auto-detects the `heckler-koch.com` host. |
| HigherEdJobs | RSS | Reads the public `https://www.higheredjobs.com/rss/categoryFeed.cfm?catID={catID}` feed and parses it in-process. Configure with `provider: higheredjobs` and optional `cat_id` (default 68 = Higher Education). Not auto-detected — requires explicit `provider:` config. |
| IBM Careers | API | Posts to IBM's public careers search API and supports optional IBM facet filters in the portal entry. |
| JazzHR | Parser | Auto-detects `<tenant>.applytojob.com` hosted careers pages and parses the public `/apply/jobs/` job table (server-rendered HTML, no pagination — full open-job list in one response). JazzHR's own API (`api.jazz.co`) requires a per-account auth token, so this is the only zero-token surface. Confirmed live against three independent tenants. |
| JibeApply | API | Auto-detects `https://<slug>.jibeapply.com/jobs` careers URLs (rewriting `/jobs` to the public `/api/jobs` endpoint); paginates `?page=N` up to `max_pages` (default 50), warning if a tenant's postings exceed the cap. Also supports branded/iCIMS-hosted sites at their own `/jobs` path via an explicit `provider: jibeapply` + `api:` URL. |
| Jobstreet / SEEK | API | Uses the public SEEK v5 JobSearch REST API (`/api/jobsearch/v5/search`) for Jobstreet and SEEK sites. Configure explicitly with `provider: jobstreet`. |
| join.com | Parser | Reads the embedded Next.js `__NEXT_DATA__` SSR blob off a public company career page (`https://join.com/companies/<slug>`) — no separate JSON/REST endpoint is exposed (the `candidate-api/graphql` endpoint has introspection disabled). Not auto-detected (shared multi-tenant host, like cutshort.io); configure with `provider: join` + `careers_url` pointing at the company's `/companies/<slug>` page. One fetch returns that company's full server-rendered job list. |
| Keka | API | Auto-detects `<tenant>.keka.com` careers pages (common among mid-size Indian tech companies). Fetches the public careers page to extract the tenant's embed identifier (a UUID in the page's client-side `fetch()` call), then reads the zero-auth JSON feed at `/careers/api/embedjobs/default/active/{identifier}`. Confirmed live against two independent tenants. |
| Joinup.ch | Parser | Swiss startup job platform. Reads the newest SSR page from `__NEXT_DATA__` on `https://joinup.ch/browse/jobs` (the full board sits behind a runtime-injected Typesense key). Auto-detects a `careers_url` on the `joinup.ch` host. |
| Landing.jobs | API | Reads the board-wide `https://landing.jobs/api/v1/jobs` JSON feed (tech, Europe). Configure with `provider: landingjobs`; company is derived from the posting URL slug. |
| Lever | API | Auto-detects `https://jobs.lever.co/<slug>` (US) or `https://jobs.eu.lever.co/<slug>` (EU) boards and uses Lever's matching public postings endpoint (`api.lever.co` / `api.eu.lever.co`). |
| Local parser | Parser | Runs an in-repo parser command from `portals.yml`. Use this for stable SSR or HTML pages that need a custom extractor. |
| NoDesk | RSS | Reads the public `https://nodesk.co/remote-jobs/index.xml` feed and parses it in-process. Configure with `provider: nodesk`. |
| Personio | RSS | Auto-detects `<slug>.jobs.personio.de` or `.com` hosts and parses the public XML jobs feed. |
| Phenom People | API | Auto-detects Phenom-hosted careers sites and reads the public job-search API. Configure with `provider: phenom` for a branded custom domain. |
| Pinpoint | API | Auto-detects `<slug>.pinpointhq.com` boards and reads the public zero-auth `/postings.json` per-tenant feed. |
| Radancy (TalentBrew) | API | Auto-detects Radancy TalentBrew-hosted careers sites and reads the public job-search API. Configure with `provider: radancy` for a branded custom domain. |
| Recruitee | API | Auto-detects `<slug>.recruitee.com` boards and uses the public per-tenant offers API. |
| RemoteOK | API | Reads the board-wide `https://remoteok.com/api` JSON feed; scanner filters decide which rows are relevant. |
| Remotive | API | Reads the board-wide `https://remotive.com/api/remote-jobs` JSON feed, then applies local scanner filters. |
| Rheinmetall | Parser | Single-company provider for `rheinmetall.com` careers (SSR Nuxt vacancy list). Auto-detects the `rheinmetall.com` host. |
| Rippling | API | Auto-detects `https://ats.rippling.com/<slug>/jobs` careers pages and reads the public zero-auth board API (`api.rippling.com/platform/api/ats/v1/board/<slug>/jobs`). |
| SAP SuccessFactors (RMK) | Parser | Auto-detects `*.successfactors.(eu\|com)` / `jobs2web.com` hosts, or use `provider: successfactors` + `api:` for a branded RMK career site (e.g. `jobs.zf.com`); reads the public `/tile-search-results/?startrow=N` HTML fragment feed. |
| SmartRecruiters | API | Auto-detects SmartRecruiters careers URLs, or uses `provider: smartrecruiters` (optionally with `api:` pointing at `careers.smartrecruiters.com/<slug>`) for branded custom domains. |
| SolidJobs | API | Auto-detects `https://solid.jobs/public-api/offers/<division>` and reads the public offers API. |
| startup.ch | Parser | Swiss Startup Association job board (server-rendered ColdFusion page, all listings in one HTML response). Auto-detects a `careers_url` on the `startup.ch` host; primes a session cookie from the homepage and fails closed (throws) on the site's anti-bot error page instead of reporting zero jobs. |
| Teamtailor | RSS | Auto-detects `<slug>.teamtailor.com` career sites and reads the public zero-auth `/jobs.rss` per-tenant feed. For a branded careers domain, set `provider: teamtailor` and it reads `/jobs.rss` off that host. Job links may point at a branded custom domain; location comes from the `tt:` city/country tags, falling back to `Remote` when a posting carries no `tt:city`/`tt:country` but its `remoteStatus` is remote (`fully` or `temporary`). |
| The Hub | API | Reads the board-wide `https://thehub.io/api/jobs` JSON feed (Nordic/EU startups). Configure with `provider: thehub`; paginates `?page=N` up to `max_pages` (default 3), then scanner filters apply. |
| TKMS | Parser | Single-company provider for thyssenkrupp Marine Systems careers (SSR vacancy list). Auto-detects the TKMS careers host. |
| We Work Remotely | RSS | Reads the public `https://weworkremotely.com/remote-jobs.rss` feed and parses it in-process. |
| Workable | Parser | Auto-detects `https://apply.workable.com/<slug>` and parses Workable's public markdown jobs feed. |
| Workday | API | Auto-detects Workday `myworkdayjobs.com` careers URLs (or an explicit `api:` override for a branded custom domain) and posts to the public CXS jobs endpoint. Hardened pagination: retries 429/5xx with backoff, honors `Retry-After`, and stops early past `--since` or when a tenant exposes no post date. |
| Working Nomads | API | Reads the board-wide `https://www.workingnomads.com/api/exposed_jobs/` JSON feed, then applies scanner filters. |

When adding a new provider, add a new non-helper module under `providers/` and
update this table in the same PR.

## Investigated, found infeasible (no provider built)

Some platforms were investigated for zero-token provider coverage and found
not to expose anything reliably parseable without a full browser/JS
execution — following the precedent in
[`liveness-bot-block-policy.md`](liveness-bot-block-policy.md) of documenting
infeasibility honestly rather than shipping a brittle scraper. Real evidence
per platform, not a guess:

- **Darwinbox** (darwinbox.com / darwinbox.in) — confirmed real tenant
  hostnames (e.g. `cars24.darwinbox.in`, `clevertap.darwinbox.in`, plus
  `licious`/`boat`/`zepto`/`purplle`/`curefit`/`urbancompany`) all
  302-redirect `/careers` to `/user/login` (hard login wall, behind
  Cloudflare — `cf-ray` header, `challenges.cloudflare.com` in CSP). A
  different path, `/ms/candidate/careers` (and `/ms/candidate/*` generally),
  bypasses the login redirect and returns HTTP 200, but the response is an
  ~900-byte SPA shell with no embedded JSON and no `<script src>` bundle
  references at all — the real job data loads via a client-side XHR call
  this repo has no way to discover without executing JS (confirmed: the
  same host returns 200 for *any* plausible route prefix under that SPA's
  client-side router, and 302 for a nonsense path, meaning curl-visible
  response codes don't even reliably distinguish real routes from
  fallthrough). No zero-token path found.
- **Hirist** (hirist.tech, formerly hirist.com) — `robots.txt` does not
  explicitly block bots (generic Joomla-template rules, `Crawl-delay: 10`,
  only Yandex fully disallowed), so this was not a robots.txt hard-stop.
  However, real search-result pages (e.g.
  `www.hirist.tech/search/android-developer-jobs-in-pune`) embed a
  `schema.org/ItemList` JSON-LD block with `numberOfItems: 0` and an empty
  `itemListElement` — the SSR shell renders for SEO but never carries actual
  listings; job data is fetched client-side. The one clearly-named API host
  referenced in the bundle config (`api.hirist.tech`) returns **HTTP 401
  even on `robots.txt`** — access is blocked at the network/WAF edge before
  any application logic runs. Another candidate host in the bundle
  (`gladiator.hirist.tech`) has no robots.txt (404) and no discoverable
  path in the shipped JS chunks tying it to the actual search query — using
  it would mean guessing an undocumented internal API surface, exactly the
  brittle-scraper pattern this policy avoids.
- **iimjobs** (iimjobs.com) — same parent company/tech stack as Hirist,
  same finding: real search pages
  (`www.iimjobs.com/search/android-lead-jobs`) embed a `schema.org/ItemList`
  JSON-LD block with `numberOfItems: 0`, no populated job data server-side.
  `robots.txt` explicitly disallows Yandex only (not a general AI-bot
  block) but the content simply isn't there to scrape.

Revisit any of these if the platform ships a documented public API, or if a
future Playwright-based provider tier is added (see `liveness-browser.mjs`
for the existing headless-browser escalation pattern used for liveness
checks) — but that is a materially different maintenance cost than the
zero-token API/RSS/parser providers in the table above.
