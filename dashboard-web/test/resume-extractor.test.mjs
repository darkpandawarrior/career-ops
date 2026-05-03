import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { reconstructPdfPage } from '../onboarding/pdf-layout.mjs';
import { extractResumeDraft, readExtraction } from '../onboarding/resume-extractor.mjs';
import { structureResume } from '../onboarding/resume-normalizer.mjs';

const SAMPLE_RESUME = [
  'Fictional Candidate',
  'fictional@example.test',
  '',
  'Summary',
  'Android engineer building reliable mobile products.',
  '',
  'Experience',
  'Senior Android Engineer, Example Labs',
  'June 2021 - Current',
  '- Reduced startup latency by 35 percent.',
  '',
  'Technical Skills: Kotlin, Jetpack Compose, Coroutines, Room, Hilt',
  '',
  'Education',
  'BSc Computer Science, Example University',
].join('\n');

test('normalizes text and detects standalone and inline resume headings', () => {
  const result = structureResume(SAMPLE_RESUME.replaceAll('\n', '\r\n'));
  assert.equal(result.sections[0].key, 'header');
  assert.deepEqual(result.diagnostics.recognizedSections, ['summary', 'experience', 'skills', 'education']);
  assert.equal(result.diagnostics.readyForInference, true);
});

test('accepts entry-level resumes and preserves unfamiliar relevant sections', () => {
  const result = structureResume([
    'Entry Candidate',
    'entry@example.test',
    '',
    'PROFILE SUMMARY',
    'Data analyst seeking a first professional role.',
    '',
    'TECHNICAL SKILLS',
    'Python, SQL, Tableau',
    '',
    'PROJECTS',
    'Built a sales dashboard using Tableau.',
    '',
    'JOB SIMULATIONS',
    'Analyzed campaign performance and recommended improvements.',
    '',
    'LEADERSHIP AND COMMUNITY',
    'Led the university analytics club.',
    '',
    'EDUCATION',
    'BSc Statistics, Example University',
  ].join('\n'));
  assert.equal(result.diagnostics.readyForInference, true);
  assert.ok(result.sections.some((section) => section.key === 'simulations'));
  assert.ok(result.sections.some((section) =>
    section.key === 'custom_leadership_and_community' && section.searchRelevant
  ));
});

test('keeps employer names followed by dates inside the experience section', () => {
  const result = structureResume([
    'Experienced Candidate',
    '',
    'EXPERIENCE',
    'CheQ',
    'June 2025 - Current',
    'Software Engineer',
    'Samsung Research And Development Institute',
    'July 2022 - October 2024',
    'Senior Engineer',
    'Incedo Inc',
    'June 2021 - June 2022',
    'Software Development Engineer',
    '',
    'TECHNICAL SKILLS',
    'Kotlin, Java, Android, Git, Gradle',
  ].join('\n'));
  const experience = result.sections.find((section) => section.key === 'experience');
  assert.match(experience.text, /Samsung Research And Development Institute/);
  assert.match(experience.text, /Incedo Inc/);
  assert.ok(!result.sections.some((section) => section.key.startsWith('custom_samsung')));
});

test('reconstructs a conventional single-column PDF in reading order', () => {
  const result = reconstructPdfPage([
    item('Fictional Candidate', 60, 740, 130),
    item('Summary', 60, 700, 55),
    item('Android engineer', 60, 680, 120),
    item('Experience', 60, 640, 70),
    item('Senior Android Engineer', 60, 620, 150),
    item('Technical Skills', 60, 580, 90),
    item('Kotlin, Compose, Room', 60, 560, 150),
    item('Education', 60, 520, 65),
  ], { width: 612 });
  assert.equal(result.columns, 1);
  assert.ok(result.text.indexOf('Summary') < result.text.indexOf('Experience'));
});

test('reconstructs two-column sidebar PDFs without interleaving rows', () => {
  const result = reconstructPdfPage([
    item('Fictional Candidate', 50, 750, 500),
    item('Skills', 50, 700, 60),
    item('Kotlin', 50, 680, 60),
    item('Compose', 50, 660, 70),
    item('Education', 50, 620, 75),
    item('University', 50, 600, 80),
    item('Experience', 260, 700, 80),
    item('Senior Android Engineer', 260, 680, 180),
    item('June 2021 - Current', 260, 660, 130),
    item('Built reliable apps', 260, 640, 150),
  ], { width: 612 });
  assert.equal(result.columns, 2);
  assert.ok(result.text.indexOf('Skills') < result.text.indexOf('Education'));
  assert.ok(result.text.indexOf('Education') < result.text.indexOf('Experience'));
});

test('detects and reconstructs three-column PDF layouts', () => {
  const result = reconstructPdfPage([
    item('Candidate', 40, 750, 500),
    item('Skills', 40, 700, 55), item('Kotlin', 40, 680, 55), item('Room', 40, 660, 45),
    item('Experience', 220, 700, 75), item('Android Engineer', 220, 680, 120), item('2021 - 2023', 220, 660, 90),
    item('Projects', 420, 700, 60), item('Payments App', 420, 680, 100), item('Compose UI', 420, 660, 85),
  ], { width: 612 });
  assert.equal(result.columns, 3);
  assert.ok(result.text.indexOf('Room') < result.text.indexOf('Experience'));
  assert.ok(result.text.indexOf('2021 - 2023') < result.text.indexOf('Projects'));
});

test('extracts and structures a selectable-text PDF with PDF.js', async () => {
  const fixture = await createDraft(buildPdf(SAMPLE_RESUME.split('\n').filter(Boolean)));
  const extraction = await extractResumeDraft(fixture.root, fixture.draftId);
  assert.equal(extraction.pages, 1);
  assert.ok(extraction.preview.includes('Fictional Candidate'));
  assert.ok(extraction.sections.some((section) => section.key === 'experience'));
  assert.ok(extraction.sections.some((section) => section.key === 'skills'));
  assert.equal((await readExtraction(fixture.root, fixture.draftId)).draftId, fixture.draftId);
  const metadata = JSON.parse(await readFile(fixture.metadataPath, 'utf8'));
  assert.equal(metadata.status, 'extracted');
});

async function createDraft(bytes) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-extract-'));
  const draftId = '12345678-1234-4234-8234-123456789012';
  const draftPath = path.join(root, 'data', 'onboarding-drafts', draftId);
  const metadataPath = path.join(draftPath, 'metadata.json');
  await mkdir(draftPath, { recursive: true });
  await writeFile(path.join(draftPath, 'resume.pdf'), bytes);
  await writeFile(metadataPath, JSON.stringify({
    draftId,
    originalName: 'fictional.pdf',
    storedName: 'resume.pdf',
    extension: '.pdf',
    declaredType: 'application/pdf',
    size: bytes.length,
    createdAt: new Date().toISOString(),
    status: 'uploaded',
    nextStep: 'extract',
  }));
  return { root, draftId, metadataPath };
}

function item(str, x, y, width) {
  return { str, transform: [12, 0, 0, 12, x, y], width, height: 12, hasEOL: true };
}

function buildPdf(lines) {
  const escaped = lines.map((line) => line.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)'));
  const commands = escaped.map((line, index) => `${index === 0 ? '72 740 Td' : '0 -22 Td'} (${line}) Tj`).join('\n');
  const stream = `BT\n/F1 12 Tf\n${commands}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
