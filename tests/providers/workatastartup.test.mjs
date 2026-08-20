// tests/providers/workatastartup.test.mjs — mirrors cutshort.mjs's shape
// (shared multi-tenant board, embedded framework JSON, no live network).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — workatastartup');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/workatastartup.mjs')).href);
  const provider = mod.default;
  const { extractJobsFromHtml, normalizeWorkAtAStartupJob } = mod;

  if (provider.id === 'workatastartup') pass('workatastartup.id is "workatastartup"');
  else fail(`workatastartup.id is ${JSON.stringify(provider.id)}`);

  // --- detect() --------------------------------------------------------------

  const hit = provider.detect({ provider: 'workatastartup', careers_url: 'https://www.workatastartup.com/jobs/l/software-engineer' });
  if (hit && hit.url === 'https://www.workatastartup.com/jobs/l/software-engineer') {
    pass('detect() claims a valid /jobs/l/<slug> entry');
  } else {
    fail(`detect() hit = ${JSON.stringify(hit)}`);
  }

  const misses = [
    provider.detect({ provider: 'other', careers_url: 'https://www.workatastartup.com/jobs/l/software-engineer' }),
    provider.detect({ provider: 'workatastartup', careers_url: 'https://evil.example/jobs/l/software-engineer' }),
    provider.detect({ provider: 'workatastartup', careers_url: 'https://www.workatastartup.com/jobs/103934' }),
    provider.detect({ provider: 'workatastartup' }),
  ];
  if (misses.every(m => m === null)) {
    pass('detect() rejects wrong provider id, off-host URL, non-listing path, and missing careers_url');
  } else {
    fail(`detect() misses = ${JSON.stringify(misses)}`);
  }

  // --- extractJobsFromHtml ----------------------------------------------------

  function buildPage(jobs) {
    const payload = { component: 'jobs/public/pages/JobsPage', props: { jobs } };
    const escaped = JSON.stringify(payload)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<html><body><div id="app" data-page="${escaped}"></div></body></html>`;
  }

  const html = buildPage([
    { id: 103934, title: 'Senior Android Engineer', location: 'Bengaluru, KA, IN', companyName: 'Acme & Co' },
  ]);
  const extracted = extractJobsFromHtml(html);
  if (extracted.length === 1 && extracted[0].companyName === 'Acme & Co' && extracted[0].title === 'Senior Android Engineer') {
    pass('extractJobsFromHtml decodes HTML entities (&amp; → &) and reads props.jobs');
  } else {
    fail(`extractJobsFromHtml result = ${JSON.stringify(extracted)}`);
  }

  const noAttr = extractJobsFromHtml('<html><body>no data-page here</body></html>');
  if (Array.isArray(noAttr) && noAttr.length === 0) pass('extractJobsFromHtml returns [] when data-page is absent');
  else fail(`extractJobsFromHtml no-attr result = ${JSON.stringify(noAttr)}`);

  const malformedJson = '<div data-page="{&quot;not valid json"></div>';
  const badJson = extractJobsFromHtml(malformedJson);
  if (Array.isArray(badJson) && badJson.length === 0) pass('extractJobsFromHtml returns [] on malformed JSON');
  else fail(`extractJobsFromHtml malformed result = ${JSON.stringify(badJson)}`);

  const nonArrayJobs = extractJobsFromHtml(
    `<div data-page="${JSON.stringify({ props: { jobs: 'not-an-array' } }).replace(/"/g, '&quot;')}"></div>`,
  );
  if (Array.isArray(nonArrayJobs) && nonArrayJobs.length === 0) {
    pass('extractJobsFromHtml returns [] when props.jobs is not an array');
  } else {
    fail(`extractJobsFromHtml non-array jobs result = ${JSON.stringify(nonArrayJobs)}`);
  }

  // --- normalizeWorkAtAStartupJob ---------------------------------------------

  const full = normalizeWorkAtAStartupJob(
    { id: 103934, title: '  Senior Android Engineer  ', location: '  Bengaluru, KA, IN  ', companyName: '  Acme  ' },
    'Fallback Co',
  );
  if (
    full &&
    full.title === 'Senior Android Engineer' &&
    full.url === 'https://www.workatastartup.com/jobs/103934' &&
    full.company === 'Acme' &&
    full.location === 'Bengaluru, KA, IN'
  ) {
    pass('normalizeWorkAtAStartupJob maps + trims title/id→url/companyName/location');
  } else {
    fail(`normalizeWorkAtAStartupJob full row = ${JSON.stringify(full)}`);
  }

  const coFromEntry = normalizeWorkAtAStartupJob({ id: 1, title: 'T' }, 'Entry Name');
  const coDefault = normalizeWorkAtAStartupJob({ id: 2, title: 'T' });
  if (coFromEntry?.company === 'Entry Name' && coDefault?.company === 'Y Combinator — Work at a Startup') {
    pass('normalizeWorkAtAStartupJob falls back company → entry name → board default');
  } else {
    fail(`normalizeWorkAtAStartupJob company fallbacks = ${JSON.stringify({ a: coFromEntry?.company, b: coDefault?.company })}`);
  }

  const drops = [
    normalizeWorkAtAStartupJob({ id: 1, title: '' }),
    normalizeWorkAtAStartupJob({ id: 0, title: 'No id' }),
    normalizeWorkAtAStartupJob({ id: -5, title: 'Negative id' }),
    normalizeWorkAtAStartupJob({ id: 1.5, title: 'Non-integer id' }),
    normalizeWorkAtAStartupJob({ title: 'No id at all' }),
    normalizeWorkAtAStartupJob(null),
    normalizeWorkAtAStartupJob('nope'),
  ];
  if (drops.every(r => r === null)) {
    pass('normalizeWorkAtAStartupJob drops empty-title / missing-or-invalid-id / non-object rows');
  } else {
    fail(`normalizeWorkAtAStartupJob drops = ${JSON.stringify(drops)}`);
  }

  // --- fetch() -----------------------------------------------------------------

  const requested = [];
  const ctx = {
    transport: 'http',
    fetchText: async (url, opts) => {
      requested.push({ url, redirect: opts?.redirect, accept: opts?.headers?.accept });
      return buildPage([
        { id: 1, title: 'Android Engineer', location: 'Pune, IN', companyName: 'Co A' },
        { id: 2, title: '', location: 'X', companyName: 'Bad — no title' }, // dropped
      ]);
    },
  };
  const jobs = await provider.fetch(
    { name: 'YC Work at a Startup', provider: 'workatastartup', careers_url: 'https://www.workatastartup.com/jobs/l/software-engineer' },
    ctx,
  );
  if (
    jobs.length === 1 &&
    jobs[0].url === 'https://www.workatastartup.com/jobs/1' &&
    requested.length === 1 &&
    requested[0].redirect === 'error' &&
    typeof requested[0].accept === 'string' && requested[0].accept.includes('text/html')
  ) {
    pass('fetch() sends redirect:"error" + an Accept:text/html header and drops malformed rows');
  } else {
    fail(`fetch() result = ${JSON.stringify({ jobs, requested })}`);
  }

  let threw = false;
  try {
    await provider.fetch({ name: 'Bad entry', provider: 'workatastartup' }, ctx);
  } catch {
    threw = true;
  }
  if (threw) pass('fetch() throws when careers_url is missing/invalid');
  else fail('fetch() did not throw on a missing careers_url');
} catch (e) {
  fail(`workatastartup provider test crashed: ${e?.message}`);
}
