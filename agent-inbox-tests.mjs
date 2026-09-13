#!/usr/bin/env node

/**
 * agent-inbox-tests.mjs — regression tests for agent-inbox.mjs.
 *
 * Locks in the queue's behaviour:
 *   1. A first `add` seeds the header + agent protocol and one pending item.
 *   2. `add` is append-only and multiline text collapses to a single bullet.
 *   3. `list` shows pending only; `list --all` shows resolved items too.
 *   4. `resolve N` ticks the N-th *pending* item and appends a one-line result,
 *      so `list` then `resolve N` line up.
 *   4b. resolve holds the same lock as add for its full read/modify/write, so a
 *       request accepted concurrently cannot be overwritten by a stale view.
 *   5. An empty `add` fails loudly (exit 1) rather than queuing a blank line.
 *   6. On the default path, a first `add` self-heals .gitignore (idempotent) so
 *      the personal queue isn't accidentally tracked.
 *
 * Provisions a throwaway queue via CAREER_OPS_INBOX and a temp CWD; never
 * touches real user data.
 */

import { execFileSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { acquirePipelineLock } from './pipeline-lock.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const CLI = join(ROOT, 'agent-inbox.mjs');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

// Run agent-inbox.mjs against a provisioned queue file; returns stdout.
function run(inbox, args, opts = {}) {
  return execFileSync(NODE, [CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_INBOX: inbox },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...opts,
  });
}

// ---------------------------------------------------------------------------
console.log('1. First add seeds header + protocol and one pending item');
{
  const inbox = join(tmp('inbox-'), 'agent-inbox.md');
  run(inbox, ['add', 'evaluate https://acme.com/jobs/42']);
  const md = readFileSync(inbox, 'utf8');
  check('header present', /^# Agent Inbox/.test(md));
  check('agent protocol documented', /Agent protocol:/.test(md));
  check('nothing auto-submits is stated', /auto-submit/.test(md));
  check('one pending checklist item', (md.match(/^- \[ \]/gm) || []).length === 1, md);
  check('request text preserved', md.includes('evaluate https://acme.com/jobs/42'));
}

// ---------------------------------------------------------------------------
console.log('2. add is append-only; multiline text collapses to one bullet');
{
  const inbox = join(tmp('inbox-'), 'agent-inbox.md');
  run(inbox, ['add', 'first request']);
  run(inbox, ['add', 'second\nrequest with newline']);
  const md = readFileSync(inbox, 'utf8');
  check('two pending items', (md.match(/^- \[ \]/gm) || []).length === 2);
  check('first item retained', md.includes('first request'));
  check('newline collapsed (no mid-item break)', md.includes('second request with newline'));
  check('item count == bullet count (no stray bullets)', (md.match(/^- \[/gm) || []).length === 2);
}

// ---------------------------------------------------------------------------
console.log('3. list shows pending; --all includes resolved');
{
  const inbox = join(tmp('inbox-'), 'agent-inbox.md');
  run(inbox, ['add', 'alpha']);
  run(inbox, ['add', 'beta']);
  run(inbox, ['resolve', '1', '--result', 'done alpha']);
  const pending = run(inbox, ['list']);
  const all = run(inbox, ['list', '--all']);
  check('pending list hides resolved alpha', !pending.includes('alpha') && pending.includes('beta'), pending.trim());
  check('--all shows both', all.includes('alpha') && all.includes('beta'));
}

// ---------------------------------------------------------------------------
console.log('4. resolve ticks the N-th pending item + appends a one-line result');
{
  const inbox = join(tmp('inbox-'), 'agent-inbox.md');
  run(inbox, ['add', 'gamma']);
  run(inbox, ['resolve', '1', '--result', 'scored 4.3 — report 012']);
  const md = readFileSync(inbox, 'utf8');
  check('item marked done', /^- \[x\] .*gamma/m.test(md), md);
  check('result appended', /→ result: scored 4\.3 — report 012/.test(md));
  check('no pending left', (md.match(/^- \[ \]/gm) || []).length === 0);
}

// ---------------------------------------------------------------------------
console.log('4b. resolve waits for the queue lock before rewriting');
{
  const dir = tmp('inbox-resolve-lock-');
  const inbox = join(dir, 'agent-inbox.md');
  writeFileSync(inbox, '# Agent Inbox\n\n- [ ] 2026-01-01 00:00 — alpha\n- [ ] 2026-01-01 00:01 — beta\n');
  const held = await acquirePipelineLock(inbox, { timeoutMs: 10_000 });
  const child = spawn(NODE, [CLI, 'resolve', '1', '--result', 'done alpha'], {
    cwd: ROOT, env: { ...process.env, CAREER_OPS_INBOX: inbox }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const closed = new Promise((res) => child.on('close', (code) => res(code)));
  const whileHeld = await Promise.race([
    closed.then(() => 'closed'),
    // A fresh Node process starts in tens of milliseconds on the hosted
    // runners. Half a second keeps the negative control decisive without
    // making the suite inherit the lock's 30-second production timeout.
    new Promise((res) => setTimeout(() => res('waiting'), 500)),
  ]);
  check('resolve stays blocked while another writer owns the queue lock', whileHeld === 'waiting', `state=${whileHeld}`);
  held.release();
  const exit = await closed;
  check('resolve exits cleanly after the lock is released', exit === 0, `exit=${exit}, stderr=${stderr.trim()}`);
  const md = readFileSync(inbox, 'utf8');
  check('the selected item is resolved from the locked snapshot', /^- \[x\].*alpha.*→ result: done alpha/m.test(md), md);
  check('the sibling pending item survives the rewrite', /^- \[ \].*beta/m.test(md), md);
  check('resolve reports the selected item after committing', /Resolved #1: .*alpha/.test(stdout), stdout.trim());
}

// ---------------------------------------------------------------------------
console.log('5. empty add fails (exit 1), does not queue a blank line');
{
  const inbox = join(tmp('inbox-'), 'agent-inbox.md');
  let exit = 0;
  try { run(inbox, ['add', '   ']); } catch (e) { exit = e.status; }
  check('non-zero exit on empty request', exit === 1, `exit=${exit}`);
}

// ---------------------------------------------------------------------------
console.log('6. first add on the default path self-heals .gitignore (idempotent)');
{
  const repo = tmp('inbox-repo-');
  writeFileSync(join(repo, '.gitignore'), 'node_modules\noutput/*\n');
  // FORK: upstream's default inbox path is the relative string
  // 'data/agent-inbox.md', so an unset CAREER_OPS_INBOX plus cwd=repo was
  // enough to sandbox this block. Here the two-roots rule resolves the inbox
  // from the ACTIVE PROFILE's data root, which ignores cwd — so the same call
  // wrote 'queue a scan' straight into the maintainer's live
  // data/agent-inbox.md. CAREER_OPS_ROOT is the documented override for that
  // root (path-resolver.mjs), and pinning it to the throwaway repo is what
  // makes this suite honour its own "never touches real user data" contract.
  const addOnce = () => execFileSync(NODE, [CLI, 'add', 'queue a scan'], {
    cwd: repo,
    env: { ...process.env, CAREER_OPS_INBOX: '', CAREER_OPS_ROOT: repo },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  addOnce(); addOnce();
  const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  const ruleCount = gi.split('\n').filter((l) => l.trim() === 'data/agent-inbox.md').length;
  check('.gitignore gains exactly one data/agent-inbox.md rule', ruleCount === 1, `count=${ruleCount}`);
}

// ---------------------------------------------------------------------------
console.log('7. concurrent writers never lose an item (adds, and adds racing resolves)');
{
  // Real concurrency, not a simulation: execFileSync would serialize the
  // children and pass against the very read-modify-write this guards.
  const { spawn } = await import('child_process');
  const runAsync = (inbox, args) => new Promise((res, rej) => {
    const child = spawn(NODE, [CLI, ...args], {
      cwd: dirname(inbox),
      env: { ...process.env, CAREER_OPS_INBOX: inbox },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.on('error', rej);
    child.on('close', (code) => res(code));
  });

  // 7a. N concurrent adds. Each old add read the whole file, trimmed it and
  // wrote it back, so two overlapping adds each wrote a body that predated the
  // other and one request vanished silently.
  {
    const inbox = join(tmp('inbox-race-add-'), 'agent-inbox.md');
    const N = 25;
    await Promise.all(Array.from({ length: N }, (_, i) => runAsync(inbox, ['add', `req ${i}`])));
    const pending = readFileSync(inbox, 'utf8').split('\n').filter((l) => l.startsWith('- [ ]')).length;
    check(`${N} concurrent adds all survive`, pending === N, `kept ${pending}/${N}`);
  }

  // 7b. adds racing resolves. `resolve` is a read-modify-write over the WHOLE
  // file, so an add landing between its read and its write is erased when the
  // pre-add snapshot is written back. The dashboard queues into this file while
  // a session resolves items, so this interleaving is a real scenario.
  {
    const inbox = join(tmp('inbox-race-mixed-'), 'agent-inbox.md');
    const SEED = 10, ADD = 8, RESOLVE = 6;
    for (let i = 0; i < SEED; i++) run(inbox, ['add', `seed ${i}`]);
    const jobs = [
      ...Array.from({ length: ADD }, (_, i) => runAsync(inbox, ['add', `late ${i}`])),
      ...Array.from({ length: RESOLVE }, () => runAsync(inbox, ['resolve', '1', '--result', 'ok'])),
    ];
    await Promise.all(jobs);
    const lines = readFileSync(inbox, 'utf8').split('\n');
    const total = lines.filter((l) => /^- \[[ x]\]/.test(l)).length;
    const done = lines.filter((l) => l.startsWith('- [x]')).length;
    check(`no item lost while ${ADD} adds raced ${RESOLVE} resolves`, total === SEED + ADD, `have ${total}, expected ${SEED + ADD}`);
    check(`each resolve ticked exactly one item`, done === RESOLVE, `ticked ${done}, expected ${RESOLVE}`);
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
