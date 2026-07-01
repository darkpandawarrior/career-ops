import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import * as yaml from 'js-yaml';

import { renderHtmlToPdf } from '../generate-pdf.mjs';

export async function createTailoredResume(root, job) {
  if (!job || job.type === 'searchLead') throw tailorError('invalid_job', 'A real job posting is required', 400);
  const [cv, profileText] = await Promise.all([
    readFile(path.join(root, 'cv.md'), 'utf8'),
    readFile(path.join(root, 'config', 'profile.yml'), 'utf8'),
  ]);
  const profile = yaml.load(profileText) || {};
  const keywords = relevantKeywords(job);
  const tailoredMarkdown = tailorMarkdown(cv, keywords);
  const safe = slug(`${job.company}-${job.title}`);
  const outputDir = path.join(root, 'output', 'tailored-resumes');
  await mkdir(outputDir, { recursive: true });
  const htmlPath = path.join(outputDir, `${safe}.html`);
  const pdfPath = path.join(outputDir, `${safe}.pdf`);
  const notesPath = path.join(outputDir, `${safe}-changes.md`);
  const promptPath = path.join(outputDir, `${safe}-prompt.md`);
  const html = renderResumeHtml(tailoredMarkdown, profile, job);
  const notes = renderChangeNotes(job, keywords);
  const prompt = renderEditingPrompt(job, keywords);
  await Promise.all([
    writeFile(htmlPath, html, 'utf8'),
    writeFile(notesPath, notes, 'utf8'),
    writeFile(promptPath, prompt, 'utf8'),
  ]);
  let pdf;
  try {
    pdf = await renderHtmlToPdf(html, pdfPath, { format: 'a4', baseDir: root });
  } catch (error) {
    throw tailorError('pdf_generation_failed', `Tailored HTML and notes were created, but PDF generation failed: ${error.message}`, 500);
  }
  return {
    html: relative(root, htmlPath),
    htmlUrl: `/${relative(root, htmlPath)}`,
    pdf: relative(root, pdfPath),
    pdfUrl: `/${relative(root, pdfPath)}`,
    changes: relative(root, notesPath),
    changesUrl: `/${relative(root, notesPath)}`,
    prompt: relative(root, promptPath),
    promptUrl: `/${relative(root, promptPath)}`,
    pageCount: pdf.pageCount,
    sizeKb: Math.round(pdf.size / 1024),
    keywords,
  };
}

export function tailorMarkdown(cv, keywords) {
  const sections = parseSections(cv);
  return sections.map((section) => {
    if (!['experience', 'projects'].includes(section.key)) return section.raw;
    if (!/^###\s+/m.test(section.body)) return section.raw;
    const blocks = splitBlocks(section.body);
    const reordered = blocks.map((block) => reorderBullets(block, keywords));
    return `${section.heading}\n\n${reordered.join('\n\n')}`.trim();
  }).join('\n\n').trim() + '\n';
}

function parseSections(cv) {
  const chunks = String(cv).split(/(?=^##\s+)/m);
  return chunks.filter(Boolean).map((raw) => {
    const heading = raw.match(/^##\s+(.+)$/m)?.[0] || '';
    const title = heading.replace(/^##\s+/, '').trim();
    const body = heading ? raw.slice(raw.indexOf(heading) + heading.length).trim() : raw.trim();
    return { key: title.toLowerCase(), heading, body, raw: raw.trim() };
  });
}

function splitBlocks(body) {
  return String(body).split(/(?=^###\s+)/m).filter(Boolean).map((block) => block.trim());
}

function reorderBullets(block, keywords) {
  const lines = block.split('\n');
  const firstBullet = lines.findIndex((line) => isBullet(line));
  if (firstBullet < 0) return block;
  const prefix = lines.slice(0, firstBullet);
  const bullets = [];
  for (const line of lines.slice(firstBullet)) {
    if (isBullet(line)) bullets.push([line]);
    else if (bullets.length) bullets.at(-1).push(line);
  }
  if (bullets.length < 2) return block;
  bullets.sort((a, b) => keywordScore(b.join(' '), keywords) - keywordScore(a.join(' '), keywords));
  return [...prefix, ...bullets.flat()].join('\n').trim();
}

function keywordScore(value, keywords) {
  const lower = value.toLowerCase();
  return keywords.reduce((score, keyword) => score + (lower.includes(keyword.toLowerCase()) ? 1 : 0), 0);
}

function relevantKeywords(job) {
  return [...new Set([
    job.matchedTitle,
    ...(job.matchedSkills || []),
    ...(job.supportingSkills || []),
    ...extractTerms(`${job.title} ${job.snippet || ''}`),
  ].filter(Boolean))].slice(0, 12);
}

function extractTerms(value) {
  return String(value).split(/[^a-zA-Z0-9+#./-]+/)
    .filter((term) => term.length >= 4)
    .filter((term) => !/^(with|from|that|this|your|years|role|team|work)$/i.test(term))
    .slice(0, 8);
}

function renderResumeHtml(markdown, profile, job) {
  const candidate = profile.candidate || {};
  const sections = parseSections(markdown);
  const header = sections.shift()?.raw || '';
  const name = header.match(/^#\s+(.+)$/m)?.[1] || candidate.full_name || 'Candidate';
  const content = sections.map((section) => `
    <section>
      <h2>${escapeHtml(section.heading.replace(/^##\s+/, ''))}</h2>
      ${markdownBlock(section.body)}
    </section>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(name)} - ${escapeHtml(job.title)}</title>
<style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font:10.5pt/1.42 Arial,sans-serif;color:#17202a;margin:0}
h1{font-size:22pt;margin:0 0 4px}h2{font-size:12.5pt;border-bottom:1px solid #94a3b8;margin:14px 0 7px;padding-bottom:2px}
h3{font-size:10.8pt;margin:10px 0 2px;break-after:avoid}p{margin:3px 0}ul{margin:4px 0 7px;padding-left:18px}li{margin:2px 0;break-inside:avoid}
.contact{color:#475569;margin-bottom:10px}.target{font-size:9pt;color:#64748b;margin-bottom:10px}
</style></head><body>
<h1>${escapeHtml(name)}</h1>
<div class="contact">${escapeHtml([
    candidate.email,
    candidate.phone,
    candidate.location,
    candidate.linkedin,
    candidate.portfolio_url || candidate.github,
  ].filter(Boolean).join(' | '))}</div>
<div class="target">Tailored for ${escapeHtml(job.company)} - ${escapeHtml(job.title)}</div>
${content}
</body></html>`;
}

function markdownBlock(value) {
  const lines = String(value).split('\n');
  let html = '';
  let inList = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^###\s+/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h3>${escapeHtml(line.replace(/^###\s+/, ''))}</h3>`;
    } else if (isBullet(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      const parts = [stripBullet(line)];
      while (
        index + 1 < lines.length
        && lines[index + 1].trim()
        && !/^###\s+/.test(lines[index + 1])
        && !isBullet(lines[index + 1])
        && !looksLikeEmploymentHeader(lines, index + 1)
      ) {
        parts.push(lines[index + 1].trim());
        index += 1;
      }
      html += `<li>${escapeHtml(parts.join(' '))}</li>`;
    } else if (line.trim()) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${escapeHtml(line)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

function isBullet(value) {
  return /^\s*(?:[-*•]|â€¢)\s+/.test(value);
}

function stripBullet(value) {
  return String(value).replace(/^\s*(?:[-*•]|â€¢)\s+/, '').trim();
}

function looksLikeEmploymentHeader(lines, index) {
  const candidate = String(lines[index] || '').trim();
  const next = String(lines[index + 1] || '').trim();
  if (!candidate || candidate.length > 90 || !next) return false;
  return /^(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+)?(?:19|20)\d{2}\s*(?:-|–|—|to)\s*(?:present|current|now|(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+)?(?:19|20)\d{2})$/i.test(next);
}

function renderChangeNotes(job, keywords) {
  return [
    `# Tailoring Notes - ${job.company} - ${job.title}`,
    '',
    `Job URL: ${job.url}`,
    `Candidate-fit score: ${job.score}/10`,
    '',
    '## Changes Applied',
    '',
    '- Preserved every factual claim, date, employer, metric, and skill from the canonical CV.',
    '- Reordered existing bullets only inside clearly structured employer or project blocks.',
    '- Preserved original ordering where the canonical CV did not expose safe subsection boundaries.',
    '- Kept unsupported or recommended-gap skills out of the resume.',
    `- Prioritized evidence related to: ${keywords.join(', ') || 'the target role'}.`,
    '',
    '## Suggested Manual Review',
    '',
    '- Confirm the reordered bullets still reflect the emphasis you want.',
    '- Shorten low-relevance content if the generated PDF exceeds two pages.',
    '- Add a missing skill only when you can support it with real experience.',
    '- Review the PDF before using it in an application.',
    '',
  ].join('\n');
}

function renderEditingPrompt(job, keywords) {
  return [
    '# Resume Editing Prompt',
    '',
    'Use the canonical CV and the job details below to improve the tailored resume.',
    '',
    'Rules:',
    '- Do not invent skills, employers, dates, metrics, responsibilities, or achievements.',
    '- Prefer reordering, tightening, and reframing existing evidence.',
    '- Keep ATS-readable headings and plain formatting.',
    '- Explicitly flag any requested job skill that lacks supporting evidence.',
    '- Return a concise change summary before the revised resume.',
    '',
    `Target role: ${job.title}`,
    `Organization: ${job.company}`,
    `Job URL: ${job.url}`,
    `Relevant verified terms: ${keywords.join(', ') || 'None detected'}`,
    `Current skill gaps: ${(job.recommendedSkillGaps || []).join(', ') || 'None detected'}`,
    '',
  ].join('\n');
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || 'resume';
}

function relative(root, file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function tailorError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
