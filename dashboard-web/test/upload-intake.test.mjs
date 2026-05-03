import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  acceptResumeUpload,
  discardDraft,
  MAX_RESUME_BYTES,
  readDraft,
  sanitizeFilename,
} from '../onboarding/upload-intake.mjs';

test('accepts one valid multipart PDF into ignored draft storage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-upload-'));
  const request = multipartRequest({
    filename: 'fictional-resume.pdf',
    mimeType: 'application/pdf',
    content: Buffer.from('%PDF-1.7\nfictional resume'),
  });
  const draft = await acceptResumeUpload(request, root);
  assert.equal(draft.filename, 'fictional-resume.pdf');
  assert.equal(draft.status, 'uploaded');
  assert.equal((await readDraft(root, draft.draftId)).draftId, draft.draftId);
  assert.equal(
    await readFile(path.join(root, 'data', 'onboarding-drafts', draft.draftId, 'resume.pdf'), 'utf8'),
    '%PDF-1.7\nfictional resume',
  );
});

test('rejects a PDF with a mismatched signature', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-upload-'));
  const request = multipartRequest({
    filename: 'not-really.pdf',
    mimeType: 'application/pdf',
    content: Buffer.from('plain text'),
  });
  await assert.rejects(
    acceptResumeUpload(request, root),
    (error) => error.code === 'invalid_pdf' && error.status === 415,
  );
});

test('rejects unsupported executable-style extensions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-upload-'));
  const request = multipartRequest({
    filename: 'resume.html',
    mimeType: 'text/html',
    content: Buffer.from('<script>alert(1)</script>'),
  });
  await assert.rejects(
    acceptResumeUpload(request, root),
    (error) => error.code === 'unsupported_extension' && error.status === 415,
  );
});

test('rejects formerly supported non-PDF resume formats', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-upload-'));
  const request = multipartRequest({
    filename: 'resume.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    content: Buffer.from('PK fictional'),
  });
  await assert.rejects(
    acceptResumeUpload(request, root),
    (error) => error.code === 'unsupported_extension' && /PDF/.test(error.message),
  );
});

test('enforces the 10 MB resume limit while streaming', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-upload-'));
  const request = multipartRequest({
    filename: 'oversized.pdf',
    mimeType: 'application/pdf',
    content: Buffer.alloc(MAX_RESUME_BYTES + 1, 65),
  });
  await assert.rejects(
    acceptResumeUpload(request, root),
    (error) => error.code === 'file_too_large' && error.status === 413,
  );
});

test('upload staging never overwrites active profile files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'career-ops-upload-'));
  await mkdir(path.join(root, 'config'), { recursive: true });
  await writeFile(path.join(root, 'cv.md'), 'ACTIVE CV');
  await writeFile(path.join(root, 'config', 'profile.yml'), 'candidate:\n  full_name: Active Candidate\n');
  const request = multipartRequest({
    filename: 'replacement.pdf',
    mimeType: 'application/pdf',
    content: Buffer.from('%PDF-1.7\nDraft replacement'),
  });
  const draft = await acceptResumeUpload(request, root);
  assert.equal(await readFile(path.join(root, 'cv.md'), 'utf8'), 'ACTIVE CV');
  assert.match(await readFile(path.join(root, 'config', 'profile.yml'), 'utf8'), /Active Candidate/);
  await discardDraft(root, draft.draftId);
  assert.equal(await readDraft(root, draft.draftId), null);
});

test('sanitizes traversal and unusual filename characters', () => {
  assert.equal(sanitizeFilename('../../résumé final?.pdf'), 'r_sum_ final_.pdf');
});

function multipartRequest({ filename, mimeType, content }) {
  const boundary = '----career-ops-test-boundary';
  const head = Buffer.from([
    `--${boundary}`,
    `Content-Disposition: form-data; name="resume"; filename="${filename}"`,
    `Content-Type: ${mimeType}`,
    '',
    '',
  ].join('\r\n'));
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const request = Readable.from(Buffer.concat([head, content, tail]));
  request.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
    'content-length': String(head.length + content.length + tail.length),
  };
  return request;
}
