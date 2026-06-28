import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { BASE_OPTION_CATALOG, ROLE_CATALOG } from '../public/option-catalog.js';

const publicFile = (name) => new URL(`../public/${name}`, import.meta.url);

test('candidate review is condensed into four grouped onboarding steps', async () => {
  const html = await readFile(publicFile('index.html'), 'utf8');
  const steps = [...html.matchAll(/class="review-step" data-step="(\d)"/g)].map((match) => Number(match[1]));
  assert.deepEqual([...new Set(steps)], [0, 1, 2, 3]);
  assert.match(html, /id="reviewProgress">Step 1 of 4/);
  assert.ok(steps.length > 4, 'related sections should share a grouped step');
});

test('profile choices use searchable controls backed by local catalogs', async () => {
  const [html, app] = await Promise.all([
    readFile(publicFile('index.html'), 'utf8'),
    readFile(publicFile('app.js'), 'utf8'),
  ]);
  for (const id of ['homeCountryInput', 'skillsDemonstratedInput', 'targetRolesInput', 'industriesInput']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /initializeListControls\(\)/);
  assert.match(app, /renderListOptions\(control\)/);
  assert.ok(BASE_OPTION_CATALOG.skills.length >= 75);
  assert.ok(BASE_OPTION_CATALOG.roles.length >= 250);
  assert.ok(BASE_OPTION_CATALOG.countries.length >= 190);
});

test('role catalog covers technical and non-technical career families with aliases and levels', () => {
  const categories = ROLE_CATALOG.map(({ category }) => category);
  for (const expected of ['Data and AI', 'Healthcare and life sciences', 'Education and research',
    'Construction, manufacturing, and skilled trades', 'Government, nonprofit, and public service']) {
    assert.ok(categories.includes(expected), `missing ${expected}`);
  }
  for (const role of ['Senior Software Engineer', 'ML Engineer', 'Registered Nurse', 'Teacher',
    'Accountant', 'Electrician', 'Store Manager', 'Policy Analyst']) {
    assert.ok(BASE_OPTION_CATALOG.roles.includes(role), `missing ${role}`);
  }
  assert.equal(new Set(BASE_OPTION_CATALOG.roles).size, BASE_OPTION_CATALOG.roles.length);
});

test('onboarding presents the four-stage recommendation pipeline', async () => {
  const html = await readFile(publicFile('index.html'), 'utf8');
  for (const stage of ['Candidate Discovery', 'Job Discovery', 'Eligibility', 'Application Fit']) {
    assert.match(html, new RegExp(stage));
  }
});
