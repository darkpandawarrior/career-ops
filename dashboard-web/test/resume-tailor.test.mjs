import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createTailoredResume, tailorMarkdown } from '../resume-tailor.mjs';

const CV = `# Alex Morgan

alex@example.test

## Summary

Backend engineer building reliable systems.

## Experience

### Senior Engineer - Example

2020 - Current

- Improved internal documentation.
- Built Java services backed by PostgreSQL.
- Mentored engineers.

## Skills

Java, PostgreSQL, Docker
`;

test('tailoring reorders existing evidence without inventing bullets', () => {
  const tailored = tailorMarkdown(CV, ['Java', 'PostgreSQL']);
  assert.ok(tailored.indexOf('Built Java services') < tailored.indexOf('Improved internal documentation'));
  for (const bullet of [
    'Improved internal documentation.',
    'Built Java services backed by PostgreSQL.',
    'Mentored engineers.',
  ]) assert.ok(tailored.includes(bullet));
});

test('tailored resume creates HTML, PDF, change notes, and an editing prompt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-tailor-'));
  await mkdir(path.join(root, 'config'), { recursive: true });
  await writeFile(path.join(root, 'cv.md'), CV);
  await writeFile(path.join(root, 'config', 'profile.yml'), `
candidate:
  full_name: Alex Morgan
  email: alex@example.test
target_roles:
  primary: [Senior Backend Engineer]
`);
  const artifact = await createTailoredResume(root, {
    id: 'job-1',
    type: 'job',
    title: 'Senior Backend Engineer',
    company: 'Northstar',
    url: 'https://example.test/jobs/1',
    score: 9,
    matchedTitle: 'Senior Backend Engineer',
    matchedSkills: ['Java', 'PostgreSQL'],
    supportingSkills: ['Docker'],
    recommendedSkillGaps: ['Kafka'],
    snippet: 'Java PostgreSQL Docker',
  });
  assert.ok(artifact.pdf.endsWith('.pdf'));
  assert.ok(artifact.pageCount >= 1);
  assert.match(await readFile(path.join(root, artifact.changes), 'utf8'), /Preserved every factual claim/);
  assert.match(await readFile(path.join(root, artifact.prompt), 'utf8'), /Do not invent skills/);
  assert.match(await readFile(path.join(root, artifact.html), 'utf8'), /Northstar/);
});
