import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  inferProfile,
  inferProfileDraft,
  saveReviewDraft,
  validateReviewDraft,
} from '../onboarding/profile-inference.mjs';
import { structureResume } from '../onboarding/resume-normalizer.mjs';

const fixtureText = await readFile(new URL('./fixtures/fictional-resume.md', import.meta.url), 'utf8');

test('infers evidence-backed candidate facts, skills, roles, and experience', () => {
  const structured = structureResume(fixtureText);
  const inference = inferProfile({
    draftId: '12345678-1234-4234-8234-123456789012',
    text: structured.text,
    sections: structured.sections,
  });
  assert.equal(inference.candidate.full_name.value, 'Alex Morgan');
  assert.equal(inference.candidate.email.value, 'alex.morgan@example.test');
  assert.equal(inference.candidate.location.value, 'Toronto, Canada');
  assert.equal(inference.candidate.portfolio_url.value, 'example.test/alex');
  const now = new Date();
  const expectedYears = Math.round((((now.getUTCFullYear() - 2020) * 12 + now.getUTCMonth() + 1) / 12) * 10) / 10;
  assert.equal(inference.experience.total_years.value, expectedYears);
  assert.ok(inference.skills.some((skill) => skill.name === 'Java' && skill.confidence >= 0.9));
  assert.equal(inference.target_roles[0].name, 'Backend Engineer');
  assert.equal(inference.target_roles[0].suggested_fit, 'primary');
  assert.equal(inference.preferences.compensation.minimum_annual, null);
});

test('uses projects, simulations, education, and skills for entry-level targeting', () => {
  const structured = structureResume([
    'Anuja Ingale',
    '9340480514 | anujaingale41@gmail.com | github.com/anujaingale41-lab | linkedin.com/in/anuja-ingale-',
    '3aa17b1b3/',
    '',
    'PROFILE SUMMARY',
    'Detail-oriented Data Analyst skilled in SQL, Python, Tableau, Power BI, and Excel.',
    '',
    'TECHNICAL SKILLS',
    '• Programming: Python (Pandas, NumPy, Scikit-learn, Matplotlib, Seaborn)',
    '• Databases: SQL (MySQL, SQL Server)',
    '• Visualization Tools: Tableau, Power BI',
    '',
    'PROJECTS',
    'Carbon Emissions Data Analysis using SQL',
    'Built dashboards and analyzed sustainability trends.',
    '',
    'JOB SIMULATIONS',
    'Tata iQ Data Analytics (Forage) - Sep 2025',
    'Conducted EDA on financial datasets.',
    '',
    'EDUCATION',
    'NIT Bhopal - B.Tech in Materials and Metallurgical Engineering (2017-2021)',
  ].join('\n'));
  const inference = inferProfile({
    draftId: '12345678-1234-4234-8234-123456789012',
    text: structured.text,
    sections: structured.sections,
  });
  assert.equal(structured.diagnostics.readyForInference, true);
  assert.equal(inference.experience.total_years.value, null);
  assert.equal(inference.seniority.value, 'entry-level');
  assert.equal(inference.candidate.portfolio_url.value, '');
  assert.equal(inference.candidate.linkedin.value, 'linkedin.com/in/anuja-ingale-3aa17b1b3/');
  assert.ok(inference.target_roles.some((role) => role.name === 'Data Analyst' && role.suggested_fit === 'primary'));
  assert.ok(inference.target_roles.some((role) => role.name === 'Junior Data Analyst'));
  assert.ok(inference.target_roles.some((role) => role.name === 'Data Analyst Intern'));
  assert.ok(inference.skills.some((skill) => skill.name === 'SQL'));
  assert.ok(inference.skills.some((skill) => skill.name === 'Tableau'));
  assert.ok(!inference.skills.some((skill) => skill.name.startsWith('Programming:')));
});

test('persists inference only inside the ignored onboarding draft', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-infer-'));
  const draftId = '12345678-1234-4234-8234-123456789012';
  const draftPath = path.join(root, 'data', 'onboarding-drafts', draftId);
  const structured = structureResume(fixtureText);
  await mkdir(draftPath, { recursive: true });
  await writeFile(path.join(draftPath, 'extraction.json'), JSON.stringify({
    draftId,
    text: structured.text,
    sections: structured.sections,
  }));
  const inference = await inferProfileDraft(root, draftId);
  assert.equal(inference.candidate.full_name.value, 'Alex Morgan');
  assert.equal(JSON.parse(await readFile(path.join(draftPath, 'inference.json'), 'utf8')).version, 1);
});

test('requires explicit targeting, skill, home-country, and compensation validation', () => {
  const invalid = validateReviewDraft({
    candidate: { full_name: '' },
    target_roles: [],
    skills: { demonstrated: [] },
    location: { home_country: '' },
    compensation: { minimum_annual: 100000, currency: '' },
  });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.length >= 4);
  assert.ok(invalid.errors.some((error) => error.includes('Years of experience')));
  assert.ok(invalid.errors.some((error) => error.includes('Experience level')));
  assert.ok(invalid.errors.some((error) => error.includes('five demonstrated skills')));
  assert.ok(invalid.errors.some((error) => error.includes('Relocation')));
  assert.ok(invalid.errors.some((error) => error.includes('local, remote, or international')));
  assert.ok(invalid.errors.some((error) => error.includes('Notice period')));
});

test('counts only employment months while preserving gaps and overlaps', () => {
  const structured = structureResume([
    'Gap Safe Candidate',
    'candidate@example.test',
    '',
    'SUMMARY',
    'Android engineer with 4+ years of experience.',
    '',
    'EDUCATION',
    'Example University',
    '2014 - 2018',
    '',
    'EXPERIENCE',
    'Company One',
    'January 2019 - December 2020',
    'Android Engineer',
    'Company Two',
    'July 2020 - June 2022',
    'Android Engineer',
    'Company Three',
    'January 2023 - June 2023',
    'Senior Android Engineer',
    '',
    'TECHNICAL SKILLS',
    'Kotlin, Java, Android, Git, Gradle',
  ].join('\n'));
  const inference = inferProfile({
    draftId: '12345678-1234-4234-8234-123456789012',
    text: structured.text,
    sections: structured.sections,
  });
  assert.equal(inference.experience.total_years.value, 4);
  assert.equal(inference.experience.date_ranges.length, 3);
  assert.equal(inference.seniority.value, 'senior');
});

test('saves a normalized reviewed profile without activating user files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-review-'));
  const draftId = '12345678-1234-4234-8234-123456789012';
  const draftPath = path.join(root, 'data', 'onboarding-drafts', draftId);
  await mkdir(draftPath, { recursive: true });
  await writeFile(path.join(draftPath, 'metadata.json'), JSON.stringify({
    draftId,
    status: 'extracted',
    nextStep: 'review',
  }));
  const result = await saveReviewDraft(root, draftId, {
    candidate: { full_name: 'Alex Morgan', email: 'alex@example.test' },
    summary: 'Backend engineer',
    experience_years: '6',
    seniority: 'senior',
    target_roles: 'Senior Backend Engineer, Backend Engineer',
    adjacent_roles: ['Platform Engineer'],
    excluded_titles: 'Frontend Engineer',
    skills: {
      demonstrated: 'Java, PostgreSQL, Docker, Git, REST APIs',
      confirmed_unlisted: 'Docker',
      supporting: 'Kafka',
    },
    location: {
      home_country: 'Canada',
      preferred_locations: 'Canada, Remote',
      remote_eligibility_required: true,
      remote_regions: 'Worldwide',
      relocation: 'open',
      search_scopes: ['local', 'remote'],
      international_locations: [],
    },
    availability: { notice_period: '30 days' },
    compensation: { currency: 'CAD', minimum_annual: '140000', target_annual: '165000' },
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.review.target_roles, ['Senior Backend Engineer', 'Backend Engineer']);
  assert.deepEqual(result.review.excluded_titles, ['Frontend Engineer']);
  assert.equal(result.review.compensation.minimum_annual, 140000);
  assert.equal(result.review.availability.notice_period, '30 days');
  assert.deepEqual(result.review.location.search_scopes, ['local', 'remote']);
  assert.equal(JSON.parse(await readFile(path.join(draftPath, 'review.json'), 'utf8')).status, 'reviewed');
  const metadata = JSON.parse(await readFile(path.join(draftPath, 'metadata.json'), 'utf8'));
  assert.equal(metadata.status, 'reviewed');
  assert.equal(metadata.nextStep, 'activate');
});
