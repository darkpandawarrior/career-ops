// salary_filter.min_by_currency — a per-market floor.
//
// Motivating case: a candidate with an INR floor of ₹35L AND a USD target of $60k+. The flat
// min/currency pair cannot express that — currency:INR rejects USD jobs on the mismatch rule, and
// an empty currency compares $120k against 3_500_000 numerically and rejects it too. Either way
// the international pipeline silently vanishes.
import { buildSalaryFilter } from '../scan.mjs';
import { pass, fail } from './helpers.mjs';

const f = buildSalaryFilter({ min_by_currency: { INR: 3_500_000, USD: 60_000 } });

const check = (label, salary, expected) => {
  const got = f(salary);
  if (got === expected) pass(label);
  else fail(`${label} — expected ${expected}, got ${got}`);
};

check('INR job entirely below the floor is rejected', { min: 1_000_000, max: 1_500_000, currency: 'INR' }, false);
check('INR job whose top touches the floor passes', { min: 1_000_000, max: 3_500_000, currency: 'INR' }, true);
check('INR job above the floor passes', { min: 2_500_000, max: 4_000_000, currency: 'INR' }, true);
check('USD job above its own floor passes (not compared to the INR floor)', { min: 60_000, max: 120_000, currency: 'USD' }, true);
check('USD job below its own floor is rejected', { min: 20_000, max: 40_000, currency: 'USD' }, false);
check('a currency with no configured floor passes', { min: 10, max: 20, currency: 'EUR' }, true);
check('a job with no currency passes', { min: 10, max: 20 }, true);
check('a job with no salary data passes', null, true);
check('a job with a min but no max uses the min', { min: 4_000_000, currency: 'INR' }, true);

const off = buildSalaryFilter({ min_by_currency: {} });
if (off({ min: 1, max: 2, currency: 'INR' }) === true) pass('an empty min_by_currency disables filtering');
else fail('an empty min_by_currency must disable filtering');
