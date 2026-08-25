// Plus-addressed recruiter relays must survive contact extraction intact.
//
// EMAIL_RE used \w for the local part, and \w is [A-Za-z0-9_] — so `+` terminated the match and the
// address was silently TRUNCATED: `mayank+6a88…@reply.cutshort.io` was captured as
// `6a88…@reply.cutshort.io`. That is a different mailbox, it would bounce, and it still looks like
// a perfectly valid address, so nothing downstream could notice.
//
// This is the worst case for a job search specifically: recruiting platforms route replies through
// exactly this form (CutShort, Greenhouse, Lever, Workable all use `name+token@reply.domain`), so
// the addresses being corrupted were the ones that actually reach a human.
import { extractContacts } from '../followup-cadence.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nextractContacts — plus-addressed relays');

const first = (notes) => extractContacts(notes, new Set())[0]?.email;

const cases = [
  ['CutShort reply relay', 'reply to mayank+6a8802560cd020bc8352a382@reply.cutshort.io', 'mayank+6a8802560cd020bc8352a382@reply.cutshort.io'],
  ['Greenhouse-style token', 'mail jobs+ref123@greenhouse.io', 'jobs+ref123@greenhouse.io'],
  ['plain address unchanged', 'recruiter dana@acme.example replied', 'dana@acme.example'],
  ['dots and dashes still fine', 'contact first.last-name@sub.acme.example', 'first.last-name@sub.acme.example'],
];

for (const [label, notes, want] of cases) {
  const got = first(notes);
  if (got === want) pass(`${label}: ${want}`);
  else fail(`${label}: expected ${want}, got ${got}`);
}

// The truncation bug produced a *plausible* address, which is why it went unnoticed. Assert the
// broken form specifically, so a regression cannot pass by producing something merely email-shaped.
const relay = first('reply to mayank+6a8802560cd020bc8352a382@reply.cutshort.io');
if (relay !== '6a8802560cd020bc8352a382@reply.cutshort.io') pass('the truncated-at-plus form is not produced');
else fail('address was truncated at the plus again');
