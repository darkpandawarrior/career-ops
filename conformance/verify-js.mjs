#!/usr/bin/env node
// conformance/verify-js.mjs — runs every fixture in conformance/fixtures/
// against the LIVE JS functions and fails loudly on any mismatch.
//
// This is the thing that makes "extracted" and "authored" fixtures trustworthy
// at all: it proves the fixture's `expected` value is not a transcription
// error, by re-deriving it from the real implementation right now. A second
// (e.g. Kotlin) implementation that wants to consume this kit should treat a
// clean run of THIS script, on the commit it is pinned to, as a precondition —
// if the JS and its own fixtures disagree, the fixtures are not safe to port.
//
// Exit code: 0 = every fixture matches the live JS. 1 = at least one mismatch
// (printed with input/expected/actual), or a fixture file failed to load.
//
// No test framework, no process.exit() side effects hidden in a helper — this
// is a standalone CLI, not a discovered tests/*.test.mjs suite. See
// tests/conformance.test.mjs for the version wired into the engine suite.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sanitizeTsvField, sanitizeMarkdownField, sanitizePipelineUrl } from '../scan.mjs';
import { canonStatus } from '../web/src/lib/status-alias.mjs';
import { lockDirFor } from '../tracker-lock.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

// The only functions this kit currently covers. A fixture file naming a
// function key not in one of these maps fails loudly rather than being
// silently skipped.
const SANITIZER_FNS = { sanitizeTsvField, sanitizeMarkdownField, sanitizePipelineUrl };

// tracker-lock.mjs exposes only lockDirFor (a full path). The corpus pins the two pieces that
// actually decide mutual exclusion, so derive them from it rather than reaching into internals.
const LOCK_PREFIX = 'career-ops-merge-tracker-';
const LOCK_FNS = {
  lockDirName: (appsFile) => lockDirFor(appsFile).split(/[\\/]/).pop(),
  lockKey: (appsFile) => lockDirFor(appsFile).split(/[\\/]/).pop().slice(LOCK_PREFIX.length, -'.lock'.length),
};
const STATUS_FNS = { canonStatus };

/**
 * @returns {{ok: number, failures: string[]}}
 */
function verifySanitizers(path) {
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  if (doc.schemaVersion !== 1) throw new Error(`${path}: unsupported schemaVersion ${doc.schemaVersion}`);
  let ok = 0;
  const failures = [];
  for (const [fnName, cases] of Object.entries(doc.functions)) {
    const fn = SANITIZER_FNS[fnName];
    if (!fn) throw new Error(`${path}: fixture names unknown function "${fnName}"`);
    for (const c of cases) {
      const actual = fn(c.input);
      if (actual === c.expected) {
        ok++;
      } else {
        failures.push(
          `[sanitizers.json] ${fnName}(${JSON.stringify(c.input)}) [${c.id}]\n` +
          `    expected: ${JSON.stringify(c.expected)}\n` +
          `    actual:   ${JSON.stringify(actual)}\n` +
          `    note:     ${c.note ?? ''}`
        );
      }
    }
  }
  return { ok, failures };
}

/**
 * @returns {{ok: number, failures: string[]}}
 */
function verifyStatusAliases(path) {
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  if (doc.schemaVersion !== 1) throw new Error(`${path}: unsupported schemaVersion ${doc.schemaVersion}`);
  const fn = STATUS_FNS[doc.function];
  if (!fn) throw new Error(`${path}: fixture names unknown function "${doc.function}"`);
  let ok = 0;
  const failures = [];
  for (const c of doc.cases) {
    const actual = fn(c.input);
    // Matches doc.matchRule: substring, not equality — canonStatus returns a
    // token like "EVALUATED", not always byte-identical to the label.
    if (actual.includes(c.expectedLabel.toUpperCase())) {
      ok++;
    } else {
      failures.push(
        `[status-aliases.json] canonStatus(${JSON.stringify(c.input)}) [${c.id}]\n` +
        `    expected to include: ${c.expectedLabel.toUpperCase()} (state id "${c.expectedId}")\n` +
        `    actual:              ${actual}\n` +
        `    note:                ${c.note ?? ''}`
      );
    }
  }
  return { ok, failures };
}

function verifyTrackerLock(path) {
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  if (doc.schemaVersion !== 1) throw new Error(`${path}: unsupported schemaVersion ${doc.schemaVersion}`);
  let ok = 0;
  const failures = [];
  for (const [fnName, cases] of Object.entries(doc.functions)) {
    const fn = LOCK_FNS[fnName];
    if (!fn) throw new Error(`${path}: fixture names unknown function "${fnName}"`);
    for (const c of cases) {
      const actual = fn(c.input);
      if (actual === c.expected) {
        ok++;
      } else {
        failures.push(
          `[tracker-lock.json] ${fnName}(${JSON.stringify(c.input)}) [${c.id}]\n` +
          `    expected: ${JSON.stringify(c.expected)}\n` +
          `    actual:   ${JSON.stringify(actual)}\n` +
          `    note:     ${c.note ?? ''}`
        );
      }
    }
  }
  return { ok, failures };
}

const VERIFIERS = {
  'sanitizers.json': verifySanitizers,
  'status-aliases.json': verifyStatusAliases,
  'tracker-lock.json': verifyTrackerLock,
};

function main() {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json')).sort();
  let totalOk = 0;
  const allFailures = [];
  for (const file of files) {
    const verify = VERIFIERS[file];
    if (!verify) {
      allFailures.push(`${file}: no verifier registered in conformance/verify-js.mjs — add one before trusting this fixture`);
      continue;
    }
    const { ok, failures } = verify(join(FIXTURES_DIR, file));
    totalOk += ok;
    allFailures.push(...failures);
  }

  if (allFailures.length > 0) {
    console.error(`\n❌ conformance/verify-js.mjs: ${allFailures.length} fixture(s) disagree with the live JS (${totalOk} passed):\n`);
    for (const f of allFailures) console.error(f + '\n');
    process.exitCode = 1;
    return;
  }
  console.log(`✅ conformance/verify-js.mjs: all ${totalOk} fixture cases across ${files.length} file(s) match the live JS.`);
}

main();
