// tests/providers/careerjet.test.mjs — hermetic (mock ctx, no network) per the
// project's providers/README.md contract. Never exercises the real
// search.api.careerjet.net endpoint or a real CAREERJET_API_KEY.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — careerjet');

const ORIGINAL_KEY = process.env.CAREERJET_API_KEY;
process.env.CAREERJET_API_KEY = 'test-key-123';

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/careerjet.mjs')).href);
  const careerjet = mod.default;
  const { normalizeCareerjetJob } = mod;

  if (careerjet.id === 'careerjet') pass('careerjet.id is "careerjet"');
  else fail(`careerjet.id is ${JSON.stringify(careerjet.id)}`);

  // normalizeCareerjetJob — field mapping per the live-fetched v4 job shape
  const job = normalizeCareerjetJob({
    title: 'Android Developer',
    company: 'Worldline',
    date: 'Fri, 21 Aug 2026 09:00:00 GMT',
    locations: 'Pune',
    url: 'https://jobviewtrack.com/v2/abc123',
  });
  if (job?.title === 'Android Developer' && job?.company === 'Worldline' && job?.location === 'Pune')
    pass('normalizeCareerjetJob maps title/company/locations correctly');
  else fail(`normalizeCareerjetJob mapped = ${JSON.stringify(job)}`);
  if (typeof job?.postedAt === 'number' && !Number.isNaN(job.postedAt))
    pass('normalizeCareerjetJob parses date → postedAt epoch ms');
  else fail(`normalizeCareerjetJob postedAt = ${JSON.stringify(job?.postedAt)}`);

  if (normalizeCareerjetJob({ title: '', company: 'X', url: 'https://x.com/1' }) === null)
    pass('normalizeCareerjetJob drops entries with empty title');
  else fail('normalizeCareerjetJob should return null for empty title');

  if (normalizeCareerjetJob({ title: 'Role', company: 'X', url: '' }) === null)
    pass('normalizeCareerjetJob drops entries with no url');
  else fail('normalizeCareerjetJob should return null for missing url');

  if (normalizeCareerjetJob(null) === null)
    pass('normalizeCareerjetJob returns null for non-object input');
  else fail('normalizeCareerjetJob should return null for null input');

  // detect()
  if (careerjet.detect({ provider: 'careerjet', keyword: 'android' })?.url && !careerjet.detect({ provider: 'careerjet' }))
    pass('careerjet.detect() requires provider:careerjet AND a non-empty keyword');
  else fail('careerjet.detect() should require both provider:careerjet and keyword');

  if (careerjet.detect({ provider: 'cutshort', keyword: 'android' }) === null)
    pass('careerjet.detect() ignores entries claimed by a different provider');
  else fail('careerjet.detect() should not claim a non-careerjet entry');

  // fetch() — mock ctx, single page
  let capturedUrl = null;
  let capturedHeaders = null;
  const fetched = await careerjet.fetch(
    { name: 'Careerjet — Android (India)', provider: 'careerjet', keyword: 'android' },
    {
      fetchJson: async (url, opts) => {
        capturedUrl = url; capturedHeaders = opts?.headers;
        return {
          type: 'JOBS', hits: 2, pages: 1,
          jobs: [
            { title: 'Android Developer', company: 'Worldline', locations: 'Pune', url: 'https://jobviewtrack.com/v2/a' },
            { title: '', company: 'Bad', locations: '', url: 'https://jobviewtrack.com/v2/b' }, // dropped: empty title
          ],
        };
      },
    },
  );
  const url = new URL(capturedUrl);
  if (url.hostname === 'search.api.careerjet.net' && url.pathname === '/v4/query')
    pass('careerjet.fetch() calls the v4 endpoint on the correct host');
  else fail(`careerjet.fetch() called ${capturedUrl}`);

  if (url.searchParams.get('keywords') === 'android' && url.searchParams.get('location') === 'India')
    pass('careerjet.fetch() passes keyword and default location (India) as query params');
  else fail(`careerjet.fetch() params: keywords=${url.searchParams.get('keywords')}, location=${url.searchParams.get('location')}`);

  if (url.searchParams.get('user_ip') && url.searchParams.get('user_agent'))
    pass('careerjet.fetch() supplies the required user_ip and user_agent params');
  else fail('careerjet.fetch() must always include user_ip and user_agent (documented 403 without them)');

  if (capturedHeaders?.authorization?.startsWith('Basic '))
    pass('careerjet.fetch() sends HTTP Basic auth from CAREERJET_API_KEY');
  else fail(`careerjet.fetch() authorization header = ${JSON.stringify(capturedHeaders?.authorization)}`);

  if (fetched.length === 1 && fetched[0].title === 'Android Developer')
    pass('careerjet.fetch() normalizes valid jobs and drops the empty-title entry');
  else fail(`careerjet.fetch() returned ${JSON.stringify(fetched)}`);

  // type: LOCATIONS (ambiguous location) → zero jobs, not an error
  const ambiguous = await careerjet.fetch(
    { name: 'Careerjet — Android (Ambiguous)', provider: 'careerjet', keyword: 'android', location: 'Springfield' },
    { fetchJson: async () => ({ type: 'LOCATIONS', locations: ['Springfield, IL', 'Springfield, MO'] }) },
  );
  if (Array.isArray(ambiguous) && ambiguous.length === 0)
    pass('careerjet.fetch() treats an ambiguous LOCATIONS response as zero jobs, not a thrown error');
  else fail(`careerjet.fetch() ambiguous-location result = ${JSON.stringify(ambiguous)}`);

  // Missing API key → clear, actionable error
  delete process.env.CAREERJET_API_KEY;
  try {
    await careerjet.fetch({ name: 'X', provider: 'careerjet', keyword: 'android' }, { fetchJson: async () => ({}) });
    fail('careerjet.fetch() should throw when CAREERJET_API_KEY is unset');
  } catch (err) {
    if (/CAREERJET_API_KEY/.test(err.message)) pass('careerjet.fetch() throws a clear error when CAREERJET_API_KEY is unset');
    else fail(`careerjet.fetch() threw an unrelated error: ${err.message}`);
  }
  process.env.CAREERJET_API_KEY = 'test-key-123';

  // Missing keyword → clear, actionable error
  try {
    await careerjet.fetch({ name: 'X', provider: 'careerjet' }, { fetchJson: async () => ({}) });
    fail('careerjet.fetch() should throw when keyword is missing');
  } catch (err) {
    if (/keyword/.test(err.message)) pass('careerjet.fetch() throws a clear error when keyword is missing');
    else fail(`careerjet.fetch() threw an unrelated error: ${err.message}`);
  }
} catch (err) {
  fail(`careerjet provider tests crashed: ${err.message}`);
} finally {
  if (ORIGINAL_KEY === undefined) delete process.env.CAREERJET_API_KEY;
  else process.env.CAREERJET_API_KEY = ORIGINAL_KEY;
}
