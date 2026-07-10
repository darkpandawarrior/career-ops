// tests/scan-company-aliases.test.mjs — scan-time company+role dedup (#1742),
// ported from upstream. The scanner keys company+role dedup on the provider's
// company name (often the ATS org, e.g. "Intercom") which may differ from the
// tracker brand ("Fin"), and on a title a company mutates per requisition/
// location ("Engineer (Berlin)"). buildCompanyCanonicalizer + normalizeRoleForDedup
// collapse both so the same role is not re-evaluated.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nscan.mjs — company+role dedup (alias + title normalization) (#1742)');

try {
  const {
    buildCompanyCanonicalizer,
    normalizeRoleForDedup,
    companyRoleDedupKey,
  } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

  // -- Company alias canonicalization --
  const canon = buildCompanyCanonicalizer({ Fin: ['Intercom', 'Intercom Inc'] });
  if (canon('Intercom') === 'fin' && canon('intercom inc') === 'fin' && canon('Fin') === 'fin') {
    pass('buildCompanyCanonicalizer maps every alias and the canonical name to the canonical label');
  } else {
    fail(`alias canonicalization wrong: Intercom=${canon('Intercom')} "Intercom Inc"=${canon('intercom inc')} Fin=${canon('Fin')}`);
  }
  if (canon('Acme Corp') === 'acme corp') pass('unknown company passes through as lowercased text (unchanged behavior)');
  else fail(`unknown company should pass through: got ${canon('Acme Corp')}`);

  // Malformed / empty alias maps must not crash and must degrade to plain lowercase.
  const emptyCanon = buildCompanyCanonicalizer(undefined);
  const arrayCanon = buildCompanyCanonicalizer(['not', 'a', 'map']);
  const messyCanon = buildCompanyCanonicalizer({ '': ['x'], Fin: [null, 'Intercom', 42] });
  if (emptyCanon('Intercom') === 'intercom' && arrayCanon('Intercom') === 'intercom' && messyCanon('Intercom') === 'fin') {
    pass('canonicalizer tolerates undefined/array/messy alias config without crashing');
  } else {
    fail(`canonicalizer robustness wrong: empty=${emptyCanon('Intercom')} array=${arrayCanon('Intercom')} messy=${messyCanon('Intercom')}`);
  }

  const canonicalCollisionA = buildCompanyCanonicalizer({ Fin: ['Intercom'], Intercom: [] });
  const canonicalCollisionB = buildCompanyCanonicalizer({ Intercom: [], Fin: ['Intercom'] });
  if (canonicalCollisionA('Intercom') === 'intercom' && canonicalCollisionB('Intercom') === 'intercom') {
    pass('canonical company identities win alias collisions regardless of config order');
  } else {
    fail(`canonical alias collision is order-dependent: first=${canonicalCollisionA('Intercom')} second=${canonicalCollisionB('Intercom')}`);
  }

  const ambiguousAliasA = buildCompanyCanonicalizer({ Fin: ['Shared ATS'], Acme: ['Shared ATS'] });
  const ambiguousAliasB = buildCompanyCanonicalizer({ Acme: ['Shared ATS'], Fin: ['Shared ATS'] });
  if (ambiguousAliasA('Shared ATS') === 'shared ats' && ambiguousAliasB('Shared ATS') === 'shared ats') {
    pass('ambiguous aliases fail open instead of merging companies by config order');
  } else {
    fail(`ambiguous alias should pass through: first=${ambiguousAliasA('Shared ATS')} second=${ambiguousAliasB('Shared ATS')}`);
  }

  // -- Title normalization (location suffix + punctuation + requisition-agnostic) --
  if (normalizeRoleForDedup('AI Infrastructure Engineer (Berlin)') === normalizeRoleForDedup('AI Infrastructure Engineer')) {
    pass('normalizeRoleForDedup strips a trailing location tag "(Berlin)"');
  } else {
    fail(`trailing location tag not stripped: "${normalizeRoleForDedup('AI Infrastructure Engineer (Berlin)')}"`);
  }
  if (normalizeRoleForDedup('Platform Engineer [Remote]') === normalizeRoleForDedup('Platform Engineer')) {
    pass('normalizeRoleForDedup strips a trailing remote tag "[Remote]"');
  } else {
    fail(`trailing remote tag not stripped: "${normalizeRoleForDedup('Platform Engineer [Remote]')}"`);
  }
  if (normalizeRoleForDedup('Senior Engineer (Senior) (Berlin, Germany)') === 'senior engineer senior') {
    pass('normalizeRoleForDedup strips location suffixes while preserving level qualifiers');
  } else {
    fail(`location suffix/level qualifier handling wrong: "${normalizeRoleForDedup('Senior Engineer (Senior) (Berlin, Germany)')}"`);
  }
  if (normalizeRoleForDedup('Engineer (Senior)') !== normalizeRoleForDedup('Engineer (Junior)')) {
    pass('normalizeRoleForDedup keeps trailing seniority variants distinct');
  } else {
    fail('trailing seniority variants over-merged distinct roles');
  }
  if (normalizeRoleForDedup('Engineering Manager, AI Models  Infrastructure') === normalizeRoleForDedup('Engineering Manager — AI Models Infrastructure')) {
    pass('normalizeRoleForDedup collapses punctuation/whitespace (comma vs em-dash, double space)');
  } else {
    fail('punctuation/whitespace not normalized');
  }
  // A mid-title parenthetical is NOT a trailing tag; its words are kept so two
  // genuinely different disciplines don't collapse.
  if (normalizeRoleForDedup('Engineer (Backend), Platform') !== normalizeRoleForDedup('Engineer (Frontend), Platform')) {
    pass('normalizeRoleForDedup keeps mid-title parentheticals distinct (no over-merge)');
  } else {
    fail('mid-title parentheticals over-merged distinct roles');
  }

  // -- End-to-end: the exact URL-new duplicate pairs that leaked before --
  const cases = [
    ['Intercom', 'AI Infrastructure Engineer (Berlin)', 'Fin', 'AI Infrastructure Engineer'],
    ['Intercom', 'Engineering Manager, AI Models Infrastructure', 'Fin', 'Engineering Manager, AI Models Infrastructure'],
    ['Intercom', 'Senior Product Engineer', 'Fin', 'Senior Product Engineer'],
  ];
  let allMatch = true;
  for (const [scanCo, scanTitle, trackCo, trackTitle] of cases) {
    const scanKey = companyRoleDedupKey(scanCo, scanTitle, canon);
    const trackKey = companyRoleDedupKey(trackCo, trackTitle, canon);
    if (scanKey !== trackKey) { allMatch = false; break; }
  }
  if (allMatch) pass('companyRoleDedupKey matches scan-side (Intercom + location-suffixed title) to tracker-side (Fin) across URL-new duplicate pairs');
  else fail('companyRoleDedupKey failed to unify a real-world URL-new duplicate pair');

  // Without an alias, distinct companies must still stay distinct.
  if (companyRoleDedupKey('Acme', 'Engineer', canon) !== companyRoleDedupKey('Globex', 'Engineer', canon)) {
    pass('companyRoleDedupKey keeps unrelated companies distinct');
  } else {
    fail('companyRoleDedupKey collapsed two unrelated companies');
  }
} catch (e) {
  fail(`scan company+role dedup tests crashed: ${e.message}`);
}
