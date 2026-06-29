import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import yaml from 'js-yaml';

import {
  confirmProfile,
  finalizeProfileReplacement,
  generateUserFiles,
  previewProfileActivation,
  rollbackProfileReplacement,
  validateGeneratedFiles,
} from '../onboarding/profile-writer.mjs';
import { validatePortalsConfig } from '../../validate-portals.mjs';

const DRAFT_ID = '12345678-1234-4234-8234-123456789012';

test('generates valid career-ops user files from a reviewed draft', async () => {
  const files = generateUserFiles(review(), extraction());
  const validation = validateGeneratedFiles(files);
  assert.equal(validation.valid, true, validation.errors.join('; '));
  assert.equal(yaml.load(files['config/profile.yml']).candidate.full_name, 'Alex Morgan');
  assert.equal(yaml.load(files['config/profile.yml']).availability.notice_period, '30 days');
  assert.ok(yaml.load(files['portals.yml']).tracked_companies.length >= 15);
  const searchConfig = yaml.load(files['config/job-search.yml']);
  assert.deepEqual(searchConfig.titles.interested, ['Senior Backend Engineer', 'Platform Engineer']);
  assert.equal(searchConfig.current_role, 'Senior Backend Engineer');
  assert.ok(searchConfig.skills.all.includes('Java'));
  assert.equal(searchConfig.skills.demonstrated, undefined);
  assert.deepEqual(searchConfig.skills.evidence.supporting, ['Kafka']);
  assert.deepEqual(yaml.load(files['config/job-search.yml']).location.search_scopes, ['local', 'remote']);
  assert.deepEqual(yaml.load(files['config/job-search.yml']).education, {
    levels: ["Bachelor's degree"],
    certifications: ['AWS Certified Developer'],
  });
  assert.deepEqual(yaml.load(files['portals.yml']).title_filter.positive, []);
  assert.deepEqual(yaml.load(files['portals.yml']).content_filter.positive.slice(0, 2), [
    'Java',
    'PostgreSQL',
  ]);
  assert.match(files['cv.md'], /^# Alex Morgan/m);
  assert.match(files['modes/_profile.md'], /Senior Backend Engineer/);
  const portalsValidation = await validatePortalsConfig(yaml.load(files['portals.yml']));
  assert.deepEqual(portalsValidation.errors, []);
});

test('activation replaces the old profile and retains rollback data only until search succeeds', async () => {
  const root = await setupRoot();
  await seedActiveProfile(root);
  const preview = await previewProfileActivation(root, DRAFT_ID);
  assert.equal(preview.valid, true);
  assert.equal(preview.files.find((file) => file.path === 'data/applications.md').action, 'replace');

  const result = await confirmProfile(root, DRAFT_ID);
  assert.equal(result.ok, true);
  assert.match(await readFile(path.join(root, 'cv.md'), 'utf8'), /Alex Morgan/);
  assert.match(await readFile(path.join(root, 'data', 'applications.md'), 'utf8'), /Applications Tracker/);
  assert.equal(
    await readFile(path.join(root, 'data', 'onboarding-drafts', DRAFT_ID, 'activation-transaction', 'rollback', 'cv.md'), 'utf8'),
    'OLD CV',
  );
  await assert.rejects(access(path.join(root, 'data', 'job-dashboard.json')));
  await assert.rejects(access(path.join(root, 'data', 'cache')));
  assert.equal(yaml.load(await readFile(path.join(root, 'config', 'profile.yml'), 'utf8')).candidate.full_name, 'Alex Morgan');
  await mkdir(path.join(root, 'data', 'profile-archives', 'old'), { recursive: true });
  await writeFile(path.join(root, 'data', 'profile-archives', 'old', 'cv.md'), 'OLDER CV');
  await finalizeProfileReplacement(root, DRAFT_ID);
  await assert.rejects(access(path.join(root, 'data', 'profile-archives')));
  await assert.rejects(access(path.join(root, 'data', 'onboarding-drafts', DRAFT_ID)));
});

test('failed post-activation search can restore the previous profile', async () => {
  const root = await setupRoot();
  await seedActiveProfile(root);
  await confirmProfile(root, DRAFT_ID);
  await rollbackProfileReplacement(root, DRAFT_ID);
  assert.equal(await readFile(path.join(root, 'cv.md'), 'utf8'), 'OLD CV');
  assert.equal(await readFile(path.join(root, 'data', 'applications.md'), 'utf8'), 'EXISTING TRACKER');
});

test('activation refuses an unreviewed draft without touching active files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-activation-'));
  const draftPath = path.join(root, 'data', 'onboarding-drafts', DRAFT_ID);
  await mkdir(draftPath, { recursive: true });
  await writeFile(path.join(root, 'cv.md'), 'UNCHANGED');
  await writeFile(path.join(draftPath, 'extraction.json'), JSON.stringify(extraction()));
  await assert.rejects(
    confirmProfile(root, DRAFT_ID),
    (error) => error.code === 'review_required' && error.status === 409,
  );
  assert.equal(await readFile(path.join(root, 'cv.md'), 'utf8'), 'UNCHANGED');
});

async function setupRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-activation-'));
  const draftPath = path.join(root, 'data', 'onboarding-drafts', DRAFT_ID);
  await mkdir(draftPath, { recursive: true });
  await writeFile(path.join(draftPath, 'review.json'), JSON.stringify(review()));
  await writeFile(path.join(draftPath, 'extraction.json'), JSON.stringify(extraction()));
  await writeFile(path.join(draftPath, 'metadata.json'), JSON.stringify({ draftId: DRAFT_ID, status: 'reviewed' }));
  return root;
}

async function seedActiveProfile(root) {
  await mkdir(path.join(root, 'config'), { recursive: true });
  await mkdir(path.join(root, 'modes'), { recursive: true });
  await mkdir(path.join(root, 'data'), { recursive: true });
  await writeFile(path.join(root, 'cv.md'), 'OLD CV');
  await writeFile(path.join(root, 'config', 'profile.yml'), 'candidate:\n  full_name: Old Candidate\n');
  await writeFile(path.join(root, 'config', 'job-search.yml'), 'titles:\n  strong: [Old Role]\nskills:\n  demonstrated: [Old Skill]\n');
  await writeFile(path.join(root, 'modes', '_profile.md'), '# Old profile');
  await writeFile(path.join(root, 'portals.yml'), 'title_filter:\n  positive: [Old Role]\nsearch_queries:\n  - name: Old\n    query: Old\n');
  await writeFile(path.join(root, 'data', 'applications.md'), 'EXISTING TRACKER');
  await writeFile(path.join(root, 'data', 'pipeline.md'), 'EXISTING PIPELINE');
  await writeFile(path.join(root, 'data', 'scan-history.tsv'), 'EXISTING HISTORY');
  await writeFile(path.join(root, 'data', 'job-dashboard.json'), '{"jobs":[{"title":"stale"}]}');
  await mkdir(path.join(root, 'data', 'cache'), { recursive: true });
  await writeFile(path.join(root, 'data', 'cache', 'stale.json'), '{"stale":true}');
}

function review() {
  return {
    version: 1,
    draftId: DRAFT_ID,
    status: 'reviewed',
    candidate: {
      full_name: 'Alex Morgan',
      email: 'alex@example.test',
      phone: '+1 555 0100',
      location: 'Toronto, Canada',
      linkedin: 'linkedin.com/in/alex',
      github: '',
      portfolio_url: 'example.test/alex',
    },
    summary: 'Backend engineer building reliable platforms.',
    experience_years: 6,
    seniority: 'senior',
    target_roles: ['Senior Backend Engineer'],
    adjacent_roles: ['Platform Engineer'],
    excluded_titles: ['Frontend Engineer'],
    skills: {
      demonstrated: ['Java', 'PostgreSQL', 'Docker', 'Git', 'REST APIs'],
      confirmed_unlisted: ['Docker'],
      supporting: ['Kafka'],
      learning: ['Kubernetes'],
      excluded: ['React'],
    },
    location: {
      home_country: 'Canada',
      preferred_locations: ['Canada', 'Remote'],
      remote_eligibility_required: true,
      remote_regions: ['Worldwide'],
      relocation: 'open',
      search_scopes: ['local', 'remote'],
      international_locations: [],
      visa_sponsorship_required: false,
    },
    availability: {
      notice_period: '30 days',
    },
    compensation: {
      currency: 'CAD',
      minimum_annual: 140000,
      target_annual: 165000,
    },
  };
}

function extraction() {
  return {
    draftId: DRAFT_ID,
    sections: [
      { key: 'header', title: 'Header', text: 'Alex Morgan\nalex@example.test' },
      { key: 'summary', title: 'Summary', text: 'Backend engineer building reliable platforms.' },
      { key: 'experience', title: 'Experience', text: 'Senior Backend Engineer\n2020 - Current' },
      { key: 'skills', title: 'Skills', text: 'Java, PostgreSQL, Docker' },
      { key: 'education', title: 'Education', text: 'Bachelor of Technology in Computer Science' },
      { key: 'certifications', title: 'Certifications', text: 'AWS Certified Developer' },
    ],
  };
}
