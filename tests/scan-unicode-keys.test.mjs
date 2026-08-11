// tests/scan-unicode-keys.test.mjs — moved out of test-all.mjs into the fork's
// auto-discovered tests/ layout (test-all.mjs here delegates to tests/, unlike
// upstream's monolith). Content is upstream's block, unchanged.

import { pass, fail, ROOT, NODE, fileExists } from './helpers.mjs';
// test-all.mjs's local readFile helper; tests/helpers.mjs exports fileExists but not this.
const readFile = (rel) => readFileSync(join(ROOT, rel), 'utf-8');
import { join } from 'path';
import { pathToFileURL } from 'url';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';


// ── 45c. SCAN DEDUP/MATCH KEYS ARE UNICODE-AWARE ─────────────────────
// Follow-up to #2393/#2397/#2445: those routed the tracker-side keys through
// normalizeTextKey, but scan.mjs still carried two private [a-z0-9] strips.
// On a non-Latin pipeline that strip erases the whole string, so:
//   - normalizeRoleForDedup keyed EVERY Japanese title to '', making two
//     genuinely different roles at one company share a dedupe key — the scan
//     then discarded the second as already-seen.
//   - companyMatch cleaned both sides to '' and its `c1 === c2` equality check
//     reported two unrelated companies as a match.
// Both directions are asserted: distinct inputs must stay distinct, and the
// controls confirm the checks still fire on genuinely identical input.

console.log('\n45c. Scan dedup/match keys are Unicode-aware (non-Latin pipelines)');
try {
  const {
    normalizeRoleForDedup,
    companyRoleDedupKey,
    companyMatch,
  } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
  const { normalizeTextKey } = await import(pathToFileURL(join(ROOT, 'tracker-parse.mjs')).href);

  // -- Discrimination: distinct non-Latin roles must not share a dedupe key --
  const beKey = companyRoleDedupKey('株式会社アカネ', 'バックエンドエンジニア');
  const feKey = companyRoleDedupKey('株式会社アカネ', 'フロントエンドエンジニア');
  if (beKey !== feKey) {
    pass('companyRoleDedupKey keeps two distinct Japanese roles at one company apart');
  } else {
    fail(`distinct Japanese roles collapsed to one dedupe key: ${JSON.stringify(beKey)}`);
  }

  // The role half must actually carry the title, not an empty remainder.
  if (normalizeRoleForDedup('バックエンドエンジニア') !== '') {
    pass('normalizeRoleForDedup preserves a non-Latin title instead of keying it to ""');
  } else {
    fail('normalizeRoleForDedup erased a non-Latin title');
  }

  // -- Discrimination: unrelated non-Latin companies must not match --
  if (companyMatch('株式会社アカネ', '合同会社ゾロ') === false) {
    pass('companyMatch keeps two unrelated Japanese companies apart');
  } else {
    fail('companyMatch reported two unrelated Japanese companies as a match');
  }

  // An empty/absent company on both sides is "no signal", never "identical".
  if (companyMatch('', '') === false && companyMatch(null, undefined) === false) {
    pass('companyMatch treats empty/absent company names as no-match, not as equal');
  } else {
    fail('companyMatch matched two empty/absent company names');
  }

  // -- Controls: the checks must still fire on equivalent input --
  // Comparing a call against itself would be a tautology (a pure function on
  // the same arguments), so these vary the surface form instead — half-width
  // katakana and full-width spacing — and additionally require the shared key
  // to carry the role. Equality alone would still hold if both sides keyed to
  // '', which is precisely the bug being fixed.
  const ctrlKey = companyRoleDedupKey('株式会社アカネ', 'バックエンドエンジニア');
  const ctrlKeyVariant = companyRoleDedupKey('株式会社アカネ', '　ﾊﾞｯｸｴﾝﾄﾞｴﾝｼﾞﾆｱ　');
  if (ctrlKey === ctrlKeyVariant && ctrlKey !== '株式会社アカネ::') {
    pass('control: equivalent Japanese company+role (half-width kana, full-width spacing) still dedupes to one non-empty key');
  } else {
    fail(`control failed: ${JSON.stringify(ctrlKey)} vs ${JSON.stringify(ctrlKeyVariant)}`);
  }
  if (companyMatch('株式会社アカネ', '　株式会社ｱｶﾈ　') === true) {
    pass('control: equivalent Japanese company names (half-width kana, full-width spacing) still match');
  } else {
    fail('control failed: equivalent Japanese company names no longer match');
  }

  // NFKC folds half-width katakana onto the canonical form, so the same title
  // typed either way is one role rather than two.
  // Assert non-empty as well as equal: with the old [a-z0-9] strip both sides
  // keyed to '' and an equality-only assertion would have passed vacuously.
  const halfWidthKey = normalizeRoleForDedup('ｴﾝｼﾞﾆｱ');
  if (halfWidthKey !== '' && halfWidthKey === normalizeRoleForDedup('エンジニア')) {
    pass('normalizeRoleForDedup folds half-width katakana onto full-width (NFKC)');
  } else {
    fail(`half-width/full-width katakana keys wrong: ${JSON.stringify(halfWidthKey)}`);
  }

  // The NFKC pass in normalizeRoleForDedup runs BEFORE the trailing-suffix loop,
  // which is the only thing it is there for: normalizeTextKey already NFKCs at
  // the end, so any assertion on the final key alone cannot detect whether the
  // early pass exists. Full-width brackets are the observable difference — the
  // suffix matcher only recognizes ASCII "(" / "[", so without the early fold
  // "Engineer （Remote）" keeps its tag and keys as 'engineer remote'.
  if (normalizeRoleForDedup('Engineer （Remote）') === 'engineer'
      && normalizeRoleForDedup('Engineer ［Berlin］') === 'engineer') {
    pass('normalizeRoleForDedup strips full-width bracketed location/remote tags (NFKC before suffix loop)');
  } else {
    fail(`full-width bracketed suffix not stripped: ${JSON.stringify(normalizeRoleForDedup('Engineer （Remote）'))}`);
  }

  // -- Regression: Latin behavior and the space-separated key shape are unchanged --
  if (normalizeRoleForDedup('Senior Engineer (Senior) (Berlin, Germany)') === 'senior engineer senior') {
    pass('regression: Latin role keys keep their space-separated shape');
  } else {
    fail(`Latin role key shape changed: ${JSON.stringify(normalizeRoleForDedup('Senior Engineer (Senior) (Berlin, Germany)'))}`);
  }
  if (companyMatch('Acme Inc.', 'acme inc') === true && companyMatch('Acme', 'Zoro Inc') === false) {
    pass('regression: Latin companyMatch still matches equivalents and rejects unrelated names');
  } else {
    fail('Latin companyMatch behavior changed');
  }

  // -- Accented Latin: the containment fallback must survive keeping the accent --
  // Before this change the [a-z0-9] strip turned é into a space, which left the
  // \b anchors sitting on ASCII letters, so 'Nestlé Deutschland' vs 'Nestlé'
  // matched. Preserving the accent breaks \b (it is ASCII-only in JS even under
  // the u flag), so the anchors are Unicode lookarounds. A pure-ASCII assertion
  // cannot detect this — the accent has to be at a word edge.
  const accented = [
    ['Nestlé Deutschland', 'Nestlé'],
    ['Ørsted Energy', 'Ørsted'],
    ['Zoë Ltd', 'Zoë'],
    ['Telefónica Tech', 'Telefónica'],   // accent mid-word: matched on main too
  ];
  const accentedMiss = accented.filter(([a, b]) => companyMatch(a, b) !== true);
  if (accentedMiss.length === 0) {
    pass('companyMatch still matches accented Latin names at a word edge (Nestlé, Ørsted, Zoë)');
  } else {
    fail(`accented Latin containment lost: ${JSON.stringify(accentedMiss)}`);
  }

  // The boundary must still bound: a prefix that is not a whole word stays out.
  if (companyMatch('Acme', 'Acmetric Ltd') === false && companyMatch('Nestlé', 'Danone') === false) {
    pass('companyMatch keeps the containment fallback bounded (no bare-substring matching)');
  } else {
    fail('containment fallback over-matched: a non-word-boundary prefix was accepted');
  }

  // The anchor class must be the same one normalizeTextKey keeps, so a mark or
  // a digit at the edge is a letter to the boundary too. Both witnesses put the
  // character *immediately* after the candidate: a case where the next
  // character is a space passes whatever the anchor class is, and would assert
  // nothing. Each one flips if its class is dropped from the lookarounds.
  const matraWitness = companyMatch('टाटा कंपनीी', 'टाटा कंपनी');       // \p{M}
  const digitWitness = companyMatch('Acme2 Ltd', 'Acme');               // \p{N}
  if (matraWitness === false && digitWitness === false) {
    pass('companyMatch anchors treat combining marks and digits as letters (no split mid-word)');
  } else {
    fail(`anchor class too narrow: matra=${matraWitness} digit=${digitWitness} (both should be false)`);
  }
  // Positive direction: a genuine non-Latin containment with a space boundary.
  if (companyMatch('कंपनी सॉफ्टवेयर', 'कंपनी') === true) {
    pass('companyMatch matches a Devanagari name at a space boundary');
  } else {
    fail('Devanagari containment lost at a space boundary');
  }

  // normalizeTextKey's separator arg must not disturb its existing callers.
  if (normalizeTextKey('株式会社アカネ') === '株式会社アカネ'
      && normalizeTextKey('Acme, Inc.') === 'acmeinc'
      && normalizeTextKey('Acme, Inc.', ' ') === 'acme inc') {
    pass('normalizeTextKey default stays solid-key; separator arg only affects opt-in callers');
  } else {
    fail('normalizeTextKey separator arg changed default behavior');
  }
  if (normalizeTextKey(null) === '' && normalizeTextKey(undefined) === '') {
    pass('normalizeTextKey keys null/undefined to "" rather than "null"/"undefined"');
  } else {
    fail(`normalizeTextKey mis-keys nullish input: ${JSON.stringify(normalizeTextKey(null))}`);
  }
} catch (e) {
  fail(`scan Unicode dedup/match key tests crashed: ${e.message}`);
}

