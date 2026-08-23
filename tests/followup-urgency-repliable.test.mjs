// Urgency must key on "is there a human to write to", not on age alone.
//
// `urgent` was previously reachable for a `responded` row only while daysSinceApp <
// responded_initial — which is 1, so in practice only on the day the reply landed. Every genuinely
// live thread therefore aged into `overdue` within 24h and was reported identically to a dead
// no-reply row. Measured 2026-08-24: 47 overdue, of which exactly one (ModalX, 32 days silent, a
// named human who promised a call) was actually actionable. A daily alert that cannot distinguish
// those two is why five consecutive identical alerts were ignored.
import { computeUrgency } from '../followup-cadence.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nfollowup urgency — repliable contact drives severity');

const check = (label, got, want) => (got === want ? pass(label) : fail(`${label} — expected ${want}, got ${got}`));

// The motivating case: long-silent responded thread WITH a human.
check('responded + 32d silent + repliable  -> urgent',
  computeUrgency('responded', 32, null, 0, true), 'urgent');

// Same age, nobody to write to: still needs attention, but it is not the conversion surface.
check('responded + 32d silent + NO contact  -> overdue',
  computeUrgency('responded', 32, null, 0, false), 'overdue');

// An interview thread is live by definition.
check('interview past thank-you + repliable -> urgent',
  computeUrgency('interview', 10, null, 0, true), 'urgent');
check('interview past thank-you + no contact -> overdue',
  computeUrgency('interview', 10, null, 0, false), 'overdue');

// Already followed up recently: not due yet regardless of contact.
check('responded + followed up 1d ago       -> waiting',
  computeUrgency('responded', 40, 1, 1, true), 'waiting');

// Backward compatibility: the 5th argument is optional and defaults to the old behaviour, so
// existing callers and the exported contract are unchanged.
check('4-arg call still behaves as before   -> overdue',
  computeUrgency('responded', 32, null, 0), 'overdue');

// `applied` is deliberately NOT escalated by contact: no reply has been received, so a contact
// address is not evidence of a live conversation.
check('applied + repliable stays            -> overdue',
  computeUrgency('applied', 30, null, 0, true), 'overdue');
