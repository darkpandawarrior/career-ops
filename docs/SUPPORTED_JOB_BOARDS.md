# Supported Job Boards

Career-Ops scans job sources through provider modules in `providers/`. Each
non-helper `*.mjs` file maps to one supported source. Files prefixed with `_`
are shared helpers and are not loaded as providers.

| Board | Type (API / Atom / RSS / parser) | Notes |
| --- | --- | --- |
| 4 Day Week | API | Reads the public `https://4dayweek.io/api/jobs` JSON feed (4-day-week / reduced-hours roles). Configure with `provider: 4dayweek`; paginates `?page=N` up to `max_pages` (default 3), drops expired postings, then scanner filters apply. |
| a16z Speedrun Talent Network | API | Board-wide aggregator across the a16z speedrun cohort and the wider a16z portfolio (~200 startups): `https://speedrun-talent-network.com/api/v1/jobs`, public and zero-auth (OpenAPI at `/api/v1/openapi.json`). Configure with `provider: a16z-speedrun-talent`. |
| Agentic Engineering Jobs | API | Reads the site's public zero-auth REST API (`https://agentic-engineering-jobs.com/api/v1/jobs`, OpenAPI at `/api/v1/openapi.json`). Configure with `provider: agentic-jobs`; paginates `?page=N` (1-based, 50/page) up to 40 pages / 2000 postings, pacing requests under the documented 30 req/60s rate limit. Location uses the feed's human-readable string, falling back to decoded ISO country names; salary bounds attach when present. Job URLs point at `/jobs/{slug}` on the site. |
| Alibaba Group Careers | API | Auto-detects `https://talent.alibaba.com` URLs (host-matched, HTTPS-only) and posts to the public zero-auth position/search JSON API (zh-CN group-wide listings with title, category, city, experience range, full JD text, publish date). Each `keywords:` entry is queried server-side separately and results are deduped; omit `keywords:` to pull the whole board. Paginates up to `max_pages` per keyword (default 50, 100 posts/page). The endpoint's stateless double-submit CSRF check is satisfied by a self-minted per-run token pair — no login or session. |
| Amazon (amazon.jobs) | API | Auto-detects `amazon.jobs` careers URLs and hits the public `amazon.jobs` search JSON API (offset-paginated). The board is global; narrow it per-entry with an `amazon:` config block (e.g. `loc_query`, `base_query`, array facet filters like `normalized_country_code[]`). |
| Arbeitnow | API | Reads the public `https://www.arbeitnow.com/api/job-board-api` JSON feed (EU/DACH-heavy, newest-first). Configure with `provider: arbeitnow`; paginates `?page=N` up to `max_pages` (default 3), then scanner filters apply. |
| Arbeitsagentur | API | Uses the public Bundesagentur fuer Arbeit Jobsuche REST API. Configure with `provider: arbeitsagentur`; title, location, and dedup filters run after fetch. |
| Ashby | API | Auto-detects `https://jobs.ashbyhq.com/<slug>` boards and uses Ashby's public posting API. |
| Avature | Parser | Auto-detects `*.avature.net` careers URLs and parses the public `/careers/SearchJobs` result pages (6 results/page). A branded custom domain that proxies Avature needs `provider: avature` + `api:` pointing at the Avature origin. |
| BambooHR | API | Auto-detects `<tenant>.bamboohr.com` careers pages, reads `/careers/list`, and follows public detail endpoints for job URLs. |
| Beesite (milch & zucker GJB) | API | The search backend behind branded portals such as `jobs.mercedes-benz.com`. The SPA calls a public no-auth JSON endpoint on the tenant's `*.app.beesite.de` host (`GET {origin}/search?data={URL-encoded JSON}`). Configure with `provider: beesite`. |
| Breezy HR | API | Auto-detects `<tenant>.breezy.hr` boards and reads the public JSON position feed. |
| Careerjet | API | The official **v4** Job Search API (`search.api.careerjet.net`, HTTPS, HTTP Basic auth). Configure with `provider: careerjet`; needs `CAREERJET_API_KEY` from a Careerjet Publisher account. **Ships disabled.** The legacy unauthenticated endpoint (`public.api.careerjet.net` + `affid`) verified working on 2026-08-20 and returned HTTP 401 on 2026-08-21 — it is dead, not merely unregistered, so this provider was rebuilt against v4 and left off until a key proves non-zero yield. |
| Comeet / Spark Hire Recruit | API | Uses Comeet's public careers API. Provide the full API URL with `api:` or `careers_url`; it cannot derive the endpoint from a branded careers page. |
| Consider (getconsider.com) | API | VC "talent network" portfolio boards (Founderful, Creandum, Balderton, Lightspeed, Notion Capital, …). Configure with `provider: consider` + `consider_board` (the board id, e.g. `wingman` for Founderful — NOT the host) and `careers_url` for the board origin. Optional `consider_size` (default 500). |
| Cornerstone OnDemand | API | Auto-detects `*.csod.com` careersite URLs (e.g. `career-<tenant>.csod.com/ux/ats/careersite/<id>/home`). Bootstraps an anonymous JWT off the branded home page, then reads the public search API. Configure with `provider: csod` for a custom domain proxying CSOD. |
| CryptocurrencyJobs | RSS | Curated Web3/crypto board, RSS 2.0, no auth: `https://cryptocurrencyjobs.co/index.xml`. Listings are 100% remote. Title format is "Role at Company" — split on the last ` at ` to extract the company. Configure with `provider: cryptocurrencyjobs`. |
| CutShort | Parser | Reads the embedded `__NEXT_DATA__` JSON off CutShort's public, robots-permitted SEO listing pages (`https://cutshort.io/jobs/<slug>`, e.g. `android-developer-jobs-in-pune`) — India product/startup board. Not auto-detected (shared multi-tenant domain); configure with `provider: cutshort` + `careers_url` pointing at the desired `/jobs/<slug>` page. One slug returns a fixed ~50-job snapshot with no real pagination. The interactive `cutshort.io/jobs?q=...` search app is a separate, session-gated surface and is out of scope. |
| Dassault Systèmes | API | Single-company provider for `3ds.com` careers, hitting the public Exalead card-search XML API behind `www.3ds.com/careers/jobs`. Auto-detects any `3ds.com` `careers_url`/`api`. |
| Deutsche Bahn | Parser | Single-company provider for `db.jobs` (Avature front). Auto-detects the `db.jobs` host; SSR search paginated over HTTP. |
| Deutsche Bahn | parser | Single-company (same pattern as ibm / dassault / rheinmetall). DB's careers run on the custom `db.jobs` portal; the branded `jobs.deutschebahngroup.careers` front just 302-redirects into it. The search page exposes a server-rendered results endpoint that paginates over bare HTTP. Configure with `provider: deutschebahn`. |
| EchoJobs | **Retired (#2976, 2026-08-20)** | The board-wide `https://echojobs.io/api/jobs` feed this provider read is gone — both the feed and its `robots.txt` now answer with a Vercel bot-protection checkpoint (HTTP 429), and the site's own `robots.txt` disallows `/api`. career-ops does not work around bot protection, so this is not a provider to repair. `provider: echojobs` still resolves in `portals.yml` for backward compatibility, but `fetch()` throws immediately with an explanation naming the cause — remove the entry from your `portals.yml` when you see it. |
| Eightfold AI | API | Public per-tenant Talent Acquisition JSON API (zero-auth GET, no token or cookie). Eightfold hosts branded career sites for large enterprises (Bayer, Vodafone, PepsiCo, Autodesk, Micron). Configure with `provider: eightfold`. |
| Flowxtra | API | Board-wide aggregator across every company hosted on Flowxtra: `https://app.flowxtra.com/api/central/jobs`. Configure with `provider: flowxtra`. |
| Gem | API | Auto-detects `https://jobs.gem.com/<boardId>` boards and batches the listing plus per-job detail queries into a single POST to Gem's public GraphQL endpoint. |
| Get on Board | API | Reads the board-wide `https://www.getonbrd.com/api/v0/categories/programming/jobs` public JSON:API feed (LatAm/remote tech board). Configure with `provider: getonbrd`; paginates up to `max_pages` (default 3). |
| getManfred | API | Reads the board-wide `https://www.getmanfred.com/api/v2/public/offers` JSON feed (Spanish/EU tech roles, salary ranges published). Configure with `provider: manfred` and an optional `lang: EN\|ES` (the API rejects a call without one); the whole catalogue arrives in a single request and only `status: ACTIVE` offers are kept. |
| Getro | API | VC "talent network" portfolio boards (b2venture, Cherry Ventures, Earlybird, Point Nine, Speedinvest, HV Capital, Atomico, …) — each job belongs to the portfolio company, not the fund. Configure with `provider: getro` + numeric `getro_collection` (the board's `network.id`). Paginates newest-first up to `getro_max_pages` (default 40), stopping past `getro_max_age_days` (default 90). |
| Glints | API | Uses Glints' public GraphQL job search endpoint (`searchJobsV3`, `v2-alc`). Configure with `provider: glints`; query and filters can be set on the portal entry. WAF blocks non-browser requests, so the provider sends a browser User-Agent. |
| Greenhouse | API | Handles explicit `api:` URLs and auto-detects public Greenhouse board URLs for the boards API. |
| Hacker News (Who is hiring) | API | Reads the monthly "Ask HN: Who is hiring?" thread, no auth. Finds the current thread via the Algolia HN search API, then walks its top-level comments. Configure with `provider: hackernews`. Free-text posts, so expect lower precision than a structured board. |
| Heckler & Koch | Parser | Single-company provider for `heckler-koch.com` careers (SSR Nuxt vacancy list). Auto-detects the `heckler-koch.com` host. |
| Heckler & Koch | parser | Single-company. The vacancy list at `heckler-koch.com/de/Karriere/Stellenangebote` is a Nuxt page whose job cards are **server**-rendered, so one bare-HTTP GET returns every posting (small board, ~32 roles, Oberndorf a. N. / Vöhringen). Configure with `provider: hecklerkoch`. |
| HigherEdJobs | RSS | Reads the public `https://www.higheredjobs.com/rss/categoryFeed.cfm?catID={catID}` feed and parses it in-process. Configure with `provider: higheredjobs` and optional `cat_id` (default 68 = Higher Education). Not auto-detected — requires explicit `provider:` config. |
| Himalayas | API | Board-wide remote-jobs API: `https://himalayas.app/jobs/api?limit=50`. The full feed is fetched so the scanner's `title_filter` / `location_filter` gate locally, consistently with the other zero-token board providers. Configure with `provider: himalayas`. **Note:** the API caps `limit` at 20 regardless of the value requested, so each run samples a near-random slice of a very large board. |
| IBM Careers | API | Posts to IBM's public careers search API and supports optional IBM facet filters in the portal entry. |
| JazzHR | Parser | Auto-detects `<tenant>.applytojob.com` hosted careers pages and parses the public `/apply/jobs/` job table (server-rendered HTML, no pagination — full open-job list in one response). JazzHR's own API (`api.jazz.co`) requires a per-account auth token, so this is the only zero-token surface. Confirmed live against three independent tenants. |
| JibeApply | API | Auto-detects `https://<slug>.jibeapply.com/jobs` careers URLs (rewriting `/jobs` to the public `/api/jobs` endpoint); paginates `?page=N` up to `max_pages` (default 50), warning if a tenant's postings exceed the cap. Also supports branded/iCIMS-hosted sites at their own `/jobs` path via an explicit `provider: jibeapply` + `api:` URL. |
| Job Bank Canada | Atom | Canada's federal job-search service (jobbank.gc.ca, run by Employment and Social Development Canada) — a national employment service. Reads the public zero-auth Atom feed at `/jobsearch/feed/jobSearchRSSfeed`. Configure with `provider: jobbankca`; nested `jobbankca.keywords` is an explicit override, otherwise it falls back to `config/profile.yml`'s target roles. The feed's own `locationstring` filter is unreliable, so location filtering happens downstream. Paginates `?page=N` (100 results/page) up to `max_pages` (default 5), honouring the site's `robots.txt` `Crawl-delay: 5` between every request. |
| Jobicy | API | Board-wide remote-jobs aggregator feed: `https://jobicy.com/api/v2/remote-jobs?count=50`. Wire in via a `job_boards:` entry with `provider: jobicy`. |
| Jobspresso | RSS | Public WordPress jobs feed (`https://jobspresso.co/?feed=job_feed`), no auth. Parsed in-process with the same small tag extractor as `providers/personio.mjs` rather than adding an XML dependency. Configure with `provider: jobspresso`. Feed carries ~10 items. |
| Jobstreet / SEEK | API | Uses the public SEEK v5 JobSearch REST API (`/api/jobsearch/v5/search`) for Jobstreet and SEEK sites. Configure explicitly with `provider: jobstreet`. |
| Jobvite | RSS | Jobvite-hosted board feeds. Entity decoding uses the shared `_html-entities.mjs`, whose stricter XML 1.0 §2.2 char guard was upstreamed from this provider (#2623) so the two cannot drift apart again. Configure with `provider: jobvite`. |
| join.com | Parser | Auto-detects `join.com/companies/<slug>` careers URLs and parses the `__NEXT_DATA__` JSON embedded in the server-rendered HTML (no separate API). Paginates `?page=N` up to `max_pages` (default 50), warning if a tenant's postings exceed the cap. |
| Joinup.ch | Parser | Swiss startup job platform. Reads the newest SSR page from `__NEXT_DATA__` on `https://joinup.ch/browse/jobs` (the full board sits behind a runtime-injected Typesense key). Auto-detects a `careers_url` on the `joinup.ch` host. |
| JustJoin.it | API | Polish IT board. Browser URLs under `https://justjoin.it/job-offers/...` are accepted for detection, but fetches use the candidate offers API at `https://justjoin.it/api/candidate-api/offers`. Configure with `provider: justjoin`. |
| Keka | API | Auto-detects `<tenant>.keka.com` careers pages (common among mid-size Indian tech companies). Fetches the public careers page to extract the tenant's embed identifier (a UUID in the page's client-side `fetch()` call), then reads the zero-auth JSON feed at `/careers/api/embedjobs/default/active/{identifier}`. Confirmed live against two independent tenants. |
| Landing.jobs | API | Reads the board-wide `https://landing.jobs/api/v1/jobs` JSON feed (tech, Europe). Configure with `provider: landingjobs`; company is derived from the posting URL slug. |
| LaraJobs | RSS | Reads the board-wide `https://larajobs.com/feed` RSS feed (Laravel / PHP jobs) and parses it in-process. Configure with `provider: larajobs`; company and location come from the feed's `job:` namespace. |
| Lever | API | Auto-detects `https://jobs.lever.co/<slug>` (US) or `https://jobs.eu.lever.co/<slug>` (EU) boards and uses Lever's matching public postings endpoint (`api.lever.co` / `api.eu.lever.co`). |
| Local parser | Parser | Runs an in-repo parser command from `portals.yml`. Use this for stable SSR or HTML pages that need a custom extractor. |
| Local parser | parser | Not a hosted board — the escape hatch for a careers page with no API. Executes a user-supplied local parser module against fetched HTML. Configure with `provider: local-parser`; see [`docs/local-parser-cookbook.md`](local-parser-cookbook.md) for writing one. |
| Meituan | API | Public `zhaopin.meituan.com` JSON API (no auth, no browser, no special headers), verified 2026-07 by capturing the site's own XHR. Configure with `provider: meituan`. |
| MyCareersFuture | API | Singapore's national job bank, run by Workforce Singapore (WSG) — a public employment service. Reads the public zero-auth `POST /v2/search` JSON API. Configure with `provider: mycareersfuture`; nested `mycareersfuture.keywords` is an explicit override, otherwise it falls back to `config/profile.yml`'s target roles. Pagination is driven by the URL's `page` query param. Paginates `?page=N` (up to 100 results/page) up to `max_pages` (default 5, capped at 20). |
| NoDesk | RSS | Reads the public `https://nodesk.co/remote-jobs/index.xml` feed and parses it in-process. Configure with `provider: nodesk`. |
| NoFluffJobs | API | Public search posting API. Returns only the core scanner job fields; richer skill and salary metadata can be added if the provider contract is expanded. Configure with `provider: nofluffjobs`. |
| Oracle Recruiting Cloud (ORC) | API | Fusion Candidate Experience `recruitingCEJobRequisitions` REST API (zero-auth GET). Used by large employers — JPMorgan Chase, Oracle, BNY Mellon, American Express, Honeywell. Configure with `provider: oraclecloud`. |
| Personio | RSS | Auto-detects `<slug>.jobs.personio.de` or `.com` hosts and parses the public XML jobs feed. |
| Phenom People | API | Auto-detects Phenom-hosted careers sites and reads the public job-search API. Configure with `provider: phenom` for a branded custom domain. |
| Pinpoint | API | Auto-detects `<slug>.pinpointhq.com` boards and reads the public zero-auth `/postings.json` per-tenant feed. |
| Radancy (TalentBrew) | API | Auto-detects Radancy TalentBrew-hosted careers sites and reads the public job-search API. Configure with `provider: radancy` for a branded custom domain. |
| Recruitee | API | Auto-detects `<slug>.recruitee.com` boards and uses the public per-tenant offers API. |
| RemoteOK | API | Reads the board-wide `https://remoteok.com/api` JSON feed; scanner filters decide which rows are relevant. |
| Remotive | API | Reads the board-wide `https://remotive.com/api/remote-jobs` JSON feed, then applies local scanner filters. |
| Remotli | API | **operator: `eliador90`** (declared per [Source Indexing Policy](../CONTRIBUTING.md#source-indexing-policy) rule 4 — the board is operated by the contributor who submitted this provider). Reads the board-wide `https://remotli.ch/api/jobs` JSON feed (remote roles at Swiss companies, paid in CHF). Select with `provider: remotli`; paginates `?page=N&limit=50&remote=all` (the server caps `limit` at 50) up to `max_pages` (default 20). `remote=all` is required for rule 3: without it the API serves its remote-first default view, ~43% of the board. Rows are a nested `{ jobs, companies }` join shape. Emits only `status: active` postings; the emitted URL is the employer's own `applyUrl` per rule 2, with the remotli page as fallback. Carries `publishedAt`, salary and the full description (the latter feeds the cross-listing fingerprint). |
| Rheinmetall | Parser | Single-company provider for `rheinmetall.com` careers (SSR Nuxt vacancy list). Auto-detects the `rheinmetall.com` host. |
| Rippling | API | Auto-detects `https://ats.rippling.com/<slug>/jobs` careers pages and reads the public zero-auth board API (`api.rippling.com/platform/api/ats/v1/board/<slug>/jobs`). |
| SAP SuccessFactors (RMK) | Parser | Auto-detects `*.successfactors.(eu\|com)` / `jobs2web.com` hosts, or use `provider: successfactors` + `api:` for a branded RMK career site (e.g. `jobs.zf.com`); reads the public `/tile-search-results/?startrow=N` HTML fragment feed. |
| Senjob | Parser | Reads the Senegalese board `https://senjob.com/offres-d-emploi.php` (Dakar and the regions) — the project's first African source. Configure with `provider: senjob`; paginates `?page=N` (10 pages by default, raise with `max_pages` up to 50), merges the sticky rows the board repeats on every page, and reads title, place and the hidden ISO publication date. Employer names are absent from the listing rows, so `company` is left empty rather than guessed. `robots.txt` disallows candidate CVs and employer pages; this parser reads neither. If the FIRST listing page still contains postings but parses to none, the provider throws, so a markup change surfaces as a broken board instead of an empty one; a later page that parses to nothing simply ends the pagination. |
| SmartRecruiters | API | Auto-detects SmartRecruiters careers URLs, or uses `provider: smartrecruiters` (optionally with `api:` pointing at `careers.smartrecruiters.com/<slug>`) for branded custom domains. |
| softgarden | parser | The hosted job widgets at `https://{tenant}.softgarden.io/{lang}/widgets/jobs` (e.g. `renk-group.softgarden.io/de/widgets/jobs`), a Wicket page companies embed. Configure with `provider: softgarden`. |
| SolidJobs | API | Auto-detects `https://solid.jobs/public-api/offers/<division>` and reads the public offers API. |
| startup.ch | Parser | Swiss Startup Association job board (server-rendered ColdFusion page, all listings in one HTML response). Auto-detects a `careers_url` on the `startup.ch` host; primes a session cookie from the homepage and fails closed (throws) on the site's anti-bot error page instead of reporting zero jobs. |
| startup.ch | parser | The Swiss Startup Association job board. Server-rendered ColdFusion page; all current listings arrive in one HTML response, no JS board. Configure with `provider: startupch`. |
| Teamtailor | RSS | Auto-detects `<slug>.teamtailor.com` career sites and reads the public zero-auth `/jobs.rss` per-tenant feed. For a branded careers domain, set `provider: teamtailor` and it reads `/jobs.rss` off that host. Job links may point at a branded custom domain; location comes from the `tt:` city/country tags, falling back to `Remote` when a posting carries no `tt:city`/`tt:country` but its `remoteStatus` is remote (`fully` or `temporary`). |
| Tencent | API | Public `careers.tencent.com` JSON API, zero-token, no browser. Verified 2026-07: returns structured JSON with title, location, BG, category, JD text and last-update time. Configure with `provider: tencent`. |
| The Hub | API | Reads the board-wide `https://thehub.io/api/v2/jobsandfeatured` JSON feed (Nordic/EU startups). Configure with `provider: thehub`; paginates `?page=N` up to `max_pages` (default 3), then scanner filters apply. Every request also sends `countryCode` (default `EU`, override via a `thehub: { countryCode: ... }` config block) since the API scopes results to the caller's geo-IP when it's omitted. Set `thehub: { includeRemote: true }` to also run a separate `isRemote=true` pass and merge it in — the site's own "remote" filter is a distinct query mode, not combinable with `countryCode`. The v2 payload carries no publication date, so Hub postings have no `postedAt`: date filters (`--since`, `max_age_days`) never exclude them, and they sort last among dated results. |
| The Muse | API | Public zero-auth JSON feed: `https://www.themuse.com/api/public/jobs?page={n}`. Configure with `provider: themuse`. General-audience board — its own `category=` filter returns nothing, so a sequential unfiltered walk is the only option and Android yield is low. |
| TKMS | Parser | Single-company provider for thyssenkrupp Marine Systems careers (SSR vacancy list). Auto-detects the TKMS careers host. |
| VDAB | API | Flanders' public employment service. Hits the public `vindeenjob` search API directly — the same endpoint vdab.be's own frontend uses — so it runs in-process alongside the other JSON-API providers. Configure with `provider: vdab`. |
| We Work Remotely | RSS | Reads the public `https://weworkremotely.com/remote-jobs.rss` feed and parses it in-process. |
| Welcome to the Jungle | API | Queries WTTJ's public Algolia search index (`wttj_jobs_production_en`) — the same one the welcometothejungle.com jobs UI calls. The public app id + referer-locked client search key are fetched fresh from `https://www.welcometothejungle.com/api/env` on every run (they rotate), and every Algolia request sends a welcometothejungle.com Referer. The board is global, so an explicit `wttj: { queries: ["…"] }` config block is required (the provider throws without one); optional `max_hits` per query (default 100, cap 200). Salary attaches from `salary_yearly_minimum`/`salary_maximum`; ", Remote" is appended for fulltime-remote postings. Configure with `provider: wttj`. |
| Workable | Parser | Auto-detects `https://apply.workable.com/<slug>` and parses Workable's public markdown jobs feed. |
| Workday | API | Auto-detects Workday `myworkdayjobs.com` careers URLs (or an explicit `api:` override for a branded custom domain) and posts to the public CXS jobs endpoint. Hardened pagination: retries 429/5xx with backoff, honors `Retry-After`, and stops early past `--since` or when a tenant exposes no post date. |
| Working Nomads | API | Reads the board-wide `https://www.workingnomads.com/api/exposed_jobs/` JSON feed, then applies scanner filters. |
| Y Combinator (Work at a Startup) | parser | Reads the embedded Inertia.js JSON on the public, robots-permitted category listing pages (`https://www.workatastartup.com/jobs/l/<slug>`). Configure with `provider: workatastartup`. **Endpoint content-negotiates:** the default career-ops UA gets HTTP 406 until an `Accept: text/html` header is sent — not UA sniffing. YC has no mobile category, so Android yield measured zero on 2026-08-20. |
| Yourator | API | **operator: 友睿資訊股份有限公司 (Yourator)** — declared per [Source Indexing Policy](../CONTRIBUTING.md#source-indexing-policy) rule 4; the submitting contributor is not affiliated with the board (provenance: the operating entity is named on the site's own [privacy page](https://www.yourator.co/privacy)). Taiwanese job board for startup and digital roles (1,760 listings across 151 employers when sampled on 2026-08-18). Reads the board-wide zero-auth `https://www.yourator.co/api/v4/jobs?page=N` JSON feed (20/page; no key, cookie or `Referer` required). Select with `provider: yourator`. The API exposes no free-text search parameter — `q`/`keyword`/`search`/`term`/`query`/`title` are accepted and silently ignored — and no filter parameter is needed for full coverage, so the provider walks every page until `payload.hasMore` turns false and lets `title_filter` gate the results (rule 5); `max_pages` (default 120) is a safety bound above the observed 88 pages, not a coverage setting. Per rule 2 the emitted URL is each row's `thirdPartyUrl` — the employer's own ATS (teamdoor.io, Greenhouse, Lever, BambooHR, Breezy, self-hosted) — with the board's `utm_*` ad parameters stripped, falling back to the Yourator posting page on the 63.9% of rows that carry none. No absolute timestamp is published (only a relative `lastActiveAt` string), so `postedAt` is always omitted. |

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
