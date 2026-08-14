// tests/rejection-latency-wiring.test.mjs — moved out of test-all.mjs into the
// fork's auto-discovered tests/ layout. Content is upstream's block, unchanged.

import { pass, fail, ROOT, NODE, fileExists } from './helpers.mjs';
// test-all.mjs's local readFile helper; tests/helpers.mjs exports fileExists but not this.
const readFile = (rel) => readFileSync(join(ROOT, rel), 'utf-8');
import { join } from 'path';
import { pathToFileURL } from 'url';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';

// ── REJECTION LATENCY (#2013) ───────────────────────────────────
// rejection-latency.mjs's own --self-test (invoked above via the CLI-check
// table) covers latency math, role-aware matching, and the suggestion-row
// format. This section pins the mode-doc wiring and the suggestion-only
// guarantees. (The signal ships a single courtesy-days threshold; a
// jurisdiction-backed statutory tier was removed — see PR #2014 review.)

console.log('\n71. Rejection-latency signal wired into followup mode (#2013)');

try {
  const followupModeDoc = readFile('modes/followup.md');
  const rejectionLatencySrc = readFile('rejection-latency.mjs');

  if (followupModeDoc.includes('rejection-latency.mjs')) {
    pass('followup mode runs rejection-latency.mjs and surfaces flags as reminders');
  } else {
    fail('followup mode missing the rejection-latency.mjs check step');
  }

  if (/Never write to `data\/blacklist\.md`/.test(followupModeDoc)) {
    pass('followup mode restates the suggestion-only blacklist guarantee (#1742)');
  } else {
    fail('followup mode missing the never-write blacklist guarantee for latency flags');
  }

  if (followupModeDoc.includes('[Render in {language.output}')) {
    pass('followup latency reminders use the {language.output} localization pattern');
  } else {
    fail('followup latency reminders missing the {language.output} localization pattern');
  }

  if (!/STATUTORY_THRESHOLDS|resolveJurisdiction|--jurisdiction/.test(rejectionLatencySrc)) {
    pass('rejection-latency.mjs carries no statutory tier (courtesy-only, CodeRabbit PR #2014 review)');
  } else {
    fail('rejection-latency.mjs still references the removed statutory tier / jurisdiction resolution');
  }

  if (rejectionLatencySrc.includes('not legal advice')) {
    pass('rejection-latency.mjs carries the not-legal-advice disclaimer');
  } else {
    fail('rejection-latency.mjs missing the not-legal-advice disclaimer');
  }

  // Read-only-ness, enforced structurally at the import boundary rather than
  // by pattern-matching call sites: every `fs` import must be a named import
  // from a whitelist of read-only APIs (no default/namespace import that
  // would smuggle in fs.writeFileSync/fs.promises), no require(), and no
  // dynamic import of fs — so no mutation API is reachable at all.
  const READ_ONLY_FS = new Set(['readFileSync', 'existsSync']);
  const fsImports = [...rejectionLatencySrc.matchAll(/import\s*(.*?)\s*from\s*['"]((?:node:)?fs(?:\/promises)?)['"]/g)];
  const fsImportViolations = [];
  for (const [, clause, module] of fsImports) {
    if (module.endsWith('/promises')) {
      // fs/promises is rejected wholesale: even its "read-only" surface sits
      // next to open(), which returns writable FileHandles that bypass any
      // mutation-name blacklist. The script has no async fs needs.
      fsImportViolations.push(module);
      continue;
    }
    const named = clause.match(/^\{([^}]*)\}$/);
    if (!named) {
      fsImportViolations.push(clause); // default or namespace import — full fs surface
      continue;
    }
    for (const name of named[1].split(',').map(s => s.trim()).filter(Boolean)) {
      if (!READ_ONLY_FS.has(name.replace(/\s+as\s+.*$/, ''))) fsImportViolations.push(name);
    }
  }
  if (fsImports.length > 0 && fsImportViolations.length === 0) {
    pass('rejection-latency.mjs fs imports are restricted to read-only APIs (readFileSync/existsSync)');
  } else {
    fail(`rejection-latency.mjs fs import surface is not read-only: ${fsImportViolations.join(', ') || 'no fs import found'}`);
  }

  if (!/\brequire\s*\(/.test(rejectionLatencySrc) && !/import\s*\(\s*['"](?:node:)?fs/.test(rejectionLatencySrc)) {
    pass('rejection-latency.mjs has no require() or dynamic fs import escape hatch');
  } else {
    fail('rejection-latency.mjs uses require() or a dynamic fs import — read-only guarantee not verifiable');
  }

  if (!/\b(?:writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|openSync|writeSync|unlinkSync|rmSync|rmdirSync|mkdirSync|renameSync|truncateSync|copyFileSync)\b/.test(rejectionLatencySrc)) {
    pass('rejection-latency.mjs references no filesystem mutation APIs (suggestion-only by construction)');
  } else {
    fail('rejection-latency.mjs contains file-write APIs; it must never write user data');
  }
} catch (e) {
  fail(`rejection-latency wiring check: ${e.message}`);
}

