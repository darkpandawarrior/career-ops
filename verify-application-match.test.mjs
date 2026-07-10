/**
 * verify-application-match.test.mjs — regression tests for the pre-submit
 * company/role/template-leak gate.
 *
 * Run: node verify-application-match.test.mjs
 */

import { verifyDraft, findLeakedTokens, findPlaceholderPhrases } from './verify-application-match.mjs';

let passed = 0;
let failed = 0;

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL: ${label}`);
    console.log(`    expected: ${e}`);
    console.log(`    actual:   ${a}`);
  }
}

eq(
  'clean draft with matching company+role passes',
  verifyDraft('Dear Acme Inc, I am excited to apply for the Senior Android Engineer role...', { company: 'Acme Inc', role: 'Senior Android Engineer' }).clean,
  true
);

eq(
  'leaked {{TOKEN}} fails the check',
  verifyDraft('Dear {{COMPANY}}, ...', {}).clean,
  false
);

eq(
  'leaked tokens are individually reported',
  findLeakedTokens('Dear {{COMPANY}}, regards {{NAME}}'),
  ['{{COMPANY}}', '{{NAME}}']
);

eq(
  'bracket placeholder text is caught',
  findPlaceholderPhrases('Dear [Hiring Manager], ...'),
  ['[hiring manager]']
);

eq(
  'draft addressed to a different company fails',
  verifyDraft('Dear Globex Corp, I am excited to apply...', { company: 'Acme Inc' }).clean,
  false
);

eq(
  'draft never mentioning the role title fails',
  verifyDraft('Dear Acme Inc, I would love to join your team.', { company: 'Acme Inc', role: 'Senior Android Engineer' }).clean,
  false
);

eq(
  'a role title with no discriminating tokens (stopwords only) is not checked',
  verifyDraft('Dear Acme Inc, thanks.', { company: 'Acme Inc', role: 'Senior Lead' }).clean,
  true
);

eq(
  'omitting company and role only checks for leaks/placeholders',
  verifyDraft('Some generic text with no company or role mentioned.', {}).clean,
  true
);

eq(
  'a bare, non-string draft does not crash the checker',
  verifyDraft(123, {}).clean,
  true
);

console.log(`\nverify-application-match: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
