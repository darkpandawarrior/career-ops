// tests/core-test-layout.test.mjs — a suite that is not under tests/ does not run.
//
// test-all.mjs discovers `tests/**/*.test.mjs` and nothing else (#1440), and
// that limit is deliberate: it keeps the runner away from standalone files at
// the repository root. The cost is that a suite written anywhere else is
// invisible in the quietest possible way: the file exists, it is committed,
// `--only <name>` says "no test files matched", and the suite prints green
// assertions the moment somebody runs it by hand.
//
// lib/context-budget.test.mjs sat there with the #2234 guard that every
// modes/_shared.md heading is classified in SECTION_PRIORITY, so a
// scoring-critical section cannot silently become compressible. That guard
// had never run in CI. This is the core half, kept in tests/ rather than
// inline in test-all.mjs so `--only` can reach it.
import { pass, fail, ROOT } from './helpers.mjs';
import { collectMjsFiles } from '../lib/mjs-files.mjs';
import { relative, sep, dirname, join } from 'path';
import { readFileSync } from 'fs';

console.log('\ncore test layout — every suite lives where a runner can find it');

// Trees a runner discovers recursively: test-all.mjs's discoverTests() over
// tests/, plus web/tests/ upstream-style if it ever comes back.
const DISCOVERED_ROOTS = ['tests/', 'web/tests/'];

// This fork colocates web node:test suites next to their sources instead of
// under web/tests/ (fork-adaptations rule 'web-tests-colocated'). They are
// discovered by web/package.json's `test:engine` script, whose globs are
// one-level-deep — so read the real globs rather than trusting a prefix: a
// suite dropped in a directory the script does not list is still invisible.
const engineScript =
  JSON.parse(readFileSync(join(ROOT, 'web', 'package.json'), 'utf8')).scripts?.['test:engine'] ?? '';
const DISCOVERED_DIRS = [
  ...new Set(
    engineScript
      .split(/\s+/)
      .filter((tok) => tok.endsWith('*.test.mjs'))
      .map((tok) => `web/${dirname(tok)}/`),
  ),
];
if (engineScript && DISCOVERED_DIRS.length === 0) {
  fail('web/package.json test:engine matched no *.test.mjs globs: this guard can no longer see web suites');
}

// collectMjsFiles() skips node_modules, output/, data/ and any nested checkout
// (a linked worktree marks itself with a `.git` FILE, #3499), so a developer
// with a worktree open is not graded on somebody else's tree.
const suites = collectMjsFiles(ROOT)
  .map((f) => relative(ROOT, f).split(sep).join('/'))
  .filter((rel) => rel.endsWith('.test.mjs'));

if (suites.length === 0) {
  // An empty walk means the walk is broken, not that the repo has no tests;
  // passing here would report health while checking nothing.
  fail('collectMjsFiles() found no *.test.mjs at all: the walk is broken, not the repo');
} else {
  const where = [...DISCOVERED_ROOTS, ...DISCOVERED_DIRS].join(' or ');
  const orphans = suites.filter(
    (rel) =>
      !DISCOVERED_ROOTS.some((dir) => rel.startsWith(dir)) &&
      !DISCOVERED_DIRS.includes(`${dirname(rel)}/`),
  );
  if (orphans.length === 0) {
    pass(`all ${suites.length} *.test.mjs files live under ${where}`);
  } else {
    for (const rel of orphans) {
      fail(`${rel} is a *.test.mjs outside ${where}: no runner discovers it, move it under tests/ (or add its directory to web/package.json test:engine)`);
    }
  }
}
