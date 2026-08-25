// Plus-addressed recruiter relays must survive contact extraction intact.
//
// EMAIL_RE used \w for the local part, and \w is [A-Za-z0-9_] — so `+` terminated the match and the
// address was silently TRUNCATED: `recruiter+a1b2…@reply.cutshort.io` was captured as
// `a1b2…@reply.cutshort.io`. That is a different mailbox, it would bounce, and it still looks like
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
  ['CutShort reply relay', 'reply to recruiter+a1b2c3d4e5f60718293a4b5c6d7e8f90@reply.cutshort.io', 'recruiter+a1b2c3d4e5f60718293a4b5c6d7e8f90@reply.cutshort.io'],
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
// WHOLE expected value, not merely "not the truncated form": a !== check against the broken
// string also passes for undefined, for '', and for any other wrong-but-different address, so it
// would keep reporting green while the extractor returned nothing at all.
const relay = first('reply to recruiter+a1b2c3d4e5f60718293a4b5c6d7e8f90@reply.cutshort.io');
if (relay === 'recruiter+a1b2c3d4e5f60718293a4b5c6d7e8f90@reply.cutshort.io') {
  pass('the plus-addressed relay is captured whole');
} else if (relay === 'a1b2c3d4e5f60718293a4b5c6d7e8f90@reply.cutshort.io') {
  fail('address was truncated at the plus again');
} else {
  fail(`expected the whole relay address, got ${JSON.stringify(relay)}`);
}
