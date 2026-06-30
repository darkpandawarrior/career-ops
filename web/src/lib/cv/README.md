# lib/cv

CV ingest + quality helpers. Two pure, client-safe functions: a **zero-token**
"is this CV good enough to score?" signal, and a tolerant parser for the streamed
CV-ingest envelope (markdown + seed + error).

| File | Responsibility |
|------|----------------|
| `quality.ts` | `cvReadiness(md)` → deterministic `{ scoreable, words, hasExperience, hasSkills, hint? }` (advisory, never blocks save); `parseCvStream(buf)` → splits an accumulated ingest buffer into `{ markdown, seed, error, trace }` |
| `quality.test.ts` | exhaustive Vitest coverage of both — word counting, EN+ES heading/year-range detection, the 80/200-word `scoreable` thresholds, hint branches, and every `parseCvStream` path (error, start/end, partial stream, seed) |

**What `cvReadiness` decides**
- `scoreable` = `words >= 80 && (hasExperience || hasSkills || words >= 200)`.
- `hasExperience` matches an `experience/work/employment` heading (EN) or `experiencia/empleo` (ES), **or** a `20xx–20xx/present/now` year range (no heading needed). `hasSkills` matches a `skills/technologies/competenc` / `habilidad` heading.
- When not scoreable, `hint` is "very short" (`< 40` words) or "looks thin" — both end with "(you can save anyway)".

**The ingest stream markers** (parallel to the `<<act:>>` / `<<offer:>>` envelopes)
- `<<cv:start>> … <<cv:end>>` wraps the extracted markdown; `<<cv:seed>> {…}` carries a `{ title, roles, location }` seed; `<<cv:error>> {"reason":…}` signals an unreadable file.
- `trace` is whatever preceded the first marker (the model's pre-extraction thinking).

**Conventions**
- **Pure + deterministic + client-safe** (no node imports) → unit-testable and runnable in the browser; spends **zero tokens**.
- **Advisory only** — `cvReadiness` drives a green-check vs amber hint and **never blocks saving** (minimal-CV principle: even a rough parse scores).
- **Tolerant by design** — `parseCvStream` handles a still-streaming buffer (start, no end → partial markdown); malformed seed/error JSON is swallowed (seed → null, error → `"unreadable"`); the error path takes precedence over markdown.
- Roles in a seed are string-filtered and capped at 6.

Tests live next to the source (`quality.test.ts`).
