// tests/zh-minimal-template.test.mjs — templates/cv-template.zh-minimal.html
// (#1990) must be discoverable through cv-templates.mjs and keep its
// restrained single-accent design (no leftover hsl(270...) purple from the
// base template, chip-free competency tags).
//
// Upstream also covers full-payload rendering and A4 print-layout overflow.
// The rendering check is ported below: this fork DID carry build-cv-html.mjs in
// the end, so the older note here claiming it had no renderer to run was stale.
// The A4 overflow check stays unported — it needs a Chromium download that this
// fork's suite does not require, and upstream itself skips it when Chromium is
// absent, so it would be a permanent no-op here.
import { readFileSync, mkdtempSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
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

// Full mixed-language payload renders: language attribute, Chinese content and
// English-in-Chinese phrases survive, and no placeholder is left unresolved.
{
  const dir = mkdtempSync(join(tmpdir(), 'zh-minimal-'));
  const input = join(dir, 'cv.json');
  const output = join(dir, 'cv.html');
  writeFileSync(input, JSON.stringify({
    lang: 'zh-CN',
    page_format: 'a4',
    candidate: { name: '测试候选人', email: 'candidate@example.com', location: '中国｜杭州' },
    sections: {
      summary: '个人简介', competencies: '核心能力', experience: '工作经历',
      projects: '精选项目', education: '教育经历', certifications: '认证', skills: '技术栈',
    },
    summary: '全栈工程师，负责 AI Agent 工作流与生产部署。',
    competencies: ['AI Agent 工作流', '后端 API 工程', '生产部署'],
    experience: [{
      company: '示例科技有限公司', role: '全栈开发工程师', dates: '2025.01 至今',
      bullets: ['交付 React、FastAPI 与数据库组成的生产系统。'],
    }],
    projects: [{ name: '开源自动化项目', badge: '开源', tech: 'Node.js · Playwright', description: '构建可验证的自动化流程。' }],
    education: [{ title: '计算机科学与技术', org: '示例大学', year: '2025' }],
    certifications: [],
    skills: [{ category: '工程能力', items: ['TypeScript', 'FastAPI', 'Docker'] }],
  }), 'utf-8');

  try {
    execFileSync(process.execPath, ['build-cv-html.mjs', input, output, TEMPLATE_PATH], { cwd: ROOT, stdio: 'pipe' });
    const rendered = readFileSync(output, 'utf8');
    const checks = [
      [/<html lang="zh-CN"/, 'declares lang="zh-CN"'],
      [/测试候选人/, 'renders the candidate name'],
      [/AI Agent 工作流/, 'renders a mixed Chinese/English competency'],
    ];
    const missing = checks.filter(([re]) => !re.test(rendered)).map(([, why]) => why);
    const leftover = rendered.match(/\{\{[A-Z_]+\}\}/g);
    if (missing.length === 0 && !leftover) {
      pass('a full zh-CN payload renders through build-cv-html.mjs with no unresolved placeholders');
    } else {
      fail(`zh-minimal render: missing=${JSON.stringify(missing)} leftover=${JSON.stringify(leftover)}`);
    }
  } catch (e) {
    fail(`build-cv-html.mjs failed on the zh-minimal template: ${e.message}`);
  }
}
