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

  // parseJobstreetItem — job-detail path is host-aware: only the Indonesian
  // sites use the /id/ locale prefix; seek.com.au & co serve /job/<id>
  const auParsed = parseJobstreetItem({ id: '94036672', title: 'Strategy Consultant' }, 'https://www.seek.com.au', 'Co');
  if (auParsed && auParsed.url === 'https://www.seek.com.au/job/94036672') {
    pass('parseJobstreetItem builds /job/<id> for www.seek.com.au (no /id/ locale prefix)');
  } else {
    fail(`parseJobstreetItem seek.com.au url was ${JSON.stringify(auParsed && auParsed.url)}`);
  }
  const sgParsed = parseJobstreetItem({ id: '94244276', title: 'Analyst' }, 'https://sg.jobstreet.com', 'Co');
  if (sgParsed && sgParsed.url === 'https://sg.jobstreet.com/job/94244276') {
    pass('parseJobstreetItem builds /job/<id> for sg.jobstreet.com');
  } else {
    fail(`parseJobstreetItem sg.jobstreet.com url was ${JSON.stringify(sgParsed && sgParsed.url)}`);
  }

  // parseJobstreetItem — appendWorkType is opt-in and suffixes the title
  const wtItem = { id: '1', title: 'Strategy Consultant', workTypes: ['Part time'] };
  const wtOff = parseJobstreetItem(wtItem, 'https://www.seek.com.au', 'Co');
  const wtOn = parseJobstreetItem(wtItem, 'https://www.seek.com.au', 'Co', { appendWorkType: true });
  if (wtOff && wtOff.title === 'Strategy Consultant'
      && wtOn && wtOn.title === 'Strategy Consultant [Part time]') {
    pass('parseJobstreetItem appends work type to the title only when appendWorkType is set');
  } else {
    fail(`appendWorkType titles were off=${JSON.stringify(wtOff && wtOff.title)} on=${JSON.stringify(wtOn && wtOn.title)}`);
  }
  const wtNone = parseJobstreetItem({ id: '2', title: 'Analyst' }, 'https://www.seek.com.au', 'Co', { appendWorkType: true });
  if (wtNone && wtNone.title === 'Analyst') pass('parseJobstreetItem leaves the title alone when workTypes is absent');
  else fail(`appendWorkType with no workTypes gave ${JSON.stringify(wtNone && wtNone.title)}`);

  // fetch() — appendWorkType on the portal entry flows through to parsed titles
  const auJobs = await jobstreet.fetch(
    {
      name: 'SEEK AU',
      provider: 'jobstreet',
      api: 'https://www.seek.com.au/api/jobsearch/v5/search',
      siteKey: 'AU-Main',
      searchKeywords: 'strategy',
      appendWorkType: true,
    },
    {
      transport: 'http',
      fetchJson: async () => ({
        data: [{ id: '94036672', title: 'Strategy Consultant', workTypes: ['Part time'], locations: [{ label: 'Melbourne VIC' }] }],
        totalCount: 1,
      }),
      fetchText: async () => { throw new Error('should not be called'); },
    },
  );
  if (auJobs.length === 1 && auJobs[0].title === 'Strategy Consultant [Part time]'
      && auJobs[0].url === 'https://www.seek.com.au/job/94036672') {
    pass('jobstreet.fetch() honours entry.appendWorkType and builds seek.com.au /job/ links');
  } else {
    fail(`jobstreet.fetch() SEEK AU gave ${JSON.stringify(auJobs)}`);
  }

  // parseJobstreetItem — uses companyName fallback when advertiser.description is absent
  const noAdvertiserItem = {
    id: '2',
    title: 'Data Scientist',
    companyName: 'TechCorp',
    locations: [{ label: 'Jakarta' }],
    listingDate: '2026-06-01T00:00:00Z',
  };
  const noAdvParsed = parseJobstreetItem(noAdvertiserItem, 'https://id.jobstreet.com', 'Fallback');
  if (noAdvParsed && noAdvParsed.company === 'TechCorp') {
    pass('parseJobstreetItem falls back to companyName when advertiser.description is absent');
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

  // fetch() — accepts SEEK's Hong Kong host (JobsDB brand, same v5 API)
  let hkReached = false;
  const hkJobs = await jobstreet.fetch(
    {
      name: 'JobsDB HK',
      provider: 'jobstreet',
      api: 'https://hk.jobsdb.com/api/jobsearch/v5/search',
      siteKey: 'HK-Main',
      searchKeywords: 'business intelligence',
    },
    {
      transport: 'http',
      fetchJson: async (url) => {
        hkReached = String(url).startsWith('https://hk.jobsdb.com/');
        return { data: [], totalCount: 0 };
      },
      fetchText: async () => { throw new Error('should not be called'); },
    },
  );
  if (hkReached && hkJobs.length === 0) pass('jobstreet.fetch() accepts hk.jobsdb.com (HK-Main)');
  else fail('jobstreet.fetch() should accept hk.jobsdb.com and query it directly');

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

