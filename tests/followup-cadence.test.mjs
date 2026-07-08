// tests/followup-cadence.test.mjs — tests for computeNextFollowupDate cadence
// selection. Focuses on the `responded` branch, where the first follow-up
// after a recruiter reply must be scheduled with `responded_initial`, not
// `responded_subsequent`.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nfollowup-cadence.mjs (responded_initial cadence)');

const { computeNextFollowupDate, addDays, parseDate, DEFAULT_CADENCE } =
  await import(pathToFileURL(join(ROOT, 'followup-cadence.mjs')).href);

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
