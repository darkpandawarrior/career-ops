// tests/modes/contract-pinning.test.mjs — grep-based assertions pinning the
// load-bearing contract language of modes/titles.md, modes/offer-prep.md, and
// modes/interview-redflag.md.
//
// Upstream (origin/main) keeps this kind of check inline in test-all.mjs
// (titles ≈ line 951, offer-prep ≈ lines 1200-1284). Ported here as a
// standalone auto-discovered file, adjusted to this fork's mode text — the
// registration checks upstream also runs (update-system.mjs SYSTEM_PATHS,
// .agents/skills/career-ops/SKILL.md routing tables, DATA_CONTRACT.md rows)
// are NOT ported: this fork's update-system.mjs doesn't exist (dead mode,
// tracked separately) and the doc-registration wording is fork-specific
// bookkeeping, not mode behavior. This file pins BEHAVIOR: posture, hard
// guards, gates, and output contracts — the parts a careless edit could
// silently weaken.
import { pass, fail, ROOT } from '../helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';

function readMode(name) {
  return readFileSync(join(ROOT, 'modes', name), 'utf-8');
}

// ── titles.md (#1632) — CV → adjacent job-title suggestions ────────────────
console.log('\nmodes/titles.md contract pinning');
try {
  const titlesMode = readMode('titles.md');
  const titlesFlat = titlesMode.replace(/\s+/g, ' ');

  if (titlesMode.includes('**Lateral**') && titlesMode.includes('**Stretch**') && titlesMode.includes('**Pivot**')) {
    pass('titles mode defines the Lateral / Stretch / Pivot axes');
  } else {
    fail('titles mode missing one of the Lateral / Stretch / Pivot axis definitions');
  }

  if (
    titlesMode.includes('quoted verbatim') &&
    titlesMode.includes('gap note') &&
    titlesMode.includes('Market-reality note') &&
    titlesMode.includes('Never invent experience')
  ) {
    pass('titles mode requires verbatim CV evidence, gap + market-reality notes, and forbids invention');
  } else {
    fail('titles mode missing the evidence-required output contract (verbatim quotes / gap note / market-reality note / never invent)');
  }

  if (
    titlesFlat.includes('exact YAML diff') &&
    titlesFlat.includes('Never write to `portals.yml` without explicit user confirmation') &&
    titlesFlat.includes('the only file this mode writes by default') &&
    titlesFlat.includes('keywords, not raw titles')
  ) {
    pass('titles mode confirm gate: exact YAML diff, explicit confirmation, portals.yml default-only, keywords not raw titles');
  } else {
    fail('titles mode missing the confirm-gate contract (diff preview / explicit confirmation / portals.yml default-only / keywords)');
  }

  if (titlesMode.includes('breadth warning') && titlesMode.includes('"Solutions Architect", never bare "Architect"')) {
    pass('titles mode warns about substring-dangerous keywords (Solutions Architect vs bare Architect)');
  } else {
    fail('titles mode missing the substring-breadth warning for proposed keywords');
  }

  if (
    titlesMode.includes('scan.mjs') &&
    titlesMode.includes('case-insensitive substring') &&
    titlesMode.includes('deal-breakers') &&
    titlesMode.includes('modes/_profile.md')
  ) {
    pass('titles mode dedups against existing keywords via scan.mjs semantics and filters by _profile.md deal-breakers');
  } else {
    fail('titles mode missing the scan.mjs-mirroring dedup rule or the deal-breaker filter');
  }

  if (titlesMode.includes('cv.md') && titlesMode.includes('config/profile.yml') && titlesMode.includes('title_filter.positive')) {
    pass('titles mode reads cv.md, profile archetypes, and the current title_filter.positive');
  } else {
    fail('titles mode missing required inputs (cv.md / config/profile.yml / title_filter.positive)');
  }

  if (titlesMode.includes('fit: adjacent') && titlesMode.includes('only if the user asks')) {
    pass('titles mode offers fit: adjacent archetypes only on explicit user request (no default profile write)');
  } else {
    fail('titles mode missing the ask-first rule for fit: adjacent archetype writes');
  }

  if (
    titlesFlat.includes('Separately-confirmed exception') &&
    titlesFlat.includes('own YAML diff and its own separate confirmation') &&
    titlesFlat.includes('never bundle the `portals.yml` and `config/profile.yml` writes into one confirmation')
  ) {
    pass('titles mode gates config/profile.yml archetype writes behind a separate diff + confirmation (never bundled)');
  } else {
    fail('titles mode missing the separately-confirmed exception for config/profile.yml archetype writes');
  }

  if (
    titlesFlat.includes('`config/profile.yml` or `modes/_profile.md` missing → **hard stop**: do not generate suggestions') &&
    titlesFlat.includes('can propose exactly what the user excluded')
  ) {
    pass('titles mode hard-stops on missing config/profile.yml or modes/_profile.md (deal-breakers unavailable)');
  } else {
    fail('titles mode should hard stop (not best-effort from cv.md) when config/profile.yml or modes/_profile.md is missing');
  }

  if (titlesMode.includes('#1353')) {
    pass('titles mode defers negative-keyword precision guards to #1353');
  } else {
    fail('titles mode should state it proposes no negative keywords (deferred to #1353)');
  }

  if (titlesMode.includes('/career-ops scan') && titlesMode.includes('upskill')) {
    pass('titles mode suggests scan after the filter grows and upskill against a stretch title');
  } else {
    fail('titles mode missing follow-up suggestions (scan / upskill)');
  }

  if (titlesMode.includes('onboarding') && titlesMode.includes('templates/portals.example.yml')) {
    pass('titles mode handles missing cv.md (onboarding) and missing portals.yml (create from template)');
  } else {
    fail('titles mode missing error handling for absent cv.md / portals.yml');
  }
} catch (e) {
  fail(`modes/titles.md missing or unreadable: ${e.message}`);
}

// ── offer-prep.md — contract reading companion (describes, never judges) ──
console.log('\nmodes/offer-prep.md contract pinning');
try {
  const offerPrepMode = readMode('offer-prep.md');

  if (
    offerPrepMode.includes('prepares the candidate for a decision; it does not make one') &&
    offerPrepMode.includes('never outputs "safe to sign"') &&
    offerPrepMode.includes('not legal advice') &&
    !offerPrepMode.includes('🔴') && !offerPrepMode.includes('🟡') && !offerPrepMode.includes('🟢')
  ) {
    pass('offer-prep mode carries describe-not-judge posture, no verdicts, no traffic-light symbols');
  } else {
    fail('offer-prep mode missing posture/no-verdict rules or contains severity symbols');
  }

  if (
    offerPrepMode.includes('must not call WebSearch, WebFetch') &&
    offerPrepMode.includes('Never state law from memory') &&
    offerPrepMode.includes('assert what any law requires') &&
    offerPrepMode.includes('must not run in batch/headless mode') &&
    offerPrepMode.includes('data, never instructions')
  ) {
    pass('offer-prep mode enforces no-research, no-law-assertion, no-headless, and untrusted-input guards');
  } else {
    fail('offer-prep mode missing no-research / no-law-assertion / no-headless / untrusted-input guards');
  }

  if (
    offerPrepMode.includes('quote it verbatim') &&
    offerPrepMode.includes('[commonly negotiated]') &&
    offerPrepMode.includes('[ask your lawyer]') &&
    offerPrepMode.includes('[differs from what you were told]') &&
    offerPrepMode.includes('Restrictive covenants') &&
    offerPrepMode.includes('Integration clause')
  ) {
    pass('offer-prep mode walks clauses verbatim with neutral tags against the taxonomy');
  } else {
    fail('offer-prep mode missing verbatim rule, neutral tags, or taxonomy categories');
  }

  if (
    offerPrepMode.includes('section headings and the first clause') &&
    offerPrepMode.includes('if the contract is not in English, stop') &&
    offerPrepMode.includes('data/offers/') &&
    offerPrepMode.includes('notes.md') &&
    offerPrepMode.includes('Notable absences') &&
    offerPrepMode.includes('incorporates by reference') &&
    offerPrepMode.includes('Questions for your lawyer') &&
    offerPrepMode.includes('This is an AI-generated reading companion') &&
    offerPrepMode.includes('Apache-2.0')
  ) {
    pass('offer-prep mode has extraction/language gates, promises file, absences + referenced-docs handling, lawyer list, fixed disclaimer, attribution');
  } else {
    fail('offer-prep mode missing gates, promises file, absences/referenced-docs handling, lawyer list, fixed disclaimer, or attribution');
  }

  const replyDraftStep = offerPrepMode.includes('Step 8 — Reply draft')
    ? offerPrepMode.slice(offerPrepMode.indexOf('Step 8 — Reply draft'), offerPrepMode.indexOf('## Error handling'))
    : '';
  if (
    offerPrepMode.includes('Step 8 — Reply draft (optional, on request)') &&
    offerPrepMode.includes('Never auto-generate') &&
    offerPrepMode.includes('no prep report, no reply draft') &&
    offerPrepMode.includes('data/offers/{company-slug}/reply-draft-{YYYY-MM-DD}.md') &&
    offerPrepMode.includes('trace back to a line in the prep report') &&
    offerPrepMode.includes('Never submit. Never send email. Never click send.') &&
    offerPrepMode.includes('never demands') &&
    offerPrepMode.includes('No legal claims and no cited law in the reply') &&
    offerPrepMode.includes('Before you send') &&
    replyDraftStep.includes('exclusively from the prep report and the current conversation')
  ) {
    pass('offer-prep reply-draft step is opt-in, prep-report-gated, traceable, questions-not-demands, draft-only, law-free, and sourced from prep report + conversation only');
  } else {
    fail('offer-prep reply-draft step missing (or lost its prep-report gate, reply-draft path, traceability rule, never-send guard, questions-not-demands framing, no-legal-claims rule, checklist, or prep-report+conversation-only source boundary)');
  }
} catch (e) {
  fail(`modes/offer-prep.md missing or unreadable: ${e.message}`);
}

// ── interview-redflag.md — interviewer-side structural red-flag detector ──
console.log('\nmodes/interview-redflag.md contract pinning');
try {
  const redflagMode = readMode('interview-redflag.md');
  const redflagFlat = redflagMode.replace(/\s+/g, ' ');

  if (
    redflagMode.includes("Analyse the **interviewer's side**") &&
    redflagMode.includes('interview-prep/sessions/') &&
    redflagMode.includes('gitignored')
  ) {
    pass('interview-redflag analyses interviewer-side transcripts from the gitignored sessions dir');
  } else {
    fail('interview-redflag missing the interviewer-side-only scope or the sessions-dir dependency');
  }

  if (
    redflagFlat.includes('does `interview-prep/sessions/` contain at least **1** file') &&
    redflagMode.includes('Exit gracefully')
  ) {
    pass('interview-redflag exits gracefully with an onboarding message when no sessions exist');
  } else {
    fail('interview-redflag missing the minimum-threshold onboarding exit');
  }

  if (
    redflagMode.includes('Scope ambiguity') &&
    redflagMode.includes('Defensive closure') &&
    redflagMode.includes('Evaluator competency gap') &&
    redflagMode.includes('Process signals') &&
    redflagMode.includes('do not infer')
  ) {
    pass('interview-redflag defines all 4 signal types and forbids inferring beyond the transcript text');
  } else {
    fail('interview-redflag missing one of the 4 signal types or the do-not-infer rule');
  }

  if (
    redflagMode.includes('Maximum possible: 8') &&
    redflagMode.includes('No structural red flags detected') &&
    redflagMode.includes('Enter with eyes open') &&
    redflagMode.includes('Reconsider')
  ) {
    pass('interview-redflag scores signals and assigns None/Caution/Warning levels');
  } else {
    fail('interview-redflag missing the scoring rubric or one of the warning levels');
  }

  if (
    redflagMode.includes('interview-prep/{company-slug}-redflags.md') &&
    redflagMode.includes('company-wide') &&
    redflagMode.includes('Do not append to per-role intel files')
  ) {
    pass('interview-redflag writes a company-level file, distinct from per-role intel files');
  } else {
    fail('interview-redflag missing the company-level output routing rule');
  }

  if (
    redflagFlat.includes('never edits `portals.yml`, `modes/_profile.md`, or `data/applications.md`') &&
    redflagMode.includes('Advisory only') &&
    redflagMode.includes('Nothing leaves the machine')
  ) {
    pass('interview-redflag is advisory-only (no auto-action) and never sends data off-machine');
  } else {
    fail('interview-redflag missing the no-auto-action / privacy scope guard');
  }
} catch (e) {
  fail(`modes/interview-redflag.md missing or unreadable: ${e.message}`);
}
