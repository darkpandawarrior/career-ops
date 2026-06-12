import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { validateJobSearchConfig } from '../search/config-schema.mjs';
import { buildSearchPlan } from '../search/query-builder.mjs';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const config = yaml.load(await readFile(path.join(fixtures, 'backend-profile.yml'), 'utf8'));

test('validates and normalizes a reviewed profile', () => {
  const result = validateJobSearchConfig(config);
  assert.equal(result.valid, true);
  assert.equal(Math.round(Object.values(result.config.weights).reduce((sum, value) => sum + value, 0)), 100);
  assert.deepEqual(result.config.skills.learning, ['Kubernetes']);
});

test('builds discovery queries only from skills, experience stage, and location', () => {
  const plan = buildSearchPlan(config, { sources: ['greenhouse', 'ashby'] });
  assert.equal(plan.queries.length, 4);
  assert.ok(plan.queries.every((item) => item.strategy === 'skills'));
  assert.ok(plan.queries.some((item) => item.query.includes('"Java"')));
  assert.ok(plan.queries.every((item) => !item.query.toLowerCase().includes('android')));
  assert.deepEqual(plan.portalConfig.title_filter.positive, []);
  assert.ok(plan.queries.every((item) => !item.query.includes('"Senior Backend Engineer"')));
});

test('search scopes independently enable remote, local, and international sources', () => {
  const remote = buildSearchPlan({
    ...config,
    location: { ...config.location, search_scopes: ['remote'], preferred_locations: [] },
  }, { sources: ['greenhouse', 'remote-api-boards'] });
  assert.equal(remote.summary.sources, 2);
  assert.ok(remote.queries.every((item) => item.query.includes('"Remote"')));

  const local = buildSearchPlan({
    ...config,
    location: {
      ...config.location,
      search_scopes: ['local'],
      preferred_locations: ['Bangalore', 'India'],
    },
  }, { sources: ['greenhouse', 'remote-api-boards'] });
  assert.equal(local.summary.sources, 1);
  assert.ok(local.queries.every((item) => !item.query.includes('"Remote"')));

  const international = buildSearchPlan({
    ...config,
    location: {
      ...config.location,
      search_scopes: ['international'],
      international_locations: ['Germany', 'UK'],
    },
  });
  assert.ok(international.queries.some((item) => item.name.startsWith('Germany job portals')));
  assert.ok(international.queries.some((item) => item.name.startsWith('United Kingdom job portals')));
});

test('default search plan covers broad ATS, remote, startup, general, and regional sources', () => {
  const plan = buildSearchPlan(config);
  assert.ok(plan.summary.sources >= 20);
  assert.ok(plan.summary.queries >= 60);
  for (const category of ['ats', 'company', 'remote', 'aggregator', 'regional']) {
    assert.ok(plan.queries.some((query) => query.category === category), `missing ${category}`);
  }
});

test('early-career profiles prioritize internships, graduate boards, and local fresher portals', () => {
  const plan = buildSearchPlan({
    ...config,
    seniority: { minimum_years: 0, maximum_years: 2, preferred_levels: ['entry-level'] },
    location: {
      ...config.location,
      home_country: 'India',
      search_scopes: ['local', 'remote'],
    },
  });
  assert.ok(plan.queries.some((item) => item.name.startsWith('India internships and fresher opportunities')));
  assert.ok(plan.queries.some((item) => item.name.startsWith('Global graduate and internship boards')));
  assert.ok(plan.queries.some((item) => item.query.includes('internship')));
  assert.ok(!plan.queries.some((item) => item.name.startsWith('India technology and startup portals')));
});
