/**
 * dead-boards.test.mjs — tests for the dead-board store.
 *
 * The property that matters most: a board is retired ONLY by repeated 404s.
 * If a throttle/timeout/429 can write a miss, one bad sweep permanently hides
 * live boards and the scanner silently under-reports openings — the exact
 * failure this module exists to prevent. Most of these cases guard that.
 *
 * Run: node dead-boards.test.mjs
 */

import {
  isDeadBoardError, boardKey, parseDeadBoards, serializeDeadBoards, shouldSkip,
  recordMiss, recordHit, loadDeadBoards, saveDeadBoards,
  DEAD_AFTER_MISSES, RECHECK_AFTER_DAYS,
} from './dead-boards.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let passed = 0, failed = 0;
const failures = [];
function ok(label, cond) {
  if (cond) passed++;
  else { failed++; failures.push(label); console.log(`  FAIL: ${label}`); }
}
function eq(label, actual, expected) {
  ok(label, JSON.stringify(actual) === JSON.stringify(expected));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.log(`    expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const DAY = 86_400_000;
const NOW = Date.parse('2026-08-14T00:00:00.000Z');

// ── isDeadBoardError: ONLY a 404 is proof of death ──────────────────
ok('404 status is dead', isDeadBoardError({ status: 404 }));
ok('404 message is dead', isDeadBoardError(new Error('HTTP 404 Not Found')));
ok('bare HTTP 404 message is dead', isDeadBoardError(new Error('HTTP 404')));
ok('404 on a wrapped cause is dead', isDeadBoardError(Object.assign(new Error('x'), { cause: { status: 404 } })));

// These are the throttle/transport failures that must NEVER retire a board.
ok('429 is not dead', !isDeadBoardError({ status: 429 }));
ok('500 is not dead', !isDeadBoardError({ status: 500 }));
ok('503 is not dead', !isDeadBoardError({ status: 503 }));
ok('403 is not dead', !isDeadBoardError({ status: 403 }));
ok('abort is not dead', !isDeadBoardError(new Error('This operation was aborted')));
ok('timeout is not dead', !isDeadBoardError(new Error('lever/foo: timed out after 300s')));
ok('DNS failure is not dead', !isDeadBoardError(Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' })));
ok('null is not dead', !isDeadBoardError(null));
// A 404 inside a longer sentence about something else must not count.
ok('"404" in prose is not dead', !isDeadBoardError(new Error('board returned 4040 jobs')));

// ── shouldSkip: threshold AND recency ───────────────────────────────
const dead = { misses: DEAD_AFTER_MISSES, lastChecked: NOW - DAY };
ok('dead + recent is skipped', shouldSkip(dead, NOW));
ok('below threshold is not skipped', !shouldSkip({ misses: DEAD_AFTER_MISSES - 1, lastChecked: NOW - DAY }, NOW));
ok('unknown board is not skipped', !shouldSkip(undefined, NOW));
ok('dead but stale is re-probed', !shouldSkip({ misses: 99, lastChecked: NOW - (RECHECK_AFTER_DAYS + 1) * DAY }, NOW));
ok('exactly at recheck boundary is re-probed', !shouldSkip({ misses: 99, lastChecked: NOW - RECHECK_AFTER_DAYS * DAY }, NOW));

// ── record: miss accumulates, hit clears ────────────────────────────
{
  const m = new Map();
  recordMiss(m, 'lever', 'deadco', NOW);
  eq('first miss counts 1', m.get(boardKey('lever', 'deadco')).misses, 1);
  ok('one miss is not yet skippable', !shouldSkip(m.get(boardKey('lever', 'deadco')), NOW));
  recordMiss(m, 'lever', 'deadco', NOW);
  recordMiss(m, 'lever', 'deadco', NOW);
  eq('third miss counts 3', m.get(boardKey('lever', 'deadco')).misses, 3);
  ok('three misses is skippable', shouldSkip(m.get(boardKey('lever', 'deadco')), NOW));

  // A board that answers again must come straight back into the sweep.
  recordHit(m, 'lever', 'deadco');
  ok('a hit clears the record', !m.has(boardKey('lever', 'deadco')));
  ok('revived board is scanned again', !shouldSkip(m.get(boardKey('lever', 'deadco')), NOW));
}

// ── same slug on different ATSs must not collide ────────────────────
{
  const m = new Map();
  recordMiss(m, 'lever', 'acme', NOW);
  recordMiss(m, 'ashby', 'acme', NOW);
  eq('per-ATS records are independent', [m.get(boardKey('lever', 'acme')).misses, m.get(boardKey('ashby', 'acme')).misses], [1, 1]);
}

// ── round-trip ──────────────────────────────────────────────────────
{
  const m = new Map();
  recordMiss(m, 'workday', 'zzz', NOW);
  recordMiss(m, 'greenhouse', 'aaa', NOW);
  const round = parseDeadBoards(serializeDeadBoards(m));
  eq('round-trips both rows', round.size, 2);
  eq('round-trips misses', round.get(boardKey('greenhouse', 'aaa')).misses, 1);
  eq('round-trips timestamp', round.get(boardKey('greenhouse', 'aaa')).lastChecked, NOW);
  ok('sorted by ats then slug', serializeDeadBoards(m).indexOf('greenhouse') < serializeDeadBoards(m).indexOf('workday'));
}

// ── malformed input degrades to "re-probe", never throws ────────────
{
  const junk = [
    'ats\tslug\tmisses\tlast_checked',
    '# a comment',
    '',
    'lever',                                   // too few columns
    'lever\tnomisses\t\t2026-08-01T00:00:00Z', // empty misses
    'lever\tbadnum\txx\t2026-08-01T00:00:00Z', // non-numeric misses
    'lever\tbaddate\t3\tnot-a-date',           // unparseable date
    'lever\tzero\t0\t2026-08-01T00:00:00Z',    // misses must be > 0
    'lever\tgood\t4\t2026-08-01T00:00:00Z',    // the only valid row
  ].join('\n');
  const m = parseDeadBoards(junk);
  eq('only the valid row survives', [...m.keys()], [boardKey('lever', 'good')]);
  eq('empty input yields empty map', parseDeadBoards('').size, 0);
  eq('null input yields empty map', parseDeadBoards(null).size, 0);
}

// ── the sweep's actual skip decision ────────────────────────────────
// Mirrors the in-worker guard in scan-ats-full.mjs: look the board up by
// (ats, slug) and skip only on shouldSkip. The scanner deliberately does NOT
// pre-filter its entries array — parallelEach's resumeAt indexes into it, and a
// filtered array would desync the --resume checkpoint offset.
{
  const m = new Map();
  for (let i = 0; i < DEAD_AFTER_MISSES; i++) recordMiss(m, 'lever', 'dead', NOW);
  recordMiss(m, 'lever', 'flaky', NOW); // one miss only — still scanned
  const sweep = (ats, entries) => entries.filter(e => !shouldSkip(m.get(boardKey(ats, e.name)), NOW)).map(e => e.name);
  const entries = [{ name: 'dead' }, { name: 'flaky' }, { name: 'fresh' }];
  eq('skips only the confirmed-dead board', sweep('lever', entries), ['flaky', 'fresh']);
  eq('same slugs on another ATS are all scanned', sweep('ashby', entries), ['dead', 'flaky', 'fresh']);

  // The recovery path: a skipped board becomes due again and is re-probed.
  const old = new Map();
  for (let i = 0; i < DEAD_AFTER_MISSES; i++) recordMiss(old, 'lever', 'revived', NOW - (RECHECK_AFTER_DAYS + 1) * DAY);
  const dueAgain = old.get(boardKey('lever', 'revived'));
  ok('a board past its recheck window is scanned again', !shouldSkip(dueAgain, NOW));
}

// ── file I/O ────────────────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'liveness-'));
  const file = join(dir, 'nested', 'board-liveness.tsv');
  const m = new Map();
  recordMiss(m, 'ashby', 'gone', NOW);
  saveDeadBoards(file, m);
  eq('saves and reloads', loadDeadBoards(file).get(boardKey('ashby', 'gone')).misses, 1);
  ok('writes a header', readFileSync(file, 'utf-8').startsWith('ats\tslug'));
  eq('missing file yields empty map', loadDeadBoards(join(dir, 'nope.tsv')).size, 0);

  writeFileSync(file, '  garbage');
  eq('corrupt file yields empty map', loadDeadBoards(file).size, 0);
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\ndead-boards: ${passed} passed, ${failed} failed`);
if (failed) { console.log(failures.map(f => `  - ${f}`).join('\n')); process.exit(1); }
