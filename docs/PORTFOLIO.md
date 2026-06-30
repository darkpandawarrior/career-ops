# Portfolio generator + the role-adaptive data model

HireSignal generates a personal portfolio **website** from a candidate's own
career-ops data — and it does so for **any role**, not just engineers. This doc
covers the feature and, more importantly, the **meta structure for drawing data**
that makes it role-agnostic. The same structure underpins the rest of the
dashboard, so it's the place to start when adding a feature that consumes a
candidate's data.

---

## 1. The meta structure: how the dashboard draws a candidate's data

Every per-candidate feature reads from a **single, layered, profile-scoped data
root** — never hardcoded, never another candidate's. The active root is resolved
once per request:

```
?profile=<slug> ──▶ src/proxy.ts ──▶ x-co-profile header ──▶ requestRoot()  ──▶  <data root>
                                                              (profile-registry.ts)
```

All readers take that `root` and read these layers (use whatever is present; never
assume a layer exists):

| Layer | File(s) under the root | What it is | Who fills it |
|-------|------------------------|------------|--------------|
| **Identity** | `config/profile.yml` | name, contact, links, target roles, location | user / onboarding |
| **Narrative** | `cv.md` | the CV — the primary source of history + impact | user |
| **Voice** | `modes/_profile.md` | personalization / tone notes | user / assistant |
| **Wins** | `coaching_state.md` *(or the shared interview-coach skill)* | the **storybank**: titled wins + their "earned secret" | interview-coach |
| **Proof** | `reports/*.md` | A–F evaluations, framing, proof points | the evaluator |
| **Pipeline** | `data/{pipeline,applications,scan-history}.*` | the job pipeline + tracker | scanners / the user |

The contract is **additive and tolerant**: a brand-new candidate may have only
`cv.md`; a deep user has all six layers. A feature reads what's there and degrades
gracefully. This is what lets the dashboard "transform for any role or user" — the
*structure* is fixed; the *content* is whatever that person's field produces.

`buildPortfolioContext(root)` (`web/src/lib/portfolio/context.ts`) is the reference
implementation: it assembles `cv` + a size-capped `extra` (profile, voice,
storybank, reports) for the AI, all from the one resolved root.

---

## 2. Role-agnostic by design

The portfolio's section labels are deliberately generic — they hold
role-appropriate substance, filled by the AI from the data:

| Section | Engineer | Designer | PM | Marketer | Researcher |
|---------|----------|----------|----|----------|------------|
| **metrics** | users, latency, crash-rate | adoption, conversion, NPS | revenue, retention | pipeline, CAC, reach | citations, accuracy |
| **caseStudies** | a shipped system | a redesign | a launch | a campaign | a study |
| **projects** | repos / OSS | dribbble / cases | side products | content | papers |
| **skills** | architecture, languages | research, tools, craft | discovery, delivery | channels, analytics | methods, domains |

The role-adaptation lives in the **mode** (`modes/portfolio.md`), which instructs the
AI to read the candidate's field and adapt emphasis. The **schema**
(`web/src/lib/portfolio/schema.ts`) is neutral; the **renderer** omits any empty
section, so a portfolio with no `projects` simply has no Projects section.

---

## 3. Pipeline (generate → render → ship)

```
cv.md + profile.yml + storybank + reports
        │  (buildPortfolioContext)
        ▼
  modes/portfolio.md  ──▶  user's AI CLI (read-only)  ──▶  PortfolioData JSON
        │  (coercePortfolio — safe, never throws)
        ▼
  renderPortfolio(data, theme)  ──▶  one self-contained, themeable HTML page
        │
        ├─ in-app preview (sandboxed iframe)   ── refine (chat) · analyze · version
        ├─ Export ZIP (HTML)                   ── drop on any static host
        └─ Export project / Save local copy    ── the FULL Vite app (with AI chat)
              (scaffold.ts → templates/portfolio-site/)
```

- **Themes** (`themes.ts`): a named palette + type pairing (midnight/aurora/ember/
  paper/mono). The renderer injects them as CSS variables; the data carries the key.
- **Versions** (`context.ts`): every generate/revise snapshots `versions/<stamp>.json`;
  `restore` makes one current, `finalize` bookmarks a "production" version that the
  page opens on by default — and that you keep iterating past.
- **Analyzer** (`analyze.ts`): the AI critiques the portfolio (score, strengths,
  gaps) and returns actionable suggestions that apply via the refine flow.
- **Full project** (`scaffold.ts` + `templates/portfolio-site/`): a genericized
  Vite + React + Tailwind app (with a serverless AI chat) is bundled in the repo;
  the serializer turns `PortfolioData` into a compilable `src/data/profile.ts`, a
  data-driven chat persona, and a filled `index.html`. `Export project` zips it;
  `Save local copy` writes it under the (gitignored) `.career-ops-web/portfolio/`.
- **Import** (`import.ts` + `POST /api/portfolio/import`): the inverse of the
  serializer. A candidate who already maintains a portfolio-site (the same
  `src/data/profile.ts` export surface this feature emits, e.g. a `cv-*` reference
  site) can pull it into the dashboard **verbatim — no AI, no tokens, no
  approximation**. `profileModuleToPortfolio()` maps the module's exports back into
  `PortfolioData`; the route coerces, snapshots a version, and can `finalize: true`
  to bookmark it as production in one call (the right move when the imported site is
  already live). This is the path to "populate from my real site"; generation is for
  candidates who don't have one yet.

## 4. Privacy

Per-candidate. Drafts, versions, and the local project copy live under
`<root>/.career-ops-web/portfolio/` (gitignored — never committed). Generated HTML
is AI output → rendered ONLY in a sandboxed iframe, never injected into the app DOM.
The bundled template carries no candidate identity; everything personal is injected
at generate time and stays local.

## 5. Code map (`web/src/lib/portfolio/`)

| File | Responsibility |
|------|----------------|
| `schema.ts` | `PortfolioData` type + tolerant `coercePortfolio` + JSON extraction |
| `themes.ts` | named themes (palette + fonts) |
| `render.ts` | pure `renderPortfolio(data)` → self-contained themed HTML |
| `context.ts` | per-profile read/write, versions, restore/finalize, local copy |
| `analyze.ts` | analyzer output contract + coercion |
| `scaffold.ts` | `PortfolioData` → the full Vite project files |
| `zip.ts` | dependency-free STORE zip writer |

API routes: `web/src/app/api/portfolio/{route,generate,export,version,analyze,theme,save-local}`.
UI: `web/src/app/portfolio/page.tsx` + `web/src/components/portfolio/*`.
