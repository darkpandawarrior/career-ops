// Owed actions — "they are waiting on YOU" as a first-class state.
//
// career-ops models follow-ups (you chasing them) and has no inverse. That inverse is this user's
// measured dominant failure mode: four applications died at an incomplete screening step, and a
// fifth was mid-death on 2026-08-24 — a questionnaire on the highest-scoring role in the pipeline
// sat unanswered through two reminders while the row reported as ordinary "overdue".
import { parseOwedActions } from '../owed-actions.mjs';
import { computeUrgency } from '../followup-cadence.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nowed-actions — the process is blocked on you');

const TABLE = `# Owed

| # | Company | Owed | Since | Action | Sent? |
|---|---------|------|-------|--------|-------|
| 84 | Talent Pro | Screening questionnaire OPEN | 08-22 | Answer it | ☐ |
| 53 | Jobgether | Assessment never opened | 07-22 | Open the report | ☐ |
| 12 | DoneCo | Reply owed | 07-01 | Sent already | ☑ |
| 13 | AlsoDone | Reply owed | 07-01 | Sent already | ✅ |
`;

const rows = parseOwedActions(TABLE);

if (rows.length === 2) pass('only UNCHECKED rows are returned (a queue, not a history)');
else fail(`expected 2 unchecked rows, got ${rows.length}`);

if (rows.every((r) => r.appNum !== 12 && r.appNum !== 13)) pass('☑ and ✅ both count as resolved');
else fail('a checked row leaked into the queue');

const talentPro = rows.find((r) => r.appNum === 84);
if (talentPro && talentPro.company === 'Talent Pro') pass('company is parsed off the row');
else fail(`company = ${talentPro && talentPro.company}`);
if (talentPro && /questionnaire/i.test(talentPro.owed)) pass('the owed description survives parsing');
else fail(`owed = ${talentPro && talentPro.owed}`);

// The header and delimiter rows must not become entries. They can't match — `#` and `---` are not
// digits — but assert it, because a parser that invents rows would manufacture false urgency.
if (!rows.some((r) => Number.isNaN(r.appNum))) pass('header and delimiter rows are not parsed as entries');
else fail('a non-data row was parsed');

// Fail open. This feeds urgency; a parse problem must never invent work.
if (parseOwedActions('').length === 0) pass('empty input yields no owed actions');
else fail('empty input produced rows');
if (parseOwedActions('no table here at all').length === 0) pass('prose without a table yields none');
else fail('prose produced rows');

// The reason this exists: an owed action outranks cadence. A row can be well inside its follow-up
// window — nothing to nudge yet — while a question already asked is owed today.
{
  // Followed up yesterday: cadence says wait. If that same row also owes a screening answer, the
  // owed override must win — which is the whole point of reading owed-actions.md.
  const waiting = computeUrgency('responded', 40, 1, 1, true);
  if (waiting === 'waiting') pass('a recently-nudged row is "waiting" on cadence alone');
  else fail(`expected waiting, got ${waiting}`);
}
