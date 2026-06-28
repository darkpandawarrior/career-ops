import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import Busboy from 'busboy';

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

const FORMATS = Object.freeze({
  '.pdf': ['application/pdf'],
});

export async function acceptResumeUpload(request, root) {
  const draftId = randomUUID();
  const draftRoot = draftsRoot(root);
  const draftPath = path.join(draftRoot, draftId);
  await mkdir(draftPath, { recursive: true });
  try {
    const file = await receiveMultipartFile(request, draftPath);
    validateMetadata(file);
    if (file.size === 0) throw uploadError('empty_file', 'The uploaded resume is empty', 400);
    validateSignature(file.signature, file.extension, file.containsNull);
    const storedName = `resume${file.extension}`;
    await rename(file.temporaryPath, path.join(draftPath, storedName));
    const metadata = {
      draftId,
      originalName: file.originalName,
      storedName,
      extension: file.extension,
      declaredType: file.declaredType,
      size: file.size,
      createdAt: new Date().toISOString(),
      status: 'uploaded',
      nextStep: 'extract',
    };
    await writeFile(path.join(draftPath, 'metadata.json'), JSON.stringify(metadata, null, 2), { flag: 'wx' });
    await discardOtherDrafts(root, draftId);
    return publicDraft(metadata);
  } catch (error) {
    await rm(draftPath, { recursive: true, force: true });
    throw error;
  }
}

export async function readDraft(root, draftId) {
  const safeId = validateDraftId(draftId);
  try {
    const metadata = JSON.parse(await readFile(path.join(draftsRoot(root), safeId, 'metadata.json'), 'utf8'));
    return publicDraft(metadata);
  } catch {
    return null;
  }
}

export async function discardDraft(root, draftId) {
  const safeId = validateDraftId(draftId);
  await rm(path.join(draftsRoot(root), safeId), { recursive: true, force: true });
}

export async function discardOtherDrafts(root, keepDraftId) {
  const keep = validateDraftId(keepDraftId);
  const rootPath = draftsRoot(root);
  let entries = [];
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name !== keep)
    .map((entry) => rm(path.join(rootPath, entry.name), { recursive: true, force: true })));
}

export function sanitizeFilename(value) {
  const basename = path.basename(String(value || '').replaceAll('\\', '/')).trim();
  const cleaned = basename
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^a-zA-Z0-9._() -]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  return cleaned || 'resume';
}

function validateMetadata({ originalName, extension, declaredType }) {
  if (!FORMATS[extension]) {
    throw uploadError('unsupported_extension', 'Use a PDF resume', 415);
  }
  if (!FORMATS[extension].includes(declaredType)) {
    throw uploadError('unsupported_type', `The declared file type does not match ${extension}`, 415);
  }
  if (originalName === extension) throw uploadError('invalid_filename', 'Resume filename is invalid', 400);
}

function validateSignature(signature, extension) {
  if (extension === '.pdf' && signature.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw uploadError('invalid_pdf', 'The file does not have a valid PDF signature', 415);
  }
}

function receiveMultipartFile(request, draftPath) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({
        headers: request.headers,
        limits: {
          files: 1,
          fileSize: MAX_RESUME_BYTES,
          fields: 4,
          parts: 5,
        },
      });
    } catch {
      reject(uploadError('invalid_multipart', 'Upload must use multipart/form-data', 400));
      return;
    }

    let fileSeen = false;
    let filePromise = null;
    let failure = null;
    parser.on('file', (fieldName, file, info) => {
      if (fieldName !== 'resume' || fileSeen) {
        failure = uploadError('invalid_file_field', 'Upload exactly one file in the resume field', 400);
        file.resume();
        return;
      }
      fileSeen = true;
      const originalName = sanitizeFilename(info.filename);
      const extension = path.extname(originalName).toLowerCase();
      const declaredType = normalizeMime(info.mimeType);
      const temporaryPath = path.join(draftPath, 'resume.upload');
      const output = createWriteStream(temporaryPath, { flags: 'wx' });
      let size = 0;
      let signature = Buffer.alloc(0);
      let containsNull = false;
      let truncated = false;

      file.on('data', (chunk) => {
        size += chunk.length;
        if (signature.length < 16) signature = Buffer.concat([signature, chunk]).subarray(0, 16);
        if (!containsNull && chunk.includes(0)) containsNull = true;
      });
      file.on('limit', () => {
        truncated = true;
      });
      file.pipe(output);
      filePromise = new Promise((fileResolve, fileReject) => {
        output.on('error', fileReject);
        output.on('finish', () => {
          if (truncated) {
            fileReject(uploadError('file_too_large', `Resume must be ${formatMb(MAX_RESUME_BYTES)} MB or smaller`, 413));
            return;
          }
          fileResolve({
            originalName,
            extension,
            declaredType,
            temporaryPath,
            size,
            signature,
            containsNull,
          });
        });
      });
    });
    parser.on('filesLimit', () => {
      failure = uploadError('too_many_files', 'Upload only one resume file', 400);
    });
    parser.on('partsLimit', () => {
      failure = uploadError('too_many_parts', 'Upload contains too many form parts', 400);
    });
    parser.on('error', (error) => reject(uploadError('invalid_multipart', error.message, 400)));
    parser.on('close', async () => {
      try {
        if (failure) throw failure;
        if (!fileSeen || !filePromise) throw uploadError('missing_file', 'Choose a resume file to upload', 400);
        resolve(await filePromise);
      } catch (error) {
        reject(error);
      }
    });
    request.pipe(parser);
  });
}

function validateDraftId(value) {
  const id = String(value || '');
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) {
    throw uploadError('invalid_draft', 'Draft id is invalid', 400);
  }
  return id;
}

function publicDraft(metadata) {
  return {
    draftId: metadata.draftId,
    filename: metadata.originalName,
    extension: metadata.extension,
    declaredType: metadata.declaredType,
    size: metadata.size,
    createdAt: metadata.createdAt,
    status: metadata.status,
    nextStep: metadata.nextStep,
    extractedAt: metadata.extractedAt || null,
  };
}

function draftsRoot(root) {
  return path.join(root, 'data', 'onboarding-drafts');
}

function normalizeMime(value) {
  return String(value || 'application/octet-stream').split(';')[0].trim().toLowerCase();
}

function uploadError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function formatMb(bytes) {
  return Math.round(bytes / 1024 / 1024);
}
