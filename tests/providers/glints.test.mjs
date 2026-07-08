// tests/providers/glints.test.mjs — moved from test-all.mjs (test-layout migration).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\n23. Provider — glints');

try {
  const glints = (await import(pathToFileURL(join(ROOT, 'providers/glints.mjs')).href)).default;
  const { parseGlintsItem } = await import(pathToFileURL(join(ROOT, 'providers/glints.mjs')).href);

  // id check
  if (glints.id === 'glints') pass('glints.id is "glints"');
  else fail(`glints.id is ${JSON.stringify(glints.id)}`);

  // detect() always returns null (job board, not ATS)
  if (glints.detect({ name: 'X', careers_url: 'https://glints.com/id/jobs' }) === null) {
    pass('glints.detect() returns null — explicit provider only, no URL auto-detection');
  } else {
    fail('glints.detect() should return null for any URL');
  }

  // parseGlintsItem — valid item (searchJobsV3 shape: company.name, city.name, createdAt, id-based URL)
  const sampleItem = {
    id: 'abc123',
    title: 'Backend Engineer',
    company: { name: 'StartupCorp', brandName: 'Startup' },
    city: { name: 'Jakarta, Indonesia' },
    country: { code: 'ID', name: 'Indonesia' },
    createdAt: '2026-06-10T00:00:00Z',
  };
  const parsed = parseGlintsItem(sampleItem, 'https://glints.com', 'FallbackCo');
  if (parsed && parsed.title === 'Backend Engineer'
      && parsed.url === 'https://glints.com/id/opportunities/jobs/abc123'
      && parsed.company === 'StartupCorp'
      && parsed.location === 'Jakarta, Indonesia'
      && parsed.postedAt != null) {
    pass('parseGlintsItem extracts title, url, company, location, postedAt correctly');
  } else {
    fail(`parseGlintsItem returned ${JSON.stringify(parsed)}`);
  }

  // parseGlintsItem — builds URL from id (URL is always derived, not read from the item)
  const idOnlyItem = { id: 'x', title: 'Dev' };
  const idOnlyParsed = parseGlintsItem(idOnlyItem, 'https://glints.com', 'Co');
  if (idOnlyParsed && idOnlyParsed.url === 'https://glints.com/id/opportunities/jobs/x') {
    pass('parseGlintsItem builds job URL from id');
  } else {
    fail(`parseGlintsItem id-based URL: ${JSON.stringify(idOnlyParsed)}`);
  }

  // parseGlintsItem — rejects items without title
  if (parseGlintsItem({ id: '1' }, 'https://glints.com', 'Co') === null) {
    pass('parseGlintsItem returns null for title-less items');
  } else {
    fail('parseGlintsItem should return null for items without title');
  }

  // parseGlintsItem — rejects items without id
  if (parseGlintsItem({ title: 'Role' }, 'https://glints.com', 'Co') === null) {
    pass('parseGlintsItem returns null for id-less items');
  } else {
    fail('parseGlintsItem should return null for items without id');
  }

  // parseGlintsItem — rejects when built URL resolves off-domain (baseUrl not in allowlist)
  const offDomain = parseGlintsItem(
    { id: '1', title: 'Role' },
    'https://evil.example.com', 'Co'
  );
  if (offDomain === null) pass('parseGlintsItem rejects off-domain base URLs');
  else fail(`parseGlintsItem should reject off-domain base URLs, got ${JSON.stringify(offDomain)}`);

  // parseGlintsItem — allows subdomains of glints.com
  const subdomainItem = parseGlintsItem(
    { id: 'role-1', title: 'Role' },
    'https://www.glints.com', 'Co'
  );
  if (subdomainItem && subdomainItem.url === 'https://www.glints.com/id/opportunities/jobs/role-1') {
    pass('parseGlintsItem accepts www.glints.com subdomain base URLs');
  } else {
    fail(`parseGlintsItem subdomain URL rejected: ${JSON.stringify(subdomainItem)}`);
  }

  // parseGlintsItem — handles null/malformed input
  if (parseGlintsItem(null, 'https://glints.com', 'Co') === null) pass('parseGlintsItem(null) → null');
  else fail('parseGlintsItem(null) should return null');
  if (parseGlintsItem(42, 'https://glints.com', 'Co') === null) pass('parseGlintsItem(number) → null');
  else fail('parseGlintsItem(number) should return null');

  // parseGlintsItem — fallback company when company.name/brandName are missing
  const noCompany = parseGlintsItem(
    { id: 'eng-1', title: 'Engineer' },
    'https://glints.com', 'PortalName'
  );
  if (noCompany && noCompany.company === 'PortalName') {
    pass('parseGlintsItem uses fallback company when company.name/brandName are absent');
  } else {
    fail(`parseGlintsItem fallback company: ${JSON.stringify(noCompany)}`);
  }

  // parseGlintsItem — company.brandName used when company.name is missing
  const brandNameOnly = parseGlintsItem(
    { id: 'eng-2', title: 'Engineer', company: { brandName: 'BrandOnlyCo' } },
    'https://glints.com', 'PortalName'
  );
  if (brandNameOnly && brandNameOnly.company === 'BrandOnlyCo') {
    pass('parseGlintsItem falls back to company.brandName when company.name is absent');
  } else {
    fail(`parseGlintsItem brandName fallback: ${JSON.stringify(brandNameOnly)}`);
  }

  // fetch() — happy path with mock context
  const mockCtx = {
    transport: 'http',
    fetchJson: async (url, opts) => {
      if (opts?.method !== 'POST') throw new Error('Expected POST');
      const body = JSON.parse(opts.body || '{}');
      if (body.operationName !== 'searchJobsV3') throw new Error('Expected searchJobsV3 operation');
      if (!body.query) throw new Error('Expected GraphQL query');
      return {
        data: {
          searchJobsV3: {
            jobsInPage: [
              { id: '1', title: 'AI PM', company: { name: 'TechCo' }, city: { name: 'Remote' }, createdAt: '2026-01-01T00:00:00Z' },
            ],
            hasMore: false,
          },
        },
      };
    },
    fetchText: async () => { throw new Error('should not be called'); },
  };
  const jobs = await glints.fetch(
    { name: 'Glints ID', provider: 'glints', searchKeywords: 'AI' },
    mockCtx,
  );
  if (jobs.length === 1 && jobs[0].title === 'AI PM') pass('glints.fetch() returns parsed jobs via GraphQL');
  else fail(`glints.fetch() returned ${JSON.stringify(jobs)}`);

  // fetch() — handles empty results
  const emptyCtx = {
    transport: 'http',
    fetchJson: async () => ({ data: { searchJobsV3: { jobsInPage: [], hasMore: false } } }),
    fetchText: async () => { throw new Error('should not be called'); },
  };
  const emptyJobs = await glints.fetch(
    { name: 'Glints ID', provider: 'glints', searchKeywords: 'nonexistent' },
    emptyCtx,
  );
  if (emptyJobs.length === 0) pass('glints.fetch() handles empty results');
  else fail(`glints.fetch() should return empty array for no results, got ${emptyJobs.length}`);

  // fetch() — stops pagination when hasMore is false even if a full page is returned
  const hasMoreFalseCtx = {
    transport: 'http',
    fetchJson: async () => ({
      data: {
        searchJobsV3: {
          jobsInPage: [
            { id: '1', title: 'Dev', company: { name: 'Co' }, city: { name: 'Remote' } },
          ],
          hasMore: false,
        },
      },
    }),
    fetchText: async () => { throw new Error('should not be called'); },
  };
  const hasMoreFalseJobs = await glints.fetch(
    { name: 'Glints ID', provider: 'glints', searchKeywords: 'dev', pageSize: 1, maxPages: 5 },
    hasMoreFalseCtx,
  );
  if (hasMoreFalseJobs.length === 1) pass('glints.fetch() respects hasMore: false to stop pagination');
  else fail(`glints.fetch() hasMore stop: ${JSON.stringify(hasMoreFalseJobs)}`);

  // fetch() — rejects invalid hostname
  let hostRejected = false;
  try {
    await glints.fetch(
      { name: 'Bad', provider: 'glints', api: 'https://evil.example.com/graphql' },
      { transport: 'http', fetchJson: async () => ({}), fetchText: async () => '' },
    );
  } catch (e) {
    if (e.message.includes('untrusted hostname')) hostRejected = true;
    else fail(`glints.fetch() host rejection wrong error: ${e.message}`);
  }
  if (hostRejected) pass('glints.fetch() rejects untrusted hostnames');
  else fail('glints.fetch() should reject non-glints hostnames');

  // fetch() — throws on missing jobsInPage in response
  let missingThrew = false;
  try {
    await glints.fetch(
      { name: 'Glints ID', provider: 'glints', searchKeywords: 'test' },
      {
        transport: 'http',
        fetchJson: async () => ({ data: { searchJobsV3: { somethingElse: [] } } }),
        fetchText: async () => { throw new Error('should not be called'); },
      },
    );
  } catch (e) {
    if (e.message.includes('unexpected API response')) missingThrew = true;
    else fail(`glints.fetch() missing jobsInPage wrong error: ${e.message}`);
  }
  if (missingThrew) pass('glints.fetch() throws on unexpected API response shape');
  else fail('glints.fetch() should throw when jobsInPage is missing');

} catch (e) {
  fail(`glints provider tests crashed: ${e.message}`);
}

