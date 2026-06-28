import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { normalizeJob } from '../scoring/scorer.mjs';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const config = yaml.load(await readFile(path.join(fixtures, 'backend-profile.yml'), 'utf8'));
const jobs = JSON.parse(await readFile(path.join(fixtures, 'jobs.json'), 'utf8'));

test('strong verified match scores highly without profession hardcoding', () => {
  const job = normalizeJob(jobs[0], config);
  assert.ok(job.score >= 8);
  assert.equal(job.titleMatch, 'Not scored');
  assert.ok(job.matchedSkills.includes('Java'));
  assert.equal(job.compensation.status, 'meets_minimum');
  assert.equal(job.section, 'recommended');
});

test('job title does not affect a skill-backed match', () => {
  const job = normalizeJob(jobs[1], config);
  assert.equal(job.titleMatch, 'Not scored');
  assert.ok(job.score >= 7);
  assert.equal(job.eligibility.status, 'open');
});

test('excluded skill caps the score while title is ignored', () => {
  const job = normalizeJob(jobs[2], config);
  assert.ok(job.score <= 4);
  assert.deepEqual(job.excludedSkillMatches, ['React']);
});

test('recommended missing skill is surfaced but receives no match credit', () => {
  const job = normalizeJob(jobs[3], config);
  assert.deepEqual(job.recommendedSkillGaps, ['Terraform']);
  assert.ok(!job.matchedSkills.includes('Terraform'));
  assert.equal(job.eligibility.status, 'blocked');
  assert.equal(job.eligibility.label, 'Restricted to US');
  assert.equal(job.section, 'review');
});

test('search scopes block incompatible remote and local postings', () => {
  const localOnly = normalizeJob({
    title: 'Senior Backend Engineer',
    company: 'Remote Example',
    location: 'Worldwide Remote',
    url: 'https://example.test/remote',
    description: 'Java Spring Boot PostgreSQL Docker',
  }, {
    ...config,
    location: { ...config.location, search_scopes: ['local'] },
  });
  assert.equal(localOnly.eligibility.status, 'blocked');
  assert.match(localOnly.eligibility.reason, /Remote roles were not selected/);

  const remoteOnly = normalizeJob({
    title: 'Senior Backend Engineer',
    company: 'Office Example',
    location: 'Bangalore, India',
    url: 'https://example.test/office',
    description: 'Java Spring Boot PostgreSQL Docker',
  }, {
    ...config,
    location: { ...config.location, search_scopes: ['remote'] },
  });
  assert.equal(remoteOnly.eligibility.status, 'blocked');
  assert.match(remoteOnly.eligibility.reason, /Local roles were not selected/);
});

test('international target locations are scored separately from local and remote scopes', () => {
  const job = normalizeJob({
    title: 'Senior Backend Engineer',
    company: 'Berlin Example',
    location: 'Berlin, Germany',
    url: 'https://example.test/germany',
    description: 'Java Spring Boot PostgreSQL Docker relocation support',
  }, {
    ...config,
    location: {
      ...config.location,
      search_scopes: ['international'],
      international_locations: ['Germany'],
    },
  });
  assert.equal(job.eligibility.status, 'relocation');
  assert.equal(job.eligibility.label, 'International target location');
});

test('the application fit score exposes all five weighted categories', () => {
  const job = normalizeJob(jobs[0], {
    ...config,
    weights: undefined,
  });
  assert.ok(job.score >= 8);
  assert.match(job.reasons.join(' '), /Notice period:/);
  assert.deepEqual(Object.keys(job.scoreBreakdown), ['skills', 'experience', 'eligibility', 'noticeEducation', 'other']);
  assert.equal(job.reasons.some((reason) => reason.startsWith('Title:')), false);
  assert.equal(job.reasons.some((reason) => reason.startsWith('Preferences:')), false);
});

test('education is neutral unless the posting explicitly requires it', () => {
  const base = {
    title: 'Unrelated wording',
    company: 'Example',
    location: 'Bengaluru, India',
    url: 'https://example.test/facts',
    description: 'Java PostgreSQL Docker. 5 years.',
  };
  const plain = normalizeJob(base, config);
  assert.equal(plain.educationStatus, 'neutral');
  const required = normalizeJob({ ...base, description: `${base.description} Bachelor's degree required.` }, config);
  assert.equal(required.educationStatus, 'verify');
  assert.ok(required.scoreRaw < plain.scoreRaw);
});

test('mandatory, preferred, related, and transferable skills are parsed from job text', () => {
  const job = normalizeJob({
    title: 'Backend Engineer', company: 'Layers', location: 'India', url: 'https://example.test/layers',
    description: 'Java and Spring Boot are required. AWS is preferred. Kafka powers the platform. Kubernetes exposure helps.',
  }, config);
  assert.deepEqual(job.skillRequirements.mandatory, ['Java', 'Spring Boot']);
  assert.deepEqual(job.skillRequirements.preferred, ['AWS']);
  assert.deepEqual(job.skillRequirements.related, ['Kafka']);
  assert.deepEqual(job.skillRequirements.transferable, ['Kubernetes']);
});

test('joining availability penalizes urgent roles when notice period is too long', () => {
  const base = {
    title: 'Senior Backend Engineer',
    company: 'Urgent Example',
    location: 'Bangalore, India',
    url: 'https://example.test/urgent',
    description: 'Java Spring Boot PostgreSQL Docker. Immediate joiner required.',
  };
  const immediate = normalizeJob(base, {
    ...config,
    availability: { notice_period: 'Immediate' },
  });
  const delayed = normalizeJob(base, {
    ...config,
    availability: { notice_period: '90 days' },
  });
  assert.equal(immediate.availabilityStatus, 'aligned');
  assert.equal(delayed.availabilityStatus, 'mismatch');
  assert.ok(immediate.scoreRaw > delayed.scoreRaw);
});

test('immediate availability is compatible with every stated joining window', () => {
  const job = normalizeJob({
    title: 'Senior Backend Engineer',
    company: 'Flexible Example',
    location: 'Bangalore, India',
    url: 'https://example.test/flexible',
    description: 'Java Spring Boot. Join within 60 days.',
  }, {
    ...config,
    availability: { notice_period: 'Immediate' },
  });
  assert.equal(job.availabilityStatus, 'aligned');
});

test('longer notice periods rank relaxed joining windows above immediate requirements', () => {
  const candidate = { ...config, availability: { notice_period: '15 days' } };
  const immediate = normalizeJob({
    title: 'Senior Backend Engineer', company: 'Urgent', location: 'India',
    url: 'https://example.test/now', description: 'Java Spring Boot. Immediate joiner required.',
  }, candidate);
  const relaxed = normalizeJob({
    title: 'Senior Backend Engineer', company: 'Relaxed', location: 'India',
    url: 'https://example.test/later', description: 'Java Spring Boot. Join within 30 days.',
  }, candidate);
  assert.ok(relaxed.scoreRaw > immediate.scoreRaw);
});

test('international roles without required sponsorship are blocked', () => {
  const job = normalizeJob({
    title: 'Senior Backend Engineer',
    company: 'Berlin Restricted',
    location: 'Berlin, Germany',
    url: 'https://example.test/restricted',
    description: 'Java Spring Boot. Must already have valid work authorization. No visa sponsorship.',
  }, {
    ...config,
    location: {
      ...config.location,
      search_scopes: ['international'],
      international_locations: ['Germany'],
      visa_sponsorship_required: true,
    },
  });
  assert.equal(job.eligibility.status, 'blocked');
});
