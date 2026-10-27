// tests/scan-ats-full-resume.test.mjs — parallelEach resume-index tracking,
// withTimeout watchdog, and checkpoint compatibility rules.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — resume machinery');

const mod = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);
const { parallelEach, withTimeout, datasetFingerprint } = mod;

// withTimeout: passes a fast promise through untouched.
{
  const v = await withTimeout(Promise.resolve(42), 1_000, 'fast');
  if (v === 42) pass('withTimeout passes fast resolution through');
  else fail(`withTimeout returned ${v}`);
}

// withTimeout: rejects a hung promise with a labeled error.
{
  try {
    await withTimeout(new Promise(() => {}), 100, 'acme/board');
    fail('withTimeout resolved a never-settling promise');
  } catch (err) {
    if (/acme\/board: timed out after/.test(err.message)) pass('withTimeout rejects with labeled timeout');
    else fail(`withTimeout error message: ${err.message}`);
  }
}

// parallelEach: resumeAt is the lowest UNFINISHED index — a slow early item
// holds resumeAt down even while later items complete (resuming at plain
// `done` count would skip the slow item's work).
{
  let release;
  const gate = new Promise((r) => { release = r; });
  const events = [];
  const p = parallelEach(
    [...Array(10).keys()], 2,
    async (item) => { if (item === 2) await gate; },
    (e) => events.push({ ...e }),
  );
  await new Promise((r) => setTimeout(r, 100)); // let everything except item 2 finish
  const held = events[events.length - 1];
  if (held && held.done === 9 && held.resumeAt === 2) {
    pass('resumeAt pinned to slow in-flight index 2 while 9 others finished');
  } else {
    fail(`expected {done:9, resumeAt:2}, got ${JSON.stringify(held)}`);
  }
  release();
  await p;
  const last = events[events.length - 1];
  if (last.done === 10 && last.resumeAt === 10) pass('resumeAt reaches items.length on completion');
  else fail(`final event ${JSON.stringify(last)}`);
}

// ── Checkpoint compatibility rules ──────────────────────────────────
const { loadCheckpoint, checkpointCompatible } = mod;

{
  const cp = { version: 1, cutoffMs: 1, ats: ['workday'], limit: null, includeUndated: false };
  const opts = { ats: ['workday'], limit: Infinity, includeUndated: false, shuffle: false };
  if (checkpointCompatible(cp, opts)) pass('checkpoint compatible with identical settings');
  else fail('identical settings judged incompatible');

  if (!checkpointCompatible(cp, { ...opts, ats: ['greenhouse'] })) pass('ats mismatch rejected');
  else fail('ats mismatch accepted');

  if (!checkpointCompatible(cp, { ...opts, shuffle: true })) pass('--shuffle rejected for resume (order not reproducible)');
  else fail('shuffle accepted');

  if (!checkpointCompatible(cp, { ...opts, limit: 200 })) pass('limit mismatch rejected');
  else fail('limit mismatch accepted');

  if (!checkpointCompatible(null, opts)) pass('null checkpoint rejected');
  else fail('null checkpoint accepted');
}

// Filter fingerprints: a portals.yml filter edited between a run and its
// --resume would leave the swept boards judged by the old filter, so each one
// is recorded in the checkpoint and a change is named on resume.
{
  const { filterFingerprints, changedFilterKeys } = mod;
  const config = {
    title_filter: { positive: ['backend'], negative: ['intern'] },
    location_filter: { allow: ['remote'] },
    content_filter: { exclude: ['clearance'] },
    domain_filter: ['defi', 'crypto'],
  };
  const cp = { filters: filterFingerprints(config) };
  const changed = (c) => changedFilterKeys(cp, filterFingerprints(c));

  if (changed(structuredClone(config)).length === 0) pass('unchanged filters resume');
  else fail(`unchanged filters reported: ${changed(config)}`);

  const reordered = { domain_filter: config.domain_filter, content_filter: config.content_filter, location_filter: config.location_filter, title_filter: { negative: ['intern'], positive: ['backend'] } };
  if (changed(reordered).length === 0) pass('reordered YAML mapping keys are not a change');
  else fail(`key reorder reported as ${changed(reordered)}`);

  for (const [key, edit] of [
    ['title_filter', (c) => { c.title_filter.positive.push('platform'); }],
    ['title_filter_overrides', (c) => { c.title_filter_overrides = { acme: { positive: ['sre'] } }; }],
    ['location_filter', (c) => { c.location_filter.allow = ['berlin']; }],
    ['content_filter', (c) => { delete c.content_filter; }],
    ['domain_filter', (c) => { c.domain_filter.push('web3'); }],
  ]) {
    const c = structuredClone(config);
    edit(c);
    const got = changed(c);
    if (JSON.stringify(got) === JSON.stringify([key])) pass(`${key} edit named on resume`);
    else fail(`${key} edit reported as ${JSON.stringify(got)}`);
  }

  // title_filter_full replaces title_filter for this sweep, so adding it is a
  // change even when title_filter itself is untouched.
  const withFull = { ...structuredClone(config), title_filter_full: { positive: ['solidity'] } };
  if (changed(withFull).includes('title_filter_full')) pass('adding title_filter_full is a change');
  else fail(`title_filter_full addition reported as ${JSON.stringify(changed(withFull))}`);

  // Checkpoints written before filters were recorded resume as before.
  if (changedFilterKeys({ version: 1 }, filterFingerprints(config)).length === 0) pass('checkpoint without filters still resumes');
  else fail('checkpoint without filters rejected');
}

// loadCheckpoint: garbage and wrong-version files → null, never a throw.
{
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  // A temp directory of its own. This used to be data/cache/.test-checkpoint
  // under ROOT, which is the developer's data directory (#5113).
  const dir = mkdtempSync(join(tmpdir(), 'co-scan-checkpoint-'));
  const p = `${dir}/cp.json`;
  writeFileSync(p, 'not json', 'utf-8');
  if (loadCheckpoint(p) === null) pass('loadCheckpoint returns null on garbage JSON');
  else fail('garbage JSON not rejected');
  writeFileSync(p, JSON.stringify({ version: 99 }), 'utf-8');
  if (loadCheckpoint(p) === null) pass('loadCheckpoint returns null on unknown version');
  else fail('unknown version not rejected');
  writeFileSync(p, JSON.stringify({ version: 1, cutoffMs: 5 }), 'utf-8');
  if (loadCheckpoint(p)?.cutoffMs === 5) pass('loadCheckpoint reads a valid checkpoint');
  else fail('valid checkpoint not read');

  // A malformed `current` is worse than no checkpoint: resumeAt is consumed
  // unchecked, so it rescans from zero and then writes NaN offsets forever.
  for (const [label, current] of [
    ['missing resumeAt', { name: 'workday', datasetLen: 10 }],
    ['non-numeric resumeAt', { name: 'workday', resumeAt: 'x', datasetLen: 10 }],
    ['negative resumeAt', { name: 'workday', resumeAt: -1, datasetLen: 10 }],
    ['missing name', { resumeAt: 5, datasetLen: 10 }],
    ['non-array deferred', { name: 'workday', resumeAt: 5, datasetLen: 10, deferred: 3 }],
    ['non-integer deferred index', { name: 'workday', resumeAt: 5, datasetLen: 10, deferred: [1, 'x'] }],
  ]) {
    writeFileSync(p, JSON.stringify({ version: 1, current }), 'utf-8');
    if (loadCheckpoint(p) === null) pass(`loadCheckpoint rejects malformed current (${label})`);
    else fail(`malformed current accepted (${label})`);
  }

  writeFileSync(p, JSON.stringify({ version: 1, current: { name: 'workday', resumeAt: 500, datasetLen: 12884 } }), 'utf-8');
  if (loadCheckpoint(p)?.current?.resumeAt === 500) pass('loadCheckpoint accepts a well-formed current');
  else fail('well-formed current rejected');

  // The domain gate's deferred boards ride along in `current`, so a resumed
  // run can retry the ones below its offset (#3304).
  writeFileSync(p, JSON.stringify({ version: 1, current: { name: 'workday', resumeAt: 500, datasetLen: 12884, deferred: [12, 480] } }), 'utf-8');
  if (JSON.stringify(loadCheckpoint(p)?.current?.deferred) === '[12,480]') pass('loadCheckpoint keeps the deferred board indices');
  else fail('deferred board indices lost or rejected');

  // current: null is the legitimate "source finished" marker, not malformed.
  writeFileSync(p, JSON.stringify({ version: 1, current: null }), 'utf-8');
  if (loadCheckpoint(p)?.version === 1) pass('loadCheckpoint accepts current: null');
  else fail('current: null rejected');

  rmSync(dir, { recursive: true, force: true });
}

// datasetFingerprint: same content → same hash; any drift → different hash.
// Guards --resume against a same-length dataset regenerated with different
// members (which a bare length check would miss and silently mis-resume).
{
  const a = ['acme', 'globex', 'initech'];
  if (datasetFingerprint(a) === datasetFingerprint(['acme', 'globex', 'initech'])) pass('datasetFingerprint stable for identical lists');
  else fail('datasetFingerprint not stable for identical content');

  // Same length, swapped member — the case a length-only check misses.
  if (datasetFingerprint(a) !== datasetFingerprint(['acme', 'globex', 'umbrella'])) pass('datasetFingerprint detects same-length content drift');
  else fail('datasetFingerprint missed same-length content drift');

  // Reordering is drift too — resume offsets are order-dependent.
  if (datasetFingerprint(a) !== datasetFingerprint(['globex', 'acme', 'initech'])) pass('datasetFingerprint detects reordering');
  else fail('datasetFingerprint missed reordering');
}
