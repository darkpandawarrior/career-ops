import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { runOnboarding } from "@/lib/onboarding/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Extract a profile draft from an uploaded resume FILE (PDF). Next parses the
 * multipart body natively; we stash the bytes in a temp file and hand the path
 * to the onboarding bridge, which runs the REAL pdfjs extractor → structureResume
 * → inferProfile and returns the same `prefill` shape as the paste flow.
 * Read-only (the temp file is deleted immediately after).
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "expected multipart form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "no file uploaded" }, { status: 400 });
  }
  const ext = path.extname(file.name).toLowerCase() || ".pdf";
  if (ext !== ".pdf") {
    return NextResponse.json({ ok: false, error: "Only PDF resumes are supported — paste the text for other formats." }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "File is too large (max 10MB)." }, { status: 413 });
  }

  const tmp = path.join(os.tmpdir(), `co-resume-${randomUUID()}${ext}`);
  try {
    await fs.writeFile(tmp, Buffer.from(await file.arrayBuffer()));
    const result = await runOnboarding("extract", [tmp, ext], {});
    return NextResponse.json({ ...result, text: result.ok ? result.text ?? "" : "" }, { status: result.ok ? 200 : 422 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String((err as Error)?.message ?? err) }, { status: 500 });
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}
