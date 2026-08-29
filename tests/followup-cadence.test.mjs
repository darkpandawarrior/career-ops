// tests/followup-cadence.test.mjs — tests for computeNextFollowupDate cadence
// selection. Focuses on the `responded` branch, where the first follow-up
// after a recruiter reply must be scheduled with `responded_initial`, not
// `responded_subsequent`.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nfollowup-cadence.mjs (responded_initial cadence)');

const DEFAULT_CADENCE_PROFILE = join(ROOT, 'tests', 'fixtures', 'profile-default-cadence.yml');
const CUSTOM_CADENCE_PROFILE = join(ROOT, 'tests', 'fixtures', 'profile-custom-cadence.yml');

// Pin the cadence source BEFORE followup-cadence.mjs is evaluated. Its
// module-level `CADENCE = resolveCadenceConfig()` reads CAREER_OPS_PROFILE at
// import time and otherwise falls back to the USER's config/profile.yml — so
// on a machine where the user customized followup_cadence, assertions written
// against DEFAULT_CADENCE failed on a perfectly healthy install (#2268).
//
// Discovered tests/*.test.mjs run IN-PROCESS (test-all.mjs's runDiscovered
// imports each one into the same process rather than spawning it), so the env
// var must be restored right after the import — other modules imported later
// in the same run (e.g. providers/_profile-keywords.mjs) read
// CAREER_OPS_PROFILE too, and a leaked override would point them at this tiny
// fixture instead of the real config/profile.yml.
//
// The restore lives in a `finally` rather than after the import: a throw from
// the imported module would skip a trailing restore, and discovery CONTAINS
// the throw and runs the next suite regardless — so the leak would come back
// on precisely the run that was already going wrong (#3306). Nothing below
// needs the variable; every later call passes profilePath explicitly.
const previousProfileEnv = process.env.CAREER_OPS_PROFILE;
process.env.CAREER_OPS_PROFILE = DEFAULT_CADENCE_PROFILE;

let cadence;
try {
  cadence = await import(pathToFileURL(join(ROOT, 'followup-cadence.mjs')).href);
} finally {
  if (previousProfileEnv === undefined) delete process.env.CAREER_OPS_PROFILE;
  else process.env.CAREER_OPS_PROFILE = previousProfileEnv;
}

const { computeNextFollowupDate, addDays, parseDate, DEFAULT_CADENCE, normalizeStatus, resolveCadenceConfig, loadProfileCadence } =
  cadence;

const APP = '2026-06-30';

function eq(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass(label);
  else fail(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// The first follow-up after a recruiter response is due at appDate + responded_initial.
// responded_initial (and its profile override responded_initial_days) is otherwise only
// read by computeUrgency, so before the fix it had no effect on the scheduled date.
eq(
  'responded, no prior follow-up uses responded_initial',
  computeNextFollowupDate('responded', APP, null, 0),
  addDays(parseDate(APP), DEFAULT_CADENCE.responded_initial),
);

// Subsequent follow-ups still use responded_subsequent, counted from the last follow-up.
eq(
  'responded, with prior follow-up uses responded_subsequent',
  computeNextFollowupDate('responded', APP, '2026-07-02', 1),
  addDays(parseDate('2026-07-02'), DEFAULT_CADENCE.responded_subsequent),
);

// The initial next-date must not land after the overdue threshold, otherwise a row can be
// flagged "overdue" (daysSinceApp >= responded_subsequent) while its own next-follow-up
// date is still in the future, which is impossible for a date meant to trigger "overdue".
eq(
  'initial next follow-up is not later than the overdue threshold',
  computeNextFollowupDate('responded', APP, null, 0) <=
    addDays(parseDate(APP), DEFAULT_CADENCE.responded_subsequent),
  true,
);

// Regression: the applied branch is unchanged.
eq(
  'applied, no follow-ups uses applied_first',
  computeNextFollowupDate('applied', APP, null, 0),
  addDays(parseDate(APP), DEFAULT_CADENCE.applied_first),
);

// Hired aliases from templates/states.yml must normalize to 'hired'. Before
// this, 'Accepted'/'Contratado' normalized to themselves, so stats/funnel/
// company-history consumers looking for 'hired' silently dropped those rows.
for (const raw of ['Hired', 'Accepted', 'accept', 'Contratado', 'contratada']) {
  eq(`normalizeStatus('${raw}') canonicalizes to hired`, normalizeStatus(raw), 'hired');
}

// #2268 — the suite pins the profile so a user's own followup_cadence can't
// turn a healthy install red. These two guard the pin from the opposite
// failure: pinning must not degrade into ignoring the profile altogether.
eq(
  'a fixture profile with no followup_cadence yields the defaults',
  loadProfileCadence(DEFAULT_CADENCE_PROFILE),
  {},
);
eq(
  'a customized profile is still read through profilePath',
  resolveCadenceConfig({ profilePath: CUSTOM_CADENCE_PROFILE, appliedDays: null }),
  {
    applied_first: 3,
    applied_subsequent: 30,
    applied_max_followups: 5,
    responded_initial: 2,
    responded_subsequent: 9,
    interview_thankyou: 4,
  },
);
eq(
  'the pinned default profile resolves to DEFAULT_CADENCE',
  resolveCadenceConfig({ profilePath: DEFAULT_CADENCE_PROFILE, appliedDays: null }),
  DEFAULT_CADENCE,
);
