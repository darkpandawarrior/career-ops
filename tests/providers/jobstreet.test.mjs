// tests/providers/jobstreet.test.mjs — moved from test-all.mjs (test-layout migration).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\n22. Provider — jobstreet');

try {
  const jobstreet = (await import(pathToFileURL(join(ROOT, 'providers/jobstreet.mjs')).href)).default;
  const { parseJobstreetItem } = await import(pathToFileURL(join(ROOT, 'providers/jobstreet.mjs')).href);

  // id check
  if (jobstreet.id === 'jobstreet') pass('jobstreet.id is "jobstreet"');
  else fail(`jobstreet.id is ${JSON.stringify(jobstreet.id)}`);

  // detect() always returns null (job board, not ATS)
  if (jobstreet.detect({ name: 'X', careers_url: 'https://id.jobstreet.com/jobs' }) === null) {
    pass('jobstreet.detect() returns null — explicit provider only, no URL auto-detection');
  } else {
    fail('jobstreet.detect() should return null for any URL');
  }

  // parseJobstreetItem — valid item (v5 shape: advertiser.description, locations[0].label, id-based URL)
  const sampleItem = {
    id: '123456',
    title: 'Senior Data Scientist',
    advertiser: { id: '999', description: 'TechCorp Indonesia' },
    companyName: 'TechCorp',
    locations: [{ label: 'Jakarta Selatan', countryCode: 'ID' }],
    listingDate: '2026-06-15T00:00:00Z',
  };
  const parsed = parseJobstreetItem(sampleItem, 'https://id.jobstreet.com', 'FallbackCo');
  if (parsed && parsed.title === 'Senior Data Scientist'
      && parsed.url === 'https://id.jobstreet.com/id/job/123456'
      && parsed.company === 'TechCorp Indonesia'
      && parsed.location === 'Jakarta Selatan'
      && parsed.postedAt != null) {
    pass('parseJobstreetItem extracts title, url, company, location, postedAt correctly');
  } else {
    fail(`parseJobstreetItem returned ${JSON.stringify(parsed)}`);
  }

  // parseJobstreetItem — builds URL from id (URL is always derived, not read from the item)
  const idOnlyItem = { id: '999', title: 'Role' };
  const idOnlyParsed = parseJobstreetItem(idOnlyItem, 'https://id.jobstreet.com', 'Co');
  if (idOnlyParsed && idOnlyParsed.url === 'https://id.jobstreet.com/id/job/999') {
    pass('parseJobstreetItem builds job URL from id');
  } else {
    fail(`parseJobstreetItem id-based URL: ${JSON.stringify(idOnlyParsed)}`);
  }

  // parseJobstreetItem — rejects items without title
  if (parseJobstreetItem({ id: '1' }, 'https://id.jobstreet.com', 'Co') === null) {
    pass('parseJobstreetItem returns null for items without title');
  } else {
    fail('parseJobstreetItem should return null for title-less items');
  }

  // parseJobstreetItem — rejects items without id
  if (parseJobstreetItem({ title: 'Role' }, 'https://id.jobstreet.com', 'Co') === null) {
    pass('parseJobstreetItem returns null for items without id');
  } else {
    fail('parseJobstreetItem should return null for id-less items');
  }

  // parseJobstreetItem — rejects when built URL resolves off-domain (origin not in allowlist)
  const offDomain = parseJobstreetItem(
    { id: '1', title: 'Role' },
    'https://evil.example.com', 'Co'
  );
  if (offDomain === null) pass('parseJobstreetItem rejects off-domain origins');
  else fail(`parseJobstreetItem should reject off-domain origins, got ${JSON.stringify(offDomain)}`);

  // parseJobstreetItem — handles null/malformed input safely
  if (parseJobstreetItem(null, 'https://id.jobstreet.com', 'Co') === null) pass('parseJobstreetItem(null) → null');
  else fail('parseJobstreetItem(null) should return null');
  if (parseJobstreetItem(7, 'https://id.jobstreet.com', 'Co') === null) pass('parseJobstreetItem(7) → null');
  else fail('parseJobstreetItem(number) should return null');

  // parseJobstreetItem — fallback company when advertiser/companyName are missing
  const noBrand = parseJobstreetItem(
    { id: '1', title: 'Engineer' },
    'https://id.jobstreet.com', 'PortalFallback'
  );
  if (noBrand && noBrand.company === 'PortalFallback') {
    pass('parseJobstreetItem uses fallback company when advertiser/companyName are absent');
  } else {
    fail(`parseJobstreetItem fallback company: ${JSON.stringify(noBrand)}`);
  }

  // parseJobstreetItem — companyName used when advertiser.description is missing
  const companyNameOnly = parseJobstreetItem(
    { id: '1', title: 'Engineer', companyName: 'ShortCo' },
    'https://id.jobstreet.com', 'PortalFallback'
  );
  if (companyNameOnly && companyNameOnly.company === 'ShortCo') {
    pass('parseJobstreetItem falls back to companyName when advertiser.description is absent');
  } else {
    fail(`parseJobstreetItem companyName fallback: ${JSON.stringify(companyNameOnly)}`);
  }

  // parseJobstreetItem — handles missing locations gracefully (upstream #1499 union).
  const noLocItem = {
    id: '42',
    title: 'Remote Engineer',
    advertiser: { description: 'RemoteCo' },
    listingDate: '2026-06-15T00:00:00Z',
  };
  const noLocParsed = parseJobstreetItem(noLocItem, 'https://id.jobstreet.com', 'Fallback');
  if (noLocParsed && noLocParsed.location === '') {
    pass('parseJobstreetItem handles missing locations gracefully');
  } else {
    fail(`parseJobstreetItem empty location: ${JSON.stringify(noLocParsed)}`);
  }

  // fetch() — happy path with mock context
  const mockCtx = {
    transport: 'http',
    fetchJson: async (url) => {
      if (!url.startsWith('https://id.jobstreet.com/')) throw new Error('Unexpected URL');
      return {
        data: [
          { id: '1', title: 'AI Engineer', advertiser: { description: 'TestCo' }, locations: [{ label: 'Remote' }], listingDate: '2026-01-01T00:00:00Z' },
        ],
      };
    },
    fetchText: async () => { throw new Error('should not be called'); },
  };
  const jobs = await jobstreet.fetch(
    { name: 'Jobstreet ID', provider: 'jobstreet', searchKeywords: 'AI' },
    mockCtx,
  );
  if (jobs.length === 1 && jobs[0].title === 'AI Engineer') pass('jobstreet.fetch() returns parsed jobs');
  else fail(`jobstreet.fetch() returned ${JSON.stringify(jobs)}`);

  // fetch() — handles empty results
  const emptyCtx = {
    transport: 'http',
    fetchJson: async () => ({ data: [] }),
    fetchText: async () => { throw new Error('should not be called'); },
  };
  const emptyJobs = await jobstreet.fetch(
    { name: 'Jobstreet ID', provider: 'jobstreet', searchKeywords: 'nonexistent' },
    emptyCtx,
  );
  if (emptyJobs.length === 0) pass('jobstreet.fetch() handles empty results');
  else fail(`jobstreet.fetch() should return empty array for no results, got ${emptyJobs.length}`);

  // fetch() — rejects invalid hostname
  let hostRejected = false;
  try {
    await jobstreet.fetch(
      { name: 'Bad', provider: 'jobstreet', api: 'https://evil.example.com/api/search' },
      { transport: 'http', fetchJson: async () => ({}), fetchText: async () => '' },
    );
  } catch (e) {
    if (e.message.includes('untrusted hostname')) hostRejected = true;
    else fail(`jobstreet.fetch() host rejection wrong error: ${e.message}`);
  }
  if (hostRejected) pass('jobstreet.fetch() rejects untrusted hostnames');
  else fail('jobstreet.fetch() should reject non-jobstreet hostnames');

  // fetch() — handles non-array data field
  const badDataCtx = {
    transport: 'http',
    fetchJson: async () => ({ data: null }),
    fetchText: async () => { throw new Error('should not be called'); },
  };
  const badDataJobs = await jobstreet.fetch(
    { name: 'Jobstreet ID', provider: 'jobstreet', searchKeywords: 'test' },
    badDataCtx,
  );
  if (badDataJobs.length === 0) pass('jobstreet.fetch() handles null data field');
  else fail(`jobstreet.fetch() should return empty for null data`);

} catch (e) {
  fail(`jobstreet provider tests crashed: ${e.message}`);
}

// ── 23. PROVIDERS — Glints ─────────────────────────────────────────

