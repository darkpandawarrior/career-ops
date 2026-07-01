# lib/apply

The agentic **apply** flow: open a candidate's chosen job-application URL in a real
headed Chrome, read the form's structure, pre-fill it with verified answers, and hand
the live (un-submitted) form to the human to review and submit. It NEVER submits.

| File | Responsibility |
|------|----------------|
| `extract.ts` | pure DOM/a11y form introspection: read every control's label/type/options and tag each with a stable `data-co-field` id on the live page (`extractForm`) |
| `greenhouse.ts` | pure: `parseGreenhouse(url)` + `fetchGreenhouseSchema()` — enrich extraction with Greenhouse's public question schema (real labels/types/options for its react-select fields) |
| `issue.ts` | pure client-safe types only (no playwright): `ApplyIssue` (block/warn/info) + `DriveStep` |
| `remember.ts` | pure `isRememberable(field, value)` — should this answer be offered as a reusable fact for future applications? (excludes identity/consent/EEO/long essays) |
| `cv.ts` | pure: `resolveTailoredCv(root, company)` (strict company match → newest CV PDF in `<root>/output/`, else null) + `companyFromTitle()` |
| `diagnose.ts` | mostly-pure block/obstacle detection + recovery: `statusBlock` (pure), and browser helpers `dismissConsent`, `dropNewTabs`, `tryApplyTrigger`, `classifyEmpty`, `captchaWarning`, `multiStepInfo`, `verifyFill` (read the real form back after fill) |
| `agent-interpret.ts` | **browser-automation** AI fallback: snapshot every live control as text, spawn the planner CLI (Claude) to classify them into clean fields, re-tag the chosen controls (`agentInterpretForm`) |
| `drive.ts` | **browser-automation** agentic drive loop: observe → LLM picks ONE action → we execute it on our session → repeat, to *reach* (hybrid) or *fill* (full) the form (`driveSession`) |
| `session.ts` | **browser-automation** orchestrator: launches/owns the headed Chrome, runs the full open→extract→enrich→fill→handoff pipeline, keeps in-memory sessions (`openSession`, `fillSession`, `handoffSession`, `closeSession`, `finalizeDrivenSession`) |

**Conventions**
- **Pure vs browser:** `extract`/`greenhouse`/`remember`/`cv`/`issue` and `diagnose.statusBlock` are pure (no live browser) and unit-tested. `diagnose`'s other helpers, `agent-interpret`, `drive`, and `session` drive a real Playwright `Page`/`Frame`.
- **Never submit, by construction** — the drive action vocabulary has no "submit", `SUBMIT_RX` guards refuse submit/apply-final clicks, consent checkboxes are left for the user, and the human always submits the handed-off window.
- **Headed real Chrome** (`channel: "chrome"`, on-screen, on the user's IP) for best ATS success; sessions are kept in a global map, pruned after 15 min, and the browser idle-closes after 5 min.
- **Untrusted input:** AI interpretation and CLI output are parsed defensively (`JSON.parse` in try/catch, `VALID_TYPES` whitelist); CV attach is strict-match (wrong CV is never attached).
- **Profile/root:** CLIs spawn with `cwd: careerOpsRoot()`. CVs resolve under `<requestRoot()>/output/` — callers MUST pass the requesting profile's own root, never `careerOpsRoot()`, or one profile's tailored CV can be attached to another profile's application.
- **Tiered extraction:** deterministic DOM extract → ATS-schema/DOM enrichment → AI interpret → agentic drive, each a fallback for the last.

Tests (`*.test.ts`) cover the pure helpers: `cv`, `greenhouse`, `remember`, and `diagnose.statusBlock`.
