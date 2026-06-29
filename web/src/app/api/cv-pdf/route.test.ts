import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

/**
 * /api/cv-pdf serves the tailored CV PDF the `pdf` mode wrote to
 * <root>/output/cv-…-{company}-…pdf for a given offer (matched by company slug at
 * a token boundary, newest-first by mtime), inline. It is a pure disk reader, so
 * we drive it with REAL fixture PDFs under a tmp data root:
 *   - mock `@/lib/profile-registry` so `requestRoot()` resolves our tmp root,
 *   - write fixture *.pdf files into <root>/output with controlled mtimes,
 *   - assert the route requires a `company`, returns the matching newest PDF as
 *     application/pdf, and 404s when nothing matches.
 *
 * No child process / generator is involved — the PDFs are produced upstream by
 * the pdf mode; this route only locates and streams the freshest match.
 */

const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "co-cvpdf-data-"));
const OUTPUT_DIR = path.join(DATA_ROOT, "output");

vi.mock("@/lib/profile-registry", () => ({
  requestRoot: vi.fn(async () => DATA_ROOT),
}));

import { GET } from "./route";

// Minimal valid-enough PDF bytes; content only needs to round-trip as bytes.
function writePdf(name: string, body: string, mtimeMs?: number) {
  const file = path.join(OUTPUT_DIR, name);
  fs.writeFileSync(file, `%PDF-1.4\n${body}\n%%EOF\n`);
  if (mtimeMs !== undefined) {
    const t = mtimeMs / 1000;
    fs.utimesSync(file, t, t);
  }
  return file;
}

function get(company: string | null): Promise<Response> {
  const url = company === null ? "http://localhost/api/cv-pdf" : `http://localhost/api/cv-pdf?company=${encodeURIComponent(company)}`;
  return GET(new NextRequest(url));
}

beforeEach(() => {
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  fs.rmSync(DATA_ROOT, { recursive: true, force: true });
});

describe("GET /api/cv-pdf — input validation", () => {
  it("requires a company query param (400 when absent)", async () => {
    const res = await get(null);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("company required");
  });

  it("requires a non-blank company (400 when whitespace-only)", async () => {
    const res = await get("   ");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("company required");
  });

  it("404s when the output directory does not exist", async () => {
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    const res = await get("Acme");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("no output directory");
  });

  it("404s when no PDF matches the company slug", async () => {
    writePdf("cv-siddharth-google-2026.pdf", "google");
    const res = await get("Acme");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("no tailored CV found for this offer");
  });
});

describe("GET /api/cv-pdf — serving the matching PDF", () => {
  it("streams the matching PDF inline as application/pdf with a filename", async () => {
    writePdf("cv-siddharth-acme-2026-06.pdf", "acme body");
    const res = await get("Acme");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="cv-siddharth-acme-2026-06.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes)).toContain("acme body");
  });

  it("slugifies the company (spaces/punctuation → hyphens, lowercased) before matching", async () => {
    writePdf("cv-siddharth-acme-corp-2026.pdf", "acme corp");
    const res = await get("Acme Corp!");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("cv-siddharth-acme-corp-2026.pdf");
  });

  it("matches the slug only at a token boundary (Meta must NOT serve Metabase's CV)", async () => {
    writePdf("cv-siddharth-metabase-2026.pdf", "metabase");
    const res = await get("Meta");
    // 'metabase' contains 'meta' but not at a token boundary → no match.
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("no tailored CV found for this offer");
  });

  it("serves the newest PDF (highest mtime) when several match the company", async () => {
    writePdf("cv-siddharth-acme-v1.pdf", "older", 1_000_000);
    writePdf("cv-siddharth-acme-v2.pdf", "newer", 2_000_000);
    const res = await get("Acme");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("cv-siddharth-acme-v2.pdf");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes)).toContain("newer");
  });

  it("ignores non-PDF files that happen to contain the slug", async () => {
    writePdf("cv-siddharth-acme.pdf", "the pdf");
    fs.writeFileSync(path.join(OUTPUT_DIR, "cv-siddharth-acme.txt"), "not a pdf");
    fs.writeFileSync(path.join(OUTPUT_DIR, "notes-acme.md"), "not a pdf");
    const res = await get("Acme");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain(".pdf");
  });

  it("matches the slug case-insensitively against the filename", async () => {
    writePdf("CV-Siddharth-ACME-2026.pdf", "uppercase name");
    const res = await get("acme");
    expect(res.status).toBe(200);
  });
});
