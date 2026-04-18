import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getSetupStatus, loadActiveProfile } from '../config.mjs';

test('a clean clone requires local onboarding files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-dashboard-'));
  const status = await getSetupStatus(root);
  assert.equal(status.ready, false);
  assert.deepEqual(status.missing, [
    'cv.md',
    'config/profile.yml',
    'config/job-search.yml',
    'modes/_profile.md',
    'portals.yml',
  ]);
});

test('profile summary is read from private configuration', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-dashboard-'));
  await mkdir(path.join(root, 'config'), { recursive: true });
  await writeFile(path.join(root, 'config', 'profile.yml'), [
    'candidate:',
    '  full_name: Fictional Candidate',
    '  location: Toronto, Canada',
    'narrative:',
    '  headline: Backend systems engineer',
    'target_roles:',
    '  primary:',
    '    - Senior Backend Engineer',
  ].join('\n'));
  const profile = await loadActiveProfile(root);
  assert.equal(profile.name, 'Fictional Candidate');
  assert.deepEqual(profile.roles, ['Senior Backend Engineer']);
});
