/**
 * profile-registry-fault.test.mjs — an UNREADABLE profiles.yml must not read as
 * "single-profile mode".
 *
 * The two states were indistinguishable: absent and malformed both returned [],
 * so requestRoot() fell through to careerOpsRoot(). One YAML typo therefore
 * served the DEFAULT profile's tracker to a session that had explicitly selected
 * a different profile — plausible output, the wrong person's applications, and
 * nothing anywhere saying so. This pins the distinction.
 *
 * Colocated at web/src/lib/ (not web/tests/) per this fork's layout: node:test
 * globs the .mjs suites here, vitest globs *.test.{ts,tsx}.
 *
 * Run (from the repo root): node --test web/src/lib/profile-registry-fault.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALIAS_EXTS = ['.ts', '.tsx', '.mjs', '.js', '.mts'];
const loaderSrc = [
  "import { existsSync } from 'node:fs';",
  "import path from 'node:path';",
  "import { pathToFileURL } from 'node:url';",
  `const WEB_SRC = ${JSON.stringify(WEB_SRC)};`,
  `const EXTS = ${JSON.stringify(ALIAS_EXTS)};`,
  'function resolveWithExt(base) {',
  '  for (const ext of EXTS) { if (existsSync(base + ext)) return base + ext; }',
  '  if (existsSync(base)) return base;',
  '  return null;',
  '}',
  // next/headers is server-only and does not resolve under plain `node --test`
  // (it is a bundler-time export), so the module under test cannot even load.
  // Stub it with a headers() that throws — which is exactly what Next does
  // outside a request scope, and the path requestSlug() already handles.
  `const HEADERS_STUB = 'data:text/javascript,' + encodeURIComponent(`,
  `  "export function headers(){ throw new Error('headers() outside a request scope'); }"`,
  `);`,
  'export async function resolve(specifier, context, nextResolve) {',
  "  if (specifier === 'next/headers') return { url: HEADERS_STUB, shortCircuit: true };",
  "  if (specifier.startsWith('@/')) {",
  '    const rel = specifier.slice(2);',
  '    const base = path.join(WEB_SRC, rel);',
  '    const resolved = resolveWithExt(base);',
  '    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };',
  '  }',
  '  return nextResolve(specifier, context);',
  '}',
].join('\n');
register('data:text/javascript,' + encodeURIComponent(loaderSrc), pathToFileURL(WEB_SRC + '/'));

const { readRegistry, registryFault } = await import('./profile-registry.ts');

function withRoot(yamlText, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'co-registry-'));
  const prev = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = dir;
  try {
    if (yamlText !== null) writeFileSync(join(dir, 'profiles.yml'), yamlText);
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('an ABSENT profiles.yml is single-profile mode, and reports no fault', () => {
  withRoot(null, () => {
    assert.deepEqual(readRegistry(), []);
    assert.equal(registryFault(), null, 'absent must stay the silent, normal state');
  });
});

test('a VALID profiles.yml parses and reports no fault', () => {
  withRoot('profiles:\n  - name: lakshita\n    root: profiles/lakshita\n', () => {
    const reg = readRegistry();
    assert.equal(reg.length, 1);
    assert.equal(reg[0].name, 'lakshita');
    assert.equal(registryFault(), null);
  });
});

test('a MALFORMED profiles.yml is NOT single-profile mode — it reports a fault', () => {
  // Unclosed bracket: js-yaml throws rather than returning a document.
  withRoot('profiles: [ { name: lakshita, root: profiles/lakshita \n', () => {
    assert.deepEqual(readRegistry(), [], 'still yields no usable entries');
    const fault = registryFault();
    assert.ok(fault, 'a broken registry must be distinguishable from an absent one');
    assert.match(fault, /cannot parse/, 'the fault names what actually went wrong');
  });
});
