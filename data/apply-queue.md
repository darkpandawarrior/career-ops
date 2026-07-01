# Apply Queue — 2026-07-01

Built from a full liveness sweep of the (post-cleanup) pipeline board. Locations are pulled from
scan-history.tsv (recorded at scan time), not re-fetched. All URLs below are confirmed **live**
via `board-sweep.mjs --browser` on 2026-07-01.

## Tier 1 — Apply this week (India-based, clears all gates)

| Company | Role | Location | Why he wins | URL |
|---|---|---|---|---|
| Okta | Principal SWE — Android Device Authenticators | Bengaluru | Direct hit on his deepest area: SQLCipher+Keystore AES-256, BiometricPrompt+CryptoObject, VAPT. Okta *is* an auth/security company — lead with the security narrative, not just Android generalist. | https://www.okta.com/company/careers/opportunity/8007066?gh_jid=8007066 |
| Okta | Staff SWE — Android Device Authenticators | Bengaluru | Same team, one level down — apply to whichever band the JD confirms; don't apply to both without checking they're not the same req. | https://www.okta.com/company/careers/opportunity/8007082?gh_jid=8007082 |
| Verifone | Senior SWE (Android) | Bengaluru, Karnataka | Payments/POS = fintech + security overlap (SQLCipher, SSL pinning, PCI-adjacent hardening). Strong domain match. | https://ats.comparably.com/api/v2/verifone/post/7782998003?gh_jid=7782998003 |
| Meesho | Architect — Android | Bangalore, Karnataka | Architect band = stretch above current title but justified by the platform-owner story (50k MAU/22k DAU sole ownership at Dice). Major India e-commerce scale. | https://jobs.lever.co/meesho/040a5a75-28d2-4b56-904b-071c41d4ea90 |
| ThoughtWorks | Lead Mobile Developer (Android) | Mumbai, India | Lead-titled — direct target-level match. **Verify comp before investing time**: prior ThoughtWorks-style services cos (Ciklum, Smart Working) scored well technically but landed below his ₹35L floor. | https://androiddev.careers/lead-mobile-developer-android-at-thoughtworksreferral-1672 |
| StockX | Software Engineer — Android | Bangalore, India | Global marketplace scale, India team. Generic title — verify seniority band in the JD before applying. | https://job-boards.greenhouse.io/stockx/jobs/8603905002 |
| ShareChat | Android SDE-2 | Bengaluru | Major India social/content platform. SDE-2 title is a half-step below his target level — verify the actual band/comp in the JD (title inflation/deflation is common). | https://peerlist.io/company/sharechat/careers/android-sde2/jobh8o98g6rbgq8poh7eqkejngqemp |
| Kyndryl | Banking Mobile App Developer | Bangalore, Karnataka | IBM-spinoff IT services, banking client work. **Comp-floor risk** — IT-services bands often land below ₹35L; verify before applying. | https://kyndryl.wd5.myworkdayjobs.com/kyndrylprofessionalcareers/job/Bangalore-Karnataka-India/Banking-Mobile-App-developer_R-60603 |

## Tier 2 — Foreign remote, sponsorship unconfirmed (verify before investing time)

"Remote-USA"/"Remote-Canada" postings almost never sponsor overseas hires by default — these are
long shots unless the JD explicitly states visa sponsorship. Ranked by fit despite the location risk.

| Company | Role | Location | Note | URL |
|---|---|---|---|---|
| Life360 | Senior SWE II, AI-Native, Mobile | Remote, USA/Canada | Strong **domain** overlap — location-safety app, directly adjacent to his sensor-fusion/GPS accuracy work (50%→95%). Worth a shot if they sponsor. | https://job-boards.greenhouse.io/life360/jobs/8603101002 |
| Upstart | Principal Mobile Engineer, Android | US Remote | Fintech lending, Principal band — strong security/fintech fit, but US-only remote. | https://careers.upstart.com/jobs?gh_jid=8021094 |
| iHerb | Principal Engineer — Mobile | US Remote/Home Office | Principal band, large e-commerce. US-only. | https://job-boards.greenhouse.io/iherb/jobs/7779171003 |
| OXIO | Senior Mobile Core Architect | "Remote" (unqualified — verify region) | Telecom-as-a-service, LatAm-founded. Region not confirmed as US-only — worth checking if India-eligible. | https://jobs.ashbyhq.com/oxio/3a08aaf2-7385-4881-9f4f-734a73cb8e55 |
| OXIO | Mobile Telecom Support Engineer | "Remote" (unqualified) | Lower-band support role, same company. | https://jobs.ashbyhq.com/oxio/0227f8fd-8cd7-4a3e-bec1-9ca5e992544b |
| Tilthq | Senior Mobile Engineer, Thrive | Remote - US | US-only. | https://jobs.ashbyhq.com/tilthq/137661ca-a976-4139-b6f1-38349ed808be |
| Zillow | Senior AI-Native Product Engineer, Mobile | Remote-USA | US-only, large real-estate co. | https://zillow.wd5.myworkdayjobs.com/zillow_group_external/job/Remote-USA/Senior-AI-Native-Product-Engineer--Mobile_P750290-2 |
| LILT | Android Application Engineer | US cities only (DC/Boston/NY/SF/Indianapolis) | No remote/India option listed — likely relocation-only. Low priority. | https://jobs.ashbyhq.com/lilt-corporate/55971c15-9633-482e-92f2-b80dffa4f256 |

## Dropped this pass

- **41 off-topic false positives** purged from the board (T-Mobile retail clerks, Cox vehicle
  inspectors/mechanics, PM/PO/Program Manager titles, MAUI/Xamarin, marketing directors, etc.) —
  see `data/scan-history.tsv` (`skipped_offtopic`).
- **11 confirmed-dead postings** closed (JioStar ×1, Capco, fi, Rakuten Intl, Safe Security,
  Bureau, Juspay, Gojek-logistic, Myntra, Nykaa ×2, Zerodha, Dream11).
- **4 Speechify Tech-Lead variants** closed — already rejected on this exact track, do not re-apply.
- **1 mislabeled internship** (Renault French Bac+5 embedded-Android thesis) closed as off-topic.
- **Goodsservices** (Lead Android Engineer, Mexico/US-remote) and **College Board** ("Lead Engineer,
  Secure Client Engineering", Remote-USA — not clearly an Android role, likely a title-filter
  false-positive) — left open on the board but excluded from both tiers: weak location + weak
  title fit.

## Not yet verified

- **~47 items still "uncertain"** (LinkedIn, Naukri, Instahyre, aggregators) — blocked by anti-bot/
  auth walls, correctly *not* marked dead (see `docs/liveness-bot-block-policy.md`). These need the
  authenticated LinkedIn browser session (Browser 2) to verify — pending Siddharth's availability.
- **6 Workday "insufficient content" flags** (taxwell, kyndryl-2nd-variant, collegeboard-2nd-variant,
  gehc, ttc) were **not** marked dead despite the tool's signal — Workday is a heavy client-rendered
  SPA and this looks like the same false-dead pattern found on instahyre (thin shell before
  hydration completes). Left open, flagged for manual/browser re-check.
