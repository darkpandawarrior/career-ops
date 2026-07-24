// tests/zh-minimal-template.test.mjs — templates/cv-template.zh-minimal.html
// (#1990) must be discoverable through cv-templates.mjs and keep its
// restrained single-accent design (no leftover hsl(270...) purple from the
// base template, chip-free competency tags).
//
// Upstream also covers full-payload rendering and A4 print-layout overflow by
// running build-cv-html.mjs — this fork never carried that deterministic HTML
// renderer (CVs are filled directly by the pdf mode's agent flow; see
// modes/pdf.md and cv-sections-core.mjs's header comment), so those two
// rendering checks have no script to run here and are intentionally not
// ported. The static template checks below still guard the template's own
// contract.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { listTemplates, resolveTemplate, validateTemplate } from '../cv-templates.mjs';

console.log('\ntemplates/cv-template.zh-minimal.html — Chinese Minimal CV template');

const TEMPLATE_PATH = join(ROOT, 'templates', 'cv-template.zh-minimal.html');

const listed = listTemplates('cv').find((item) => item.name === 'zh-minimal');
if (listed?.displayName === 'Chinese Minimal') {
  pass('zh-minimal template is discoverable via listTemplates("cv")');
} else {
  fail(`zh-minimal template not discoverable or wrong displayName: ${JSON.stringify(listed)}`);
}

if (resolveTemplate('cv', 'zh-minimal') === TEMPLATE_PATH) {
  pass('resolveTemplate("cv", "zh-minimal") resolves to the shipped template file');
} else {
  fail('resolveTemplate("cv", "zh-minimal") did not resolve to templates/cv-template.zh-minimal.html');
}

const validation = validateTemplate(TEMPLATE_PATH, 'cv');
if (validation.ok) {
  pass('zh-minimal template has all required placeholders (NAME, EXPERIENCE, EDUCATION)');
} else {
  fail(`zh-minimal template missing required placeholders: ${validation.missing.join(', ')}`);
}

const html = readFileSync(TEMPLATE_PATH, 'utf8');

if (/--zhm-accent:\s*#174a7e/.test(html)) {
  pass('zh-minimal template defines its single restrained accent color');
} else {
  fail('zh-minimal template is missing the expected --zhm-accent color');
}

if (/\.header-gradient\s*\{[^}]*height:\s*1px[^}]*background:\s*var\(--zhm-ink\)/s.test(html)) {
  pass('zh-minimal template replaces the gradient header rule with a flat 1px ink line');
} else {
  fail('zh-minimal template header-gradient rule does not match the restrained single-line design');
}

if (/\.competency-tag\s*\{[^}]*background:\s*none[^}]*border:\s*0/s.test(html)) {
  pass('zh-minimal template removes chip styling from competency tags');
} else {
  fail('zh-minimal template still has chip-styled competency tags');
}

const designSection = html.slice(html.indexOf('CHINESE MINIMAL DESIGN'));
if (!/hsl\(270/.test(designSection)) {
  pass('zh-minimal template does not carry over the base template\'s purple accent (hsl(270...))');
} else {
  fail('zh-minimal template still references the base template\'s hsl(270...) purple accent');
}
