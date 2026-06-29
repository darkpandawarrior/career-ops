import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { enrichDiscoveryLead, isDiscoverableJob, parseDuckResults, refreshJobSearch } from '../search/job-search-runner.mjs';

test('fresh search uses active profile rules, scores results, and persists the cache', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-search-'));
  await mkdir(path.join(root, 'config'), { recursive: true });
  await mkdir(path.join(root, 'data'), { recursive: true });
  await writeFile(path.join(root, 'config', 'job-search.yml'), profileConfig());
  await writeFile(path.join(root, 'portals.yml'), 'tracked_companies: []\n');
  const fetchImpl = async (url) => {
    if (String(url).includes('remoteok.com')) return jsonResponse([]);
    if (String(url).includes('remotive.com')) return jsonResponse({ jobs: [] });
    if (String(url).includes('jobicy.com')) return jsonResponse({ jobs: [] });
    if (String(url).includes('himalayas.app')) return jsonResponse({ jobs: [] });
    if (String(url).includes('arbeitnow.com')) return jsonResponse({ data: [] });
    if (String(url).includes('workingnomads.com')) return jsonResponse([]);
    if (String(url).includes('solid.jobs')) return jsonResponse({ jobs: [] });
    return textResponse(`
      <a class="result__a" href="https://jobs.example.test/backend">
        Senior Backend Engineer Java PostgreSQL Docker Kafka - Northstar
      </a>
    `);
  };
  const payload = await refreshJobSearch(root, {
    fetchImpl,
    runScan: async () => ({ code: 0, stdout: 'scan complete', stderr: '' }),
    runWideScan: async () => ({ code: 0, stdout: 'reverse ATS scan complete', stderr: '' }),
  });
  assert.equal(payload.scored, true);
  assert.ok(payload.jobs.some((job) =>
    job.title.includes('Senior Backend Engineer')
    && job.company === 'Northstar'
    && job.score >= 7
  ));
  const cached = JSON.parse(await readFile(path.join(root, 'data', 'job-dashboard.json'), 'utf8'));
  assert.equal(cached.generatedAt, payload.generatedAt);
  assert.equal(cached.scored, true);
  assert.equal(payload.telemetry.lastRefresh, payload.generatedAt);
  assert.ok(payload.telemetry.durationMs >= 0);
  assert.deepEqual(payload.telemetry.sources.map((source) => source.id), [
    'career-ops-scan', 'reverse-ats', 'pipeline', 'scan-history',
    'tracked-companies', 'remote-feeds', 'generated-search',
  ]);
  assert.ok(payload.telemetry.sources.some((source) => source.jobs > 0));
  assert.ok(payload.telemetry.sources.filter((source) => source.status !== 'skipped').every((source) => source.freshness === 'fresh'));
  assert.ok(payload.telemetry.contributors.some((source) => source.source && source.jobs > 0));
});

test('source telemetry records failures and skipped scopes without failing refresh', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-search-'));
  await mkdir(path.join(root, 'config'), { recursive: true });
  await writeFile(path.join(root, 'config', 'job-search.yml'), profileConfig().replace('preferred_locations: [India, Remote]', 'preferred_locations: [India]').replace('remote_regions: [Worldwide]', 'remote_regions: []').replace('visa_sponsorship_required: false', 'search_scopes: [local]\n  visa_sponsorship_required: false'));
  await writeFile(path.join(root, 'portals.yml'), 'tracked_companies: []\n');
  const payload = await refreshJobSearch(root, {
    fetchImpl: async () => { throw new Error('source unavailable'); },
    runScan: async () => ({ code: 1, stdout: '', stderr: 'scan failed' }),
    runWideScan: async () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const scan = payload.telemetry.sources.find((source) => source.id === 'career-ops-scan');
  const remote = payload.telemetry.sources.find((source) => source.id === 'remote-feeds');
  const search = payload.telemetry.sources.find((source) => source.id === 'generated-search');
  assert.equal(scan.status, 'failed');
  assert.equal(remote.status, 'skipped');
  assert.equal(search.status, 'partial');
  assert.ok(search.failures > 0);
});

test('a discovery lead can be verified and promoted into ranked jobs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-search-'));
  await mkdir(path.join(root, 'config'), { recursive: true });
  await mkdir(path.join(root, 'data'), { recursive: true });
  await writeFile(path.join(root, 'config', 'job-search.yml'), profileConfig());
  await writeFile(path.join(root, 'portals.yml'), 'tracked_companies: []\n');
  const initial = await refreshJobSearch(root, {
    fetchImpl: async () => textResponse(''),
    runScan: async () => ({ code: 0, stdout: '', stderr: '' }),
    runWideScan: async () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const lead = initial.jobs.find((job) => job.type === 'searchLead' && job.discoveryQuery);
  assert.ok(lead);
  assert.equal(initial.leadEnrichmentBatch.attempted, 4);
  assert.equal(initial.leadEnrichmentBatch.promotedJobs, 0);
  const result = await enrichDiscoveryLead(root, lead.id, {
    fetchImpl: async () => textResponse('<a class="result__a" href="https://jobs.example.test/promoted">Senior Backend Engineer Java PostgreSQL Docker Kafka - Promoted Co</a>'),
  });
  assert.equal(result.status, 'promoted');
  assert.ok(result.jobs.some((job) => job.company === 'Promoted Co' && job.score >= 7));
  const cache = JSON.parse(await readFile(path.join(root, 'data', 'job-dashboard.json'), 'utf8'));
  assert.equal(cache.jobs.some((job) => job.id === lead.id), false);
  assert.ok(cache.jobs.some((job) => job.company === 'Promoted Co'));
});

test('DuckDuckGo result parsing preserves source and job URL', () => {
  const jobs = parseDuckResults(
    '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fjobs.example.test%2F42">Platform Engineer | Example Corp</a>',
    { name: 'Configured source', category: 'ats' },
  );
  assert.equal(jobs[0].company, 'Example Corp');
  assert.equal(jobs[0].source, 'Configured source');
  assert.equal(jobs[0].url, 'https://jobs.example.test/42');
});

test('broad feeds do not admit unrelated jobs with neutral profile scoring', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-search-'));
  await mkdir(path.join(root, 'config'), { recursive: true });
  await writeFile(path.join(root, 'config', 'job-search.yml'), profileConfig());
  await writeFile(path.join(root, 'portals.yml'), 'tracked_companies: []\n');
  const fetchImpl = async (url) => {
    if (String(url).includes('remoteok.com')) return jsonResponse([]);
    if (String(url).includes('remotive.com')) return jsonResponse({
      jobs: [{
        title: 'Staff Product Engineer',
        company_name: 'Unrelated Co',
        candidate_required_location: 'Worldwide',
        url: 'https://example.test/unrelated',
        description: 'Product strategy and team leadership.',
      }],
    });
    if (String(url).includes('jobicy.com')) return jsonResponse({ jobs: [] });
    if (String(url).includes('himalayas.app')) return jsonResponse({ jobs: [] });
    if (String(url).includes('arbeitnow.com')) return jsonResponse({ data: [] });
    if (String(url).includes('workingnomads.com')) return jsonResponse([]);
    if (String(url).includes('solid.jobs')) return jsonResponse({ jobs: [] });
    return textResponse('');
  };
  const payload = await refreshJobSearch(root, {
    fetchImpl,
    runScan: async () => ({ code: 0, stdout: '', stderr: '' }),
    runWideScan: async () => ({ code: 0, stdout: '', stderr: '' }),
  });
  assert.equal(payload.jobs.some((job) => job.url === 'https://example.test/unrelated'), false);
});

test('adjacent titles require supporting profile evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-search-'));
  await mkdir(path.join(root, 'config'), { recursive: true });
  await writeFile(path.join(root, 'config', 'job-search.yml'), profileConfig());
  await writeFile(path.join(root, 'portals.yml'), 'tracked_companies: []\n');
  const fetchImpl = async () => textResponse(`
    <a class="result__a" href="https://jobs.example.test/generic">
      Platform Engineer Product Strategy - Generic Co
    </a>
  `);
  const payload = await refreshJobSearch(root, {
    fetchImpl,
    runScan: async () => ({ code: 0, stdout: '', stderr: '' }),
    runWideScan: async () => ({ code: 0, stdout: '', stderr: '' }),
  });
  assert.equal(payload.jobs.some((job) => job.url === 'https://jobs.example.test/generic'), false);
});

test('valid low-fit jobs are retained and the discovery funnel is observable', async () => {
  assert.equal(isDiscoverableJob({
    type: 'job', score: 1, matchedSkills: ['Java', 'PostgreSQL'], supportingSkills: [],
    snippet: 'Active role', freshness: { band: 'unknown' },
  }), true, 'fit score must not be an admission cutoff');
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-search-'));
  await mkdir(path.join(root, 'config'), { recursive: true });
  await writeFile(path.join(root, 'config', 'job-search.yml'), profileConfig());
  await writeFile(path.join(root, 'portals.yml'), 'tracked_companies: []\n');
  const payload = await refreshJobSearch(root, {
    fetchImpl: async () => textResponse(`
      <a class="result__a" href="https://jobs.example.test/low-fit">
        Backend Engineer Java PostgreSQL React remote US only must be based in US no visa sponsorship immediate joiner 12 years required - Low Fit Co
      </a>
    `),
    runScan: async () => ({ code: 0, stdout: '', stderr: '' }),
    runWideScan: async () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const job = payload.jobs.find((item) => item.url === 'https://jobs.example.test/low-fit');
  assert.ok(job, 'a relevant job below the old score-4 cutoff should remain visible');
  assert.ok(job.score <= 4);
  assert.ok(payload.telemetry.funnel.raw >= payload.telemetry.funnel.final);
  assert.equal(payload.telemetry.funnel.final, payload.jobs.filter((item) => item.type !== 'searchLead').length);
  assert.ok(payload.telemetry.funnel.unknownDate >= 1);
});

test('controlled discovery inventory produces 50 to 100 verified deduplicated jobs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-search-'));
  await mkdir(path.join(root, 'config'), { recursive: true });
  await writeFile(path.join(root, 'config', 'job-search.yml'), profileConfig());
  await writeFile(path.join(root, 'portals.yml'), 'tracked_companies: []\n');
  let searchCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes('remoteok.com')) return jsonResponse([]);
    if (String(url).includes('remotive.com')) return jsonResponse({ jobs: [] });
    if (String(url).includes('jobicy.com')) return jsonResponse({ jobs: [] });
    if (String(url).includes('himalayas.app')) return jsonResponse({ jobs: [] });
    if (String(url).includes('arbeitnow.com')) return jsonResponse({ data: [] });
    if (String(url).includes('workingnomads.com')) return jsonResponse([]);
    if (String(url).includes('solid.jobs')) return jsonResponse({ jobs: [] });
    const call = searchCalls++;
    const group = call < 7 ? call : 0;
    const results = Array.from({ length: 12 }, (_, index) => {
      const id = group * 12 + index;
      return `<a class="result__a" href="https://jobs.example.test/verified-${id}">
        Backend Engineer Java PostgreSQL Docker - Verified Company ${id}</a>`;
    }).join('');
    return textResponse(results);
  };
  const payload = await refreshJobSearch(root, {
    fetchImpl,
    runScan: async () => ({ code: 0, stdout: '', stderr: '' }),
    runWideScan: async () => ({ code: 0, stdout: '', stderr: '' }),
  });
  assert.equal(payload.telemetry.funnel.final, 84);
  assert.equal(payload.jobs.filter((job) => job.type !== 'searchLead').length, 84);
  assert.ok(payload.telemetry.funnel.duplicates > 0);
  assert.equal(payload.telemetry.funnel.unknownDate, payload.telemetry.funnel.verified);
});

function profileConfig() {
  return `
titles:
  strong: [Senior Backend Engineer, Backend Engineer]
  adjacent: [Platform Engineer]
  exclude: [Frontend Engineer]
skills:
  demonstrated: [Java, PostgreSQL]
  confirmed_unlisted: [Docker]
  supporting: [Kafka]
  learning: []
  recommended_gaps: [Terraform]
  excluded: [React]
seniority:
  minimum_years: 4
  maximum_years: 8
  preferred_levels: [senior]
location:
  home_country: India
  preferred_locations: [India, Remote]
  remote_eligibility_required: true
  remote_regions: [Worldwide]
  relocation: open
  visa_sponsorship_required: false
compensation:
  home_country: { currency: INR, minimum_annual: 2500000 }
  remote: { currency: null, minimum_annual: null }
  international: { currency: null, minimum_annual: null }
preferences:
  domains: []
  company_types: []
  negative_keywords: []
weights: { title: 30, skills: 35, experience: 10, location: 15, preferences: 10 }
`;
}

function jsonResponse(value) {
  return { ok: true, status: 200, json: async () => value };
}

function textResponse(value) {
  return { ok: true, status: 200, text: async () => value };
}
