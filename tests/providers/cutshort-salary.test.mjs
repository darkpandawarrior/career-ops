// tests/providers/cutshort-salary.test.mjs — salary extraction from the listing payload.
//
// The provider previously returned only {title, url, company, location}, so a salary_filter floor
// could never fire on this source: every posting reached the filter as "no comp data" and passed
// conservatively, even though CutShort renders a band on every card. That mattered because this is
// the highest-volume India source, and its listings cluster far below a senior floor.
//
// Hermetic: the payload below is the real shape observed on cutshort.io, inlined — no network.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — cutshort (salary extraction)');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/cutshort.mjs')).href);
  const { normalizeCutshortJob } = mod;

  const base = {
    headline: 'Senior Android Developer',
    publicUrl: 'https://cutshort.io/job/Senior-Android-Developer-abc123',
    locations: ['Bengaluru (Bangalore)'],
    companyDetails: { name: 'Acme' },
  };

  // 1. The *Vanity fields are what CutShort renders; min/max are routinely 0 (unset).
  const vanity = normalizeCutshortJob(
    { ...base, salaryRange: { currency: 'INR', min: 0, max: 700000, minVanity: 400000, maxVanity: 700000 } },
    'fallback',
  );
  if (vanity?.salary?.min === 400000 && vanity?.salary?.max === 700000) {
    pass('prefers the *Vanity band over an unset min/max');
  } else {
    fail(`vanity band → ${JSON.stringify(vanity?.salary)}`);
  }

  if (vanity?.salary?.currency === 'INR') pass('carries the currency through');
  else fail(`currency → ${JSON.stringify(vanity?.salary?.currency)}`);

  // 2. userMin/userMax variants win when present (what the board shows a signed-in user).
  const user = normalizeCutshortJob(
    { ...base, salaryRange: { currency: 'INR', userMinVanity: 4000000, userMaxVanity: 7000000, min: 0, max: 0 } },
    'fallback',
  );
  if (user?.salary?.min === 4000000 && user?.salary?.max === 7000000) pass('honours the user* variants');
  else fail(`user band → ${JSON.stringify(user?.salary)}`);

  // 3. Plain min/max still work when no vanity fields exist.
  const plain = normalizeCutshortJob({ ...base, salaryRange: { currency: 'INR', min: 1000000, max: 1500000 } }, 'f');
  if (plain?.salary?.min === 1000000 && plain?.salary?.max === 1500000) pass('falls back to plain min/max');
  else fail(`plain band → ${JSON.stringify(plain?.salary)}`);

  // 4. No salary data must NOT invent a band — downstream treats absent as "pass conservatively",
  //    and a zeroed band would instead read as "entirely below the floor" and drop the job.
  const none = normalizeCutshortJob({ ...base }, 'f');
  if (none && none.salary === undefined) pass('omits salary entirely when the payload carries none');
  else fail(`no-salary case → ${JSON.stringify(none?.salary)}`);

  const zeroed = normalizeCutshortJob({ ...base, salaryRange: { currency: 'INR', min: 0, max: 0 } }, 'f');
  if (zeroed && zeroed.salary === undefined) pass('an all-zero band is treated as absent, not as zero pay');
  else fail(`all-zero case → ${JSON.stringify(zeroed?.salary)}`);

  // 5. The non-salary contract is unchanged.
  if (vanity.title === 'Senior Android Developer' && vanity.company === 'Acme' && vanity.location === 'Bengaluru (Bangalore)') {
    pass('title/company/location are unchanged by the salary addition');
  } else {
    fail(`base fields → ${JSON.stringify(vanity)}`);
  }

  // 6. End to end against the real floor filter: a sub-floor band is dropped, a clearing one is kept.
  const { buildSalaryFilter } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
  const floor = buildSalaryFilter({ min_by_currency: { INR: 3500000 } });
  if (floor(plain.salary) === false) pass('a ₹10-15L band is dropped by a ₹35L floor');
  else fail('a ₹10-15L band should not survive a ₹35L floor');
  if (floor(user.salary) === true) pass('a ₹40-70L band survives a ₹35L floor');
  else fail('a ₹40-70L band should survive a ₹35L floor');
  if (floor(none.salary) === true) pass('a posting with no band still passes conservatively');
  else fail('a posting with no band must pass');
} catch (err) {
  fail(`cutshort salary suite threw: ${err.message}`);
}
