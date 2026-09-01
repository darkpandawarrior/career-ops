// tests/conformance.test.mjs — wires conformance/verify-js.mjs into the
// engine's own discovered suite, so a fixture/JS disagreement fails `node
// test-all.mjs` the same way any other regression does, instead of waiting
// for a second implementation (the Kotlin port) to notice it separately.
//
// conformance/ exists to close a gap the JS↔Kotlin drift tripwire cannot:
// core/engine/engine-port-manifest.tsv + EnginePortDriftTest catch the JS
// ORIGINAL moving out from under a pinned hash, but a hash only says "go
// look" — it cannot say the two implementations still AGREE. This suite is
// the JS-side half of that: it proves the fixtures conformance/fixtures/*.json
// hand to the Kotlin side are a faithful snapshot of the live JS behaviour,
// right now, on this commit.
//
// Deliberately re-implements the loop conformance/verify-js.mjs already runs,
// rather than shelling out to it: this suite must report through pass/fail
// like every other file under tests/ (see helpers.mjs's own note on why a
// silently-swallowed node:test failure was #3066-shaped), and importing the
// same fixtures + live functions directly keeps that possible without a
// child-process indirection. Keep the two in sync by hand if either changes
// its matching rule — conformance/README.md says as much.
import { pass, fail } from './helpers.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { sanitizeTsvField, sanitizeMarkdownField, sanitizePipelineUrl } from '../scan.mjs';
import { canonStatus } from '../web/src/lib/status-alias.mjs';
import { lockDirFor } from '../tracker-lock.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'conformance', 'fixtures');

console.log('\nconformance/ — fixture corpus matches the live JS');

const SANITIZER_FNS = { sanitizeTsvField, sanitizeMarkdownField, sanitizePipelineUrl };

// ── sanitizers.json ─────────────────────────────────────────────────
{
  const doc = JSON.parse(readFileSync(join(FIXTURES_DIR, 'sanitizers.json'), 'utf8'));
  if (doc.schemaVersion !== 1) {
    fail(`conformance/fixtures/sanitizers.json: unsupported schemaVersion ${doc.schemaVersion}`);
  } else {
    for (const [fnName, cases] of Object.entries(doc.functions)) {
      const fn = SANITIZER_FNS[fnName];
      if (!fn) {
        fail(`conformance/fixtures/sanitizers.json: names unknown function "${fnName}"`);
        continue;
      }
      const wrong = [];
      for (const c of cases) {
        const actual = fn(c.input);
        if (actual !== c.expected) {
          wrong.push(`${c.id}: ${fnName}(${JSON.stringify(c.input)}) = ${JSON.stringify(actual)}, want ${JSON.stringify(c.expected)}`);
        }
      }
      if (wrong.length === 0) {
        pass(`${fnName}: all ${cases.length} conformance fixture(s) match the live implementation`);
      } else {
        fail(`${fnName}: ${wrong.length} conformance fixture(s) disagree with the live implementation:\n    ${wrong.join('\n    ')}`);
      }
    }
  }
}

// ── status-aliases.json ─────────────────────────────────────────────
{
  const doc = JSON.parse(readFileSync(join(FIXTURES_DIR, 'status-aliases.json'), 'utf8'));
  if (doc.schemaVersion !== 1) {
    fail(`conformance/fixtures/status-aliases.json: unsupported schemaVersion ${doc.schemaVersion}`);
  } else if (doc.function !== 'canonStatus') {
    fail(`conformance/fixtures/status-aliases.json: names unknown function "${doc.function}"`);
  } else {
    const wrong = [];
    for (const c of doc.cases) {
      const actual = canonStatus(c.input);
      // matchRule in the fixture file: substring, not equality (see doc.matchRule).
      if (!actual.includes(c.expectedLabel.toUpperCase())) {
        wrong.push(`${c.id}: canonStatus(${JSON.stringify(c.input)}) = ${actual}, want to include ${c.expectedLabel.toUpperCase()}`);
      }
    }
    if (wrong.length === 0) {
      pass(`canonStatus: all ${doc.cases.length} conformance fixture(s) (derived from templates/states.yml) match the live implementation`);
    } else {
      fail(`canonStatus: ${wrong.length} conformance fixture(s) disagree with the live implementation:\n    ${wrong.join('\n    ')}`);
    }
  }
}

// ── tracker-lock.json ───────────────────────────────────────────────
// The lock's NAME is the whole of its mutual exclusion. Two implementations
// that derive different lock directories for the same tracker do not contend
// at all — both believe they hold it and write applications.md concurrently.
// Backoff and retry may differ harmlessly; this may not.
{
  const LOCK_PREFIX = 'career-ops-merge-tracker-';
  const base = (p) => lockDirFor(p).split(/[\\/]/).pop();
  const LOCK_FNS = {
    lockDirName: base,
    lockKey: (p) => base(p).slice(LOCK_PREFIX.length, -'.lock'.length),
  };
  const doc = JSON.parse(readFileSync(join(FIXTURES_DIR, 'tracker-lock.json'), 'utf8'));
  if (doc.schemaVersion !== 1) {
    fail(`conformance/fixtures/tracker-lock.json: unsupported schemaVersion ${doc.schemaVersion}`);
  } else {
    const bad = [];
    for (const [fnName, cases] of Object.entries(doc.functions)) {
      const fn = LOCK_FNS[fnName];
      if (!fn) {
        fail(`conformance/fixtures/tracker-lock.json: names unknown function "${fnName}"`);
        continue;
      }
      for (const c of cases) {
        const actual = fn(c.input);
        if (actual !== c.expected) {
          bad.push(`${fnName}(${JSON.stringify(c.input)}) = ${JSON.stringify(actual)}, want ${JSON.stringify(c.expected)}`);
        }
      }
    }
    if (bad.length) {
      fail(`tracker-lock: ${bad.length} conformance fixture(s) disagree with the live implementation:\n    ${bad.join('\n    ')}`);
    } else {
      pass('tracker-lock: every fixture case matches lockDirFor');
    }
  }
}

