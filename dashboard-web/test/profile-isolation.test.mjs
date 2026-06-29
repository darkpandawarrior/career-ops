import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { profileRefreshStatus, refreshDashboard, spawnNode } from '../server.mjs';

test('refresh status is isolated by resolved profile root', async () => {
  const first = await mkdtemp(path.join(os.tmpdir(), 'hire-profile-a-'));
  const second = await mkdtemp(path.join(os.tmpdir(), 'hire-profile-b-'));
  const firstStatus = profileRefreshStatus(first);
  const secondStatus = profileRefreshStatus(second);
  assert.deepEqual(firstStatus, {
    running: false, phase: 0, phaseName: '', startedAt: null, completedAt: null,
    outcome: 'idle', lastError: null, elapsedMs: 0,
  });
  assert.deepEqual(secondStatus, firstStatus);
  assert.notEqual(path.resolve(first), path.resolve(second));
});

test('scanner launch failures become non-fatal command results', async () => {
  const result = await spawnNode(['scan.mjs'], process.cwd(), () => {
    const error = new Error('spawn EPERM');
    error.code = 'EPERM';
    throw error;
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Unable to start scan\.mjs: spawn EPERM/);
});

test('refresh failures remain visible through profile-scoped status', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hire-profile-failed-'));
  await assert.rejects(refreshDashboard(root, {
    refreshJobSearchImpl: async () => { throw new Error('provider refresh failed'); },
    buildDashboardPayloadImpl: async () => ({ jobs: [] }),
    settleDelayMs: 0,
  }), /provider refresh failed/);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const status = profileRefreshStatus(root);
  assert.equal(status.running, false);
  assert.equal(status.outcome, 'failed');
  assert.equal(status.lastError, 'provider refresh failed');
  assert.ok(status.completedAt);
});

test('profile switching renders cache before starting a selected-profile background refresh', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) =>
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'));
  const cachedRender = source.indexOf('showDashboard();\n    if (_profileParam) void backgroundRefreshSelectedProfile()');
  assert.ok(cachedRender >= 0);
  assert.match(source, /backgroundRefreshSelectedProfile[\s\S]*request\('\/api\/refresh'/);
});
