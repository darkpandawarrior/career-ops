# Liveness Bot-Block Classification Policy

**Status:** design + minimal implementation (additive, non-breaking)
**Owner:** liveness stack (`liveness-core.mjs`, `liveness-api.mjs`, `liveness-browser.mjs`, `check-liveness.mjs`, `scan.mjs --verify`)
**Problem:** Some job boards block bots/AI. A bot-blocked **live** posting must never be recorded as `expired` (the user silently loses a real job), and a genuinely **dead** posting must not be parked forever as merely "unverifiable" (the pipeline rots).

---

## 1. Current behaviour (as-built, mapped from source)

### 1.1 The two-rung ladder

`check-liveness.mjs` and `scan.mjs --verify` both classify a URL with the same logic:

1. **Rung 1 — ATS API (`liveness-api.mjs`, zero-token, no browser).** Only Greenhouse and Lever are wired. Returns:
   - `active` on HTTP 200, `expired` on 404/410.
   - `null` (→ fall through to browser) on **anything ambiguous**: unknown ATS, redirect, 429/5xx, network/timeout. Deliberately conservative — a false `expired` is the worst outcome.
2. **Rung 2 — Playwright (`liveness-browser.mjs` → `classifyLiveness` in `liveness-core.mjs`).** Loads the page with a real desktop-Chrome UA, waits for hydration, scrapes body text + visible apply controls, then classifies. On a bot-challenge/`403`/`503` result it can retry once in a **headed** browser (`checkUrlLivenessWithFallback`), which clears JS/Cloudflare walls. A headed retry that is still blocked stays blocked — **never upgraded to expired**.

### 1.2 The status taxonomy actually emitted today

`classifyLiveness` returns exactly **three** `result` values, each with a stable `code`:

| `result` | `code` | Trigger | Routing in `scan --verify` |
|----------|--------|---------|----------------------------|
| `expired` | `http_gone` | HTTP 404 / 410 | → `skipped_expired`, dropped from pipeline |
| `expired` | `expired_url` | redirect to `?error=true` | → `skipped_expired` |
| `expired` | `expired_body` | "no longer accepting", "position filled", … | → `skipped_expired` |
| `expired` | `listing_page` | "N jobs found" (bounced to search) | → `skipped_expired` |
| `expired` | `insufficient_content` | body < 300 chars (nav/footer only) | → `skipped_expired` |
| `active` | `apply_control_visible` | visible Apply/Aplikuj/Bewerben control | → kept, written to pipeline |
| **`uncertain`** | **`bot_challenge`** | Cloudflare "Just a moment", hCaptcha, Ray ID | → **`verified`** bucket (kept, retried next scan) |
| **`uncertain`** | **`access_blocked`** | HTTP 403 / 503 | → **`verified`** bucket (kept, retried next scan) |
| `uncertain` | `no_apply_control` | body present, no apply control | → `skipped_no_apply_control`, dropped |
| `uncertain` | `navigation_error` | timeout / DNS / TLS / 5xx | → `verified` bucket (transient, retried) |
| `uncertain` | `invalid_url` / `unsupported_protocol` / `blocked_host` | up-front SSRF/format guard | → `skipped_invalid_url` / `skipped_blocked_host` |

**Where bot-blocked URLs fall today:** into `result: 'uncertain'` with code `bot_challenge` or `access_blocked`. `scan --verify` routes those into the **`verified`** passthrough bucket (the `else` branch, alongside `navigation_error`). That is *correct on the safety axis* — they are **never** written to `scan-history` as expired, so a blocked-but-live posting is preserved. **But there are two real gaps:**

- **Gap A — no durable "blocked" record.** A bot-blocked URL is treated identically to a transient timeout: kept, retried every scan, forever. There is no signal that distinguishes "this domain *structurally* blocks us" from "this load happened to time out". It will be re-Playwright-checked on every scan with the same result, burning verify cycles indefinitely.
- **Gap B — no decay.** An `uncertain`/blocked URL that is *actually* dead (the posting closed behind the wall) stays in the pipeline forever, because nothing ever downgrades a long-unverifiable URL.

### 1.3 The `scan-history.tsv` status vocabulary (already in the wild)

Distinct `status` values currently present in `data/scan-history.tsv`:

```
added  skipped_expired  skipped_dup  skipped_location  skipped_unverifiable
skipped_title  skipped_marketplace  skipped_comp  skipped_stale  skipped_staffing
skipped_filtered  skipped_junior  discarded_crossplatform
```

Key finding: **`skipped_unverifiable` (38 rows, all instahyre) and `skipped_stale` (3 rows, all naukri) already exist in the data, but NO `.mjs` writes them today.** They were produced by an earlier or manual classification pass. The live code only ever emits `skipped_expired`, `skipped_no_apply_control`, `skipped_invalid_url`, `skipped_blocked_host`. This policy **adopts and formalises** `skipped_unverifiable` (for blocked) and introduces `skipped_probable_expired` (for decayed) so the vocabulary the data already uses becomes the vocabulary the code writes.

### 1.4 Dedup interaction (`loadSeenUrls` / `shouldDedupScanHistoryRow`)

- `PERMANENT_SCAN_HISTORY_STATUSES = { skipped_invalid_url, skipped_blocked_host }` — these dedup-block forever.
- Any status **other than `added`** → dedup-blocked (won't be re-surfaced). So `skipped_expired` and `skipped_no_apply_control` permanently suppress a URL.
- `added` rows can be re-surfaced after `scan_history.recheck_after_days` (the existing soft-recheck knob).

This is the lever the decay heuristic plugs into.

---

## 2. The core analytical problem: 403/login-wall ≠ dead

The classifier's job is to keep **"blocked"** and **"dead"** in separate buckets. They are distinguishable by signature:

| Domain | Check today | Block signature | Distinguishable from real death? |
|--------|-------------|-----------------|----------------------------------|
| **linkedin.com** | Playwright cold | 302/login redirect to `/login` or `/authwall`; `?trk=` params; "Sign in to view"; HTTP 999 (LinkedIn's bespoke bot status) | **Yes.** A dead LI posting shows "No longer accepting applications" *in the page body* even cold, OR the job-view returns a "This job is no longer available" card. A login redirect / 999 is an auth wall, not death. |
| **naukri.com** | Apify actor (scan); Playwright (verify) | Anti-bot interstitial, JS challenge, sometimes 403; sparse body | **Yes.** Real death = "This job has expired" banner served even to bots; anti-bot = challenge body / 403 with no expiry banner. |
| **foundit.in** | Playwright cold | **HTTP 403** to all automated checks (hard anti-bot) | **Mostly no, cold.** 403 is indistinguishable from death without a successful load. Must be treated as blocked, never expired. Only a headed/authenticated load can disambiguate. |
| **instahyre.com** | Google-indexed URL → Playwright | Login wall on job detail; high genuine dead-rate (~80% "no longer accepting" observed 2026-06-11) | **Partially.** When the wall is down, "no longer accepting applications" is a real `expired_body` match. When login-walled, body is sparse → currently risks `insufficient_content` → false expired. |
| **cutshort.io** | Playwright cold | Listing renders *without* the opening (login-gated); SPA shell | **No, cold.** A login-gated shell and a removed posting both render an empty/listing shell. Must be `blocked`/`unverifiable`, verified logged-in. |

**The trap:** four of these (foundit 403, instahyre/cutshort login-wall, naukri challenge) can produce a **short or empty body with no apply control**, which the generic classifier would route to `insufficient_content` (→ `expired`) or `no_apply_control` (→ dropped). The existing `bot_challenge`/`access_blocked` guards catch the *Cloudflare-style* walls, but **not** silent login redirects that return HTTP 200 with a thin SPA shell. That is the precise failure mode this policy closes: **a per-domain block-signature map that fires before the generic content heuristics.**

### 2.1 Decision tree (precedence order — first match wins)

```
classify(url, status, finalUrl, bodyText, applyControls):

  0. SSRF/format guard fails?            → blocked      (invalid_url / blocked_host)      [unchanged]
  1. status ∈ {404, 410}?                → dead         (http_gone)                        [unchanged]
  2. PER-DOMAIN block signature matches? → blocked      (domain_block:<domain>)            [NEW, fires early]
       e.g. linkedin authwall/999, foundit 403, instahyre|cutshort login redirect
  3. Cloudflare/hCaptcha body pattern?   → blocked      (bot_challenge)                    [was uncertain]
  4. status ∈ {403, 503}?                → blocked      (access_blocked)                   [was uncertain]
  5. finalUrl has ?error=true?           → dead         (expired_url)                      [unchanged]
  6. HARD_EXPIRED body pattern?          → dead         (expired_body)                     [unchanged]
       ("no longer accepting", "position filled", …) — fires even on blocked domains,
        because an explicit expiry banner is authoritative regardless of domain.
  7. visible apply control?              → live         (apply_control_visible)            [unchanged]
  8. listing-page pattern ("N jobs")?    → dead         (listing_page)                     [unchanged]
  9. body < 300 chars?                   → unverifiable (insufficient_content) IF domain is
                                           block-prone, else dead.                          [REFINED]
 10. else                               → unverifiable (no_apply_control)                  [was uncertain]
```

Two deliberate ordering choices:

- **Step 2 before steps 3–9** so a login-wall that returns HTTP 200 + thin body (instahyre/cutshort) is caught as `blocked` before the `insufficient_content` heuristic can mislabel it `dead`.
- **Step 6 (hard-expired body) is allowed to override a block-prone domain.** If foundit/instahyre actually renders "no longer accepting applications", that banner is authoritative — it is `dead`, not `blocked`. Only the *absence* of a positive signal on a block-prone domain yields `blocked`/`unverifiable`.

---

## 3. The policy

### 3.1 Taxonomy — four buckets, defined by signal

The wire format keeps the existing `result ∈ {active, expired, uncertain}` and `code` (so all current tests and `scan --verify` routing keep working), and adds **one additive field `bucket ∈ {live, dead, blocked, unverifiable}`** — the policy-level classification. Mapping:

| `bucket` | Meaning (signal) | Maps from `result`/`code` | scan-history status | Pipeline action |
|----------|------------------|---------------------------|---------------------|-----------------|
| **`live`** | Positive proof of an open posting (apply control, ATS API 200) | `active` | `added` | keep / surface |
| **`dead`** | Positive proof of closure (404/410, expiry banner, `?error=true`, listing bounce) | `expired` | `skipped_expired` | drop, dedup-block |
| **`blocked`** | Positive proof we were *prevented* from seeing the page (per-domain wall, Cloudflare, 403/503). **Says nothing about liveness.** | `uncertain` + `bot_challenge`/`access_blocked`/`domain_block:*` | `skipped_unverifiable` *(only after decay; see §3.4)* | keep, retry; never drop on block alone |
| **`unverifiable`** | We loaded the page but couldn't get a definitive signal (no apply control, thin body on a block-prone domain, transient nav error) | `uncertain` + `no_apply_control`/`insufficient_content`/`navigation_error` | none while fresh; `skipped_probable_expired` after decay | keep, retry; decay over time |

`live` and `dead` are **terminal** (they have proof). `blocked` and `unverifiable` are **provisional** — they're the only buckets the decay heuristic acts on.

### 3.2 Per-domain handling map

Exported from `liveness-core.mjs` as `DOMAIN_LIVENESS`. Each entry: `{ checkMethod, blockedSignature, treatBlockedAs }`.

| Domain | `checkMethod` | `blockedSignature` (any match ⇒ blocked) | `treatBlockedAs` |
|--------|---------------|------------------------------------------|------------------|
| `linkedin.com` | `authed-session` (logged-in Browser 2) else cold | finalUrl `/login` or `/authwall`; HTTP 999; body "sign in to view"/"join linkedin to" | `blocked` |
| `naukri.com` | `apify` (scan) / `headless` (verify) | 403; challenge body; body < 300 with no expiry banner | `blocked` |
| `foundit.in` | `headed` | **HTTP 403 (always)**; "access denied" | `blocked` |
| `instahyre.com` | `headless` then `authed-session` | finalUrl `/login`; "log in to apply"; thin SPA shell | `blocked` (but `expired_body` banner wins → `dead`) |
| `cutshort.io` | `authed-session` | login redirect; SPA shell with no posting card | `blocked` |
| *(default)* | `api` → `headless` → `headed` | Cloudflare/hCaptcha body; 403/503 | `blocked` |

`treatBlockedAs` is always `blocked` (never `dead`) — the map's job is to *recognise* the wall, not to guess liveness behind it. Liveness behind a wall is resolved by escalation (§3.3) or decay (§3.4).

### 3.3 Retry / escalation ladder

For one URL, in order, stopping at the first **terminal** (`live`/`dead`) result:

```
1. ATS-API           (liveness-api.mjs)      zero-token, no browser.
                     Stop if live/dead. Greenhouse+Lever only today.
2. Headless Playwright (real desktop UA)      default rung.
                     Stop if live/dead. If blocked/unverifiable → escalate.
3. Headed Playwright  (--headed-fallback)      clears JS/Cloudflare walls.
                     Stop if live/dead. Opt-in (needs a display).
4. Authed session     (LinkedIn/instahyre/cutshort, Browser 2)  MANUAL/opt-in only.
                     Only rung that can see behind a login wall.
```

**When to stop escalating:**
- Stop immediately on any `live` or `dead` (terminal — we have proof).
- Stop after **rung 2** in the default automated path. Rungs 3–4 are **opt-in** and gated:
  - **Rung 3** only with `--headed-fallback` (requires a display; auto-degrades to the headless result in CI).
  - **Rung 4 is never automatic.** `modes/discover.md` forbids automated authenticated/walled scraping and evasion. Authed-session checks are a **human-in-the-loop** lane: the policy *flags* `blocked` LinkedIn/instahyre/cutshort URLs for manual review in the logged-in Browser 2 session; it does not script the login. This keeps the tool compliant while still giving the user a path to disambiguate.
- A URL that exhausts the *available* rungs and is still `blocked`/`unverifiable` is **kept** (retried next scan) and enters the decay clock (§3.4).

### 3.4 Soft-expiry decay heuristic

**Goal:** a `blocked`/`unverifiable` URL that we've never been able to confirm, and that no other signal corroborates, should eventually stop cluttering the pipeline — **without ever being hard-deleted or hard-marked expired** (it might still be live behind the wall).

**Chosen N = 21 days.** Rationale: the dominant block-prone source is instahyre, observed at ~80% genuine dead-rate; most real Indian-market postings close within 2–4 weeks. 21 days is long enough that a still-open posting has had multiple verify attempts (daily/3×-daily scans → 60+ checks) and short enough that dead postings don't linger a full month. It sits comfortably above the existing `recheck_after_days` soft-recheck window so the two don't fight.

**Bucket name: `skipped_probable_expired`** (new) — distinct from `skipped_expired` (proof of death) and from `skipped_unverifiable` (currently-blocked, still being retried). The name encodes the epistemics: *probabilistic*, not confirmed.

**Rule (pure function, no deletion):**

```
decayBucketFor(firstSeen, today, { bucket, corroborated }):
  if bucket ∉ {blocked, unverifiable}      → null   (only provisional buckets decay)
  if corroborated                          → null   (a later scan re-surfaced it / it appears live elsewhere)
  if ageDays(firstSeen, today) < 21        → null   (still fresh — keep retrying)
  else                                     → 'skipped_probable_expired'
```

- **Never hard-deleted.** The row stays in `scan-history.tsv`; only its `status` changes to `skipped_probable_expired`, which dedup-blocks it from the pipeline (like any non-`added` status) but leaves a full audit trail. A human (or a future authed-session pass) can resurrect it.
- **`corroborated`** is the escape hatch: if the same opening is independently re-seen (e.g. surfaces on a *different* portal that *is* checkable, or an ATS-API confirms it live), decay is cancelled.
- **Integration with existing vocabulary:** `skipped_unverifiable` becomes the *fresh* blocked state (age < N), `skipped_probable_expired` the *decayed* state (age ≥ N). Both dedup-block; neither deletes. This formalises the `skipped_unverifiable` rows already in the TSV.

### 3.5 LinkedIn liveness via the logged-in session vs cold

- **Cold (default automated):** a LinkedIn job URL hitting an authwall / HTTP 999 / "sign in to view" → `blocked` (`domain_block:linkedin.com`). **Never** `dead`. Only a cold response that shows "no longer accepting applications" / "this job is no longer available" *in the body* is `dead`.
- **Authed (Browser 2, manual/opt-in):** LinkedIn exposes a stable numeric **job ID** in the URL (`/jobs/view/<id>/`). In the logged-in Browser 2 Chrome session, `/jobs/view/<id>` for a closed posting renders an explicit **"No longer accepting applications"** state, and a removed posting 404s — both authoritative. So the authed lane turns LinkedIn `blocked` → terminal `live`/`dead`. Because of the `discover.md` no-auth-scraping rule, this is surfaced as a **manual review queue** ("N LinkedIn URLs need a logged-in check"), not an automated scraper. The job ID is the dedup/corroboration key so the same posting seen cold and authed reconciles to one row.

---

## 4. Implementation

### 4.1 What was implemented (minimal, additive, non-breaking)

`liveness-core.mjs` only. The change is purely additive — `classifyLiveness` keeps its exact `result`/`code` outputs (every existing test in `test-all.mjs` asserts only `.result` and `.code`), and gains:

1. An exported **`DOMAIN_LIVENESS`** per-domain map (§3.2).
2. An exported **`bucketFor(result, code)`** that maps the legacy `result`/`code` to the four-bucket taxonomy.
3. An additive **`bucket`** field on every `classifyLiveness` return.
4. An exported **`classifyLivenessForUrl({ url, ... })`** wrapper that runs the per-domain block-signature check *before* the generic content heuristics (decision-tree step 2), so a login-walled HTTP-200 thin shell on instahyre/cutshort/linkedin is caught as `blocked` instead of leaking to `insufficient_content`/`no_apply_control`. Callers that pass a URL get the per-domain protection; callers that don't (existing tests) hit the unchanged generic path.
5. An exported pure **`decayBucketFor(...)`** implementing §3.4 (no I/O, no deletion).

This is self-contained: no caller is *required* to change, so `scan --verify` and `check-liveness.mjs` keep working unchanged, while the new exports are available for the wiring in §4.2.

### 4.2 Proposed (not yet wired) — `scan.mjs` routing

These touch the verify routing / dedup and are left as a **proposed patch** to keep the change reversible and test-safe. Wire after a focused test pass.

**(a) Emit `skipped_unverifiable` for durable blocks.** Today blocked URLs fall into the `verified` passthrough (retried forever, Gap A). Add a `blocked` bucket to `verifyOffers` and record it:

```diff
@@ verifyOffers buckets
   const verified = [];
   const expired = [];
   const dropped = [];
   const invalid = [];
   const migrated = [];
+  const blocked = [];   // domain_block / bot_challenge / access_blocked — kept, but recorded
@@ routing, after the GUARD_CODES branch
-      } else {
-        // 'active' or 'uncertain' due to navigation_error (transient — retry next scan)
-        verified.push(offer);
+      } else if (result === 'uncertain' && BLOCK_CODES.has(code)) {
+        // Bot-blocked but NOT dead. Keep in pipeline AND stamp scan-history as
+        // skipped_unverifiable so we can age it for decay (§3.4) instead of
+        // re-Playwright-checking a structurally-walled domain every scan.
+        blocked.push({ ...offer, code, reason });
+        console.log(`  🚧 blocked   ${offer.company} | ${offer.title} (${reason})`);
+      } else {
+        // 'active' or transient navigation_error (retry next scan)
+        verified.push(offer);
@@ return
-  return { verified, expired, dropped, invalid, migrated };
+  return { verified, expired, dropped, invalid, migrated, blocked };
```

```diff
@@ codes
+// Bot-block codes: the page exists but we were prevented from reading it.
+// Distinct from navigation_error (transient) — these recur on every scan,
+// so we record them rather than silently retrying forever.
+const BLOCK_CODES = new Set(['bot_challenge', 'access_blocked']); // + domain_block:* via prefix check
```

```diff
@@ main(), after the droppedOffers write
+  // Bot-blocked-but-live: keep in pipeline, but stamp scan-history so the decay
+  // pass (§3.4) can age them. NEVER recorded as skipped_expired.
+  if (!dryRun && blockedOffers.length > 0) {
+    appendToScanHistory(blockedOffers, date, 'skipped_unverifiable');
+  }
```

**(b) Decay pass.** A standalone maintenance step (new `decay-liveness.mjs`, or a flag on `scan`) that re-reads `scan-history.tsv`, applies `decayBucketFor`, and rewrites `skipped_unverifiable` rows older than 21 days (and uncorroborated) to `skipped_probable_expired`. Pure rewrite of the `status` column — no row deletion:

```diff
+import { decayBucketFor } from './liveness-core.mjs';
+// for each scan-history row with status skipped_unverifiable:
+const next = decayBucketFor(firstSeen, today, { bucket: 'blocked', corroborated: isCorroborated(url) });
+if (next) row.status = next;   // skipped_unverifiable → skipped_probable_expired
```

**(c) Dedup.** No change required: `skipped_unverifiable` and `skipped_probable_expired` are both non-`added`, so `shouldDedupScanHistoryRow` already dedup-blocks them. Do **not** add them to `PERMANENT_SCAN_HISTORY_STATUSES` — that set is for *malformed* URLs that can never become valid; a blocked URL can become live again, so it must stay re-checkable if the user clears the status manually.

---

## 5. Risks flagged

- **R1 — instahyre thin-shell false-dead (highest value).** The single biggest current bug: instahyre/cutshort login walls return HTTP 200 + a thin SPA body, which the generic classifier sends to `insufficient_content → expired`. The per-domain map (step 2 before step 9) fixes this **only for callers that pass the URL** into `classifyLivenessForUrl`. Until `liveness-browser.mjs` is switched to call the URL-aware wrapper (a one-line change, listed as proposed in §4.2), the protection is dormant for the `scan --verify` path. **This is the wiring to prioritise.**
- **R2 — `domain_block` codes and `BLOCK_CODES`.** The proposed `BLOCK_CODES` set must also match the `domain_block:<domain>` prefix, not just the two literals — use a prefix check, not `Set.has`, or blocked-domain hits leak back into the `verified` passthrough.
- **R3 — N=21 is a heuristic, not a measurement.** It's tuned to instahyre's observed ~80% dead-rate and Indian-market posting lifespans. If the portal mix shifts (more EU ATS, longer-lived postings), revisit. Because decay never deletes, the cost of N being slightly wrong is bounded (a still-live posting is recoverable by clearing the status).
- **R4 — corroboration source.** `decayBucketFor` takes `corroborated` as an input; computing it (same opening seen live elsewhere / via ATS-API) is not yet implemented. Until then, pass `corroborated: false` and rely purely on age — safe, just slightly more aggressive decay.
- **R5 — compliance boundary.** Rung 4 (authed-session) must remain manual. Automating LinkedIn/instahyre login scraping would violate `modes/discover.md`. The policy deliberately makes the authed lane a human review queue keyed on the LinkedIn job ID.
