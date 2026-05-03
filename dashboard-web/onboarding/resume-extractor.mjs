import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { structureResume } from './resume-normalizer.mjs';
import { reconstructPdfPage } from './pdf-layout.mjs';

const DRAFT_ID_RE = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const MAX_EXTRACTED_CHARACTERS = 2_000_000;
const MAX_PDF_PAGES = 100;

export async function extractResumeDraft(root, draftId) {
  const id = validateDraftId(draftId);
  const draftPath = path.join(root, 'data', 'onboarding-drafts', id);
  const metadataPath = path.join(draftPath, 'metadata.json');
  let metadata;
  try {
    metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  } catch {
    throw extractionError('draft_not_found', 'The staged resume draft was not found', 404);
  }

  const resumePath = path.join(draftPath, metadata.storedName);
  const extracted = await extractByFormat(resumePath, metadata.extension);
  if (extracted.text.length > MAX_EXTRACTED_CHARACTERS) {
    throw extractionError('extracted_text_too_large', 'Extracted resume text exceeds the local safety limit', 422);
  }
  const structured = structureResume(extracted.text);
  const warnings = unique([...extracted.warnings, ...structured.warnings]);
  const result = {
    version: 1,
    draftId: id,
    format: metadata.extension.slice(1),
    extractedAt: new Date().toISOString(),
    pages: extracted.pages,
    text: structured.text,
    sections: structured.sections,
    diagnostics: {
      ...structured.diagnostics,
      pages: extracted.pages,
      format: metadata.extension.slice(1),
      layout: extracted.layout || null,
    },
    warnings,
  };
  await writeFile(path.join(draftPath, 'extraction.json'), JSON.stringify(result, null, 2), 'utf8');
  await Promise.all([
    rm(path.join(draftPath, 'inference.json'), { force: true }),
    rm(path.join(draftPath, 'review.json'), { force: true }),
  ]);
  const updatedMetadata = {
    ...metadata,
    status: 'extracted',
    nextStep: 'review',
    extractedAt: result.extractedAt,
  };
  await writeFile(metadataPath, JSON.stringify(updatedMetadata, null, 2), 'utf8');
  return publicExtraction(result);
}

export async function readExtraction(root, draftId) {
  const id = validateDraftId(draftId);
  try {
    const result = JSON.parse(await readFile(path.join(root, 'data', 'onboarding-drafts', id, 'extraction.json'), 'utf8'));
    return publicExtraction(result);
  } catch {
    return null;
  }
}

export async function readFullExtraction(root, draftId) {
  const id = validateDraftId(draftId);
  try {
    return JSON.parse(await readFile(path.join(root, 'data', 'onboarding-drafts', id, 'extraction.json'), 'utf8'));
  } catch {
    return null;
  }
}

export async function extractFile(file, extension) {
  return extractByFormat(file, String(extension).toLowerCase());
}

async function extractByFormat(file, extension) {
  if (extension === '.pdf') return extractPdf(file);
  throw extractionError('unsupported_format', 'Only PDF resume extraction is supported', 415);
}

async function extractPdf(file) {
  const bytes = new Uint8Array(await readFile(file));
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: bytes,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  let document;
  try {
    document = await task.promise;
    if (document.numPages > MAX_PDF_PAGES) {
      throw extractionError('pdf_page_limit', `PDF resumes are limited to ${MAX_PDF_PAGES} pages`, 422);
    }
    const pageTexts = [];
    const layouts = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const layout = reconstructPdfPage(content.items, page.getViewport({ scale: 1 }));
      pageTexts.push(layout.text);
      layouts.push({ page: pageNumber, columns: layout.columns, lines: layout.lineCount });
      page.cleanup();
    }
    const text = pageTexts.join('\n\n');
    const warnings = [];
    if (text.trim().length < document.numPages * 80) {
      warnings.push('PDF contains very little selectable text and may need OCR.');
    }
    return { text, pages: document.numPages, warnings, layout: layouts };
  } catch (error) {
    throw extractionError('pdf_extraction_failed', `PDF text extraction failed: ${error.message}`, 422);
  } finally {
    if (typeof document?.cleanup === 'function') await document.cleanup();
    if (typeof document?.destroy === 'function') await document.destroy();
    if (typeof task.destroy === 'function') await task.destroy();
  }
}

function publicExtraction(result) {
  return {
    draftId: result.draftId,
    format: result.format,
    extractedAt: result.extractedAt,
    pages: result.pages,
    diagnostics: result.diagnostics,
    warnings: result.warnings,
    preview: result.text.slice(0, 1200),
    sections: result.sections.map(({ key, title, searchRelevant, lineCount, preview }) => ({
      key,
      title,
      searchRelevant,
      lineCount,
      preview,
    })),
  };
}

function validateDraftId(value) {
  const id = String(value || '');
  if (!DRAFT_ID_RE.test(id)) throw extractionError('invalid_draft', 'Draft id is invalid', 400);
  return id;
}

function extractionError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
