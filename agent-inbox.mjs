#!/usr/bin/env node

/**
 * agent-inbox.mjs — a tiny bridge between *looking at* the pipeline and
 * *acting on* it.
 *
 * career-ops is driven from an AI session, but there's no durable place to drop
 * a request when you're not in one — e.g. while glancing at the tracker (or a
 * dashboard) you think "evaluate this URL" or "draft a follow-up for #7". This
 * is that place: an append-only queue the agent drains at the start of a
 * session.
 *
 *   data/agent-inbox.md
 *     - [ ] <stamp> — <request>          (pending)
 *     - [x] <stamp> — <request> → result: <one line>   (resolved)
 *
 * Fully local-first and human-in-the-loop: nothing here auto-submits. Queued
 * items are *intents* for the agent to action and the user to review. Markdown
 * checklist, no database, no server, no dependencies — edit it by hand or via
 * this CLI, and any tool (a dashboard, a script, cron) can append to it. The
 * protocol an agent follows is documented in modes/agent-inbox.md.
 *
 * Usage:
 *   node agent-inbox.mjs add "evaluate https://acme.com/jobs/42"
 *   node agent-inbox.mjs list [--all]                 # pending only, or every item
 *   node agent-inbox.mjs resolve 1 [--result "scored 4.3 — report 012"]
 */

import { readFileSync, writeFileSync, appendFileSync, openSync, readSync, closeSync, fstatSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve as resolvePath } from 'path';
import { acquireTrackerLock, lockDirFor } from './tracker-lock.mjs';

const PATH = process.env.CAREER_OPS_INBOX || 'data/agent-inbox.md';

const HEADER = [
  '# Agent Inbox',
  '',
  '> **Agent protocol:** at the start of a career-ops session, read this file.',
  '> Run each unchecked item top-to-bottom. After each, mark it `[x]` and append',
  '> `→ result: <one line>`. Items that need live user input (a mock, a paste, a',
  '> decision) → ask the user to start them instead of running them.',
  '>',
  '> Nothing here auto-submits — queued items are *intents* for you to action and',
  '> the user to review. Appended by hand, by a dashboard, or by agent-inbox.mjs.',
  '',
].join('\n');

function stamp() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}

function ensureGitignored() {
  // The inbox is personal data. On installs whose .gitignore predates this
  // feature, make sure the default path is ignored so a first `add` can't
  // accidentally commit it. Only manages the default, non-overridden path.
  if (process.env.CAREER_OPS_INBOX || PATH !== 'data/agent-inbox.md') return;
  try {
    if (!existsSync('.gitignore')) return; // not a git checkout we should touch
    const text = readFileSync('.gitignore', 'utf8');
    if (text.split('\n').some((l) => l.trim() === PATH)) return; // already ignored
    writeFileSync('.gitignore', text.replace(/\s*$/, '') + `\n${PATH}\n`);
  } catch { /* best effort — never block queuing on this */ }
}

function oneLine(s) {
  // markdown-checklist-safe: collapse to a single bullet line
  return String(s ?? '').replace(/\s*\n\s*/g, ' ').trim();
}

function ensureFile() {
  if (existsSync(PATH)) return;
  ensureGitignored();
  mkdirSync(dirname(PATH), { recursive: true });
  // 'wx' fails with EEXIST if the file appeared between the check above and
  // this write. The default 'w' flag TRUNCATES, so the loser of that race would
  // wipe whatever the winner had already appended — the same data-loss class
  // this file's locking exists to prevent, just narrowed to a brand-new queue.
  try {
    writeFileSync(PATH, HEADER, { flag: 'wx' });
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
  }
}

// Parse the checklist into items, in file order.
function parseItems() {
  if (!existsSync(PATH)) return [];
  const items = [];
  readFileSync(PATH, 'utf8').split('\n').forEach((line, i) => {
    const m = /^- \[([ xX])\]\s*(.*)$/.exec(line.trim());
    if (m) items.push({ line: i, done: m[1].toLowerCase() === 'x', text: m[2] });
  });
  return items;
}

function opt(name, def = '') {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : def;
}

// Both writers below serialize on the shared tracker-lock primitive, keyed on
// the inbox's own path so it never contends with the applications tracker.
//
// `add` could get away with a bare O_APPEND write (atomic below PIPE_BUF), but
// `resolve` cannot: it is a read-modify-write over the whole file, so a
// concurrent `add` landing between its read and its write is silently erased
// when the pre-add snapshot is written back. The dashboard queues into this
// file while a session resolves items, so that interleaving is a real
// scenario here, not a theoretical one. One lock covers both rather than two
// mechanisms that only mostly agree.
async function withInboxLock(fn) {
  const lockDir = lockDirFor(resolvePath(PATH), process.env.CAREER_OPS_INBOX_LOCK);
  const lock = await acquireTrackerLock(lockDir, {
    timeoutMs: Number(process.env.CAREER_OPS_INBOX_LOCK_TIMEOUT_MS) || 30_000,
    retryMs: 75,
    staleMs: 10 * 60_000,
    tracker: PATH,
  });
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

/** True when the file's last byte is not a newline, so an append needs one. */
function needsLeadingNewline() {
  let fd;
  try {
    fd = openSync(PATH, 'r');
    const { size } = fstatSync(fd);
    if (size === 0) return false;
    const buf = Buffer.alloc(1);
    readSync(fd, buf, 0, 1, size - 1);
    return buf[0] !== 0x0a;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

async function add() {
  const text = oneLine(process.argv.slice(3).join(' '));
  if (!text) fail('add needs a request, e.g. node agent-inbox.mjs add "evaluate https://..."');
  ensureFile();
  await withInboxLock(() => {
    // Append, never read-then-rewrite: the old form read the whole file,
    // trimmed it and wrote it back, so two concurrent adds each wrote a body
    // that predated the other and one request vanished with no error.
    const prefix = needsLeadingNewline() ? '\n' : '';
    appendFileSync(PATH, `${prefix}- [ ] ${stamp()} — ${text}\n`);
  });
  process.stdout.write(`Queued: ${text}\n`);
}

function list() {
  const all = process.argv.includes('--all');
  const items = parseItems().filter((it) => all || !it.done);
  if (!items.length) return process.stdout.write(all ? 'Inbox is empty.\n' : 'No pending items.\n');
  items.forEach((it, n) => {
    process.stdout.write(`${String(n + 1).padStart(2)}. [${it.done ? 'x' : ' '}] ${it.text}\n`);
  });
}

async function resolve() {
  const n = Number(process.argv[3]);
  if (!Number.isInteger(n) || n < 1) fail('resolve needs a 1-based item number (see `list`)');
  const result = oneLine(opt('result'));
  // The whole read-modify-write runs under the lock, and the item is re-read
  // INSIDE it. Resolving off a snapshot taken before the lock would reintroduce
  // the bug from the other side: an `add` landing in between shifts nothing
  // (appends go to the end) but a concurrent `resolve` does change which line
  // is the Nth pending one, so the stale index could tick off the wrong item.
  const target = await withInboxLock(() => {
    // Number against the pending view, so `list` then `resolve N` line up.
    const pending = parseItems().filter((it) => !it.done);
    const item = pending[n - 1];
    if (!item) return { missing: pending.length };
    const lines = readFileSync(PATH, 'utf8').split('\n');
    let updated = lines[item.line].replace('[ ]', '[x]');
    if (result && !/→ result:/.test(updated)) updated += ` → result: ${result}`;
    lines[item.line] = updated;
    writeFileSync(PATH, lines.join('\n'));
    return item;
  });
  if (target.missing !== undefined) fail(`no pending item #${n} (${target.missing} pending)`);
  process.stdout.write(`Resolved #${n}: ${target.text}\n`);
}

function fail(msg) {
  process.stderr.write(`agent-inbox.mjs: ${msg}\n`);
  process.exit(1);
}

const cmd = process.argv[2];
if (cmd === 'add') await add();
else if (cmd === 'list') list();
else if (cmd === 'resolve') await resolve();
else {
  process.stdout.write(
    'Usage:\n' +
    '  node agent-inbox.mjs add "evaluate https://acme.com/jobs/42"\n' +
    '  node agent-inbox.mjs list [--all]\n' +
    '  node agent-inbox.mjs resolve <n> [--result "..."]\n',
  );
}
