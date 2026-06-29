import { NextResponse } from "next/server";
import { runOnboarding } from "@/lib/onboarding/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Infer a profile draft from pasted resume text. Runs the REAL resume-inference
 * engine (structureResume → inferProfile) via the onboarding bridge — read-only,
 * no writes. Returns diagnostics + a flattened `prefill` the review form binds to.
 */
export async function POST(req: Request) {
  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  if (!body.text?.trim()) {
    return NextResponse.json({ ok: false, error: "Paste your resume text first." }, { status: 400 });
  }
  const result = await runOnboarding("infer", [], { text: body.text });
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
