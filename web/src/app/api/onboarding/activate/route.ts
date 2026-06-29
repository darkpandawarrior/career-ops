import { NextResponse } from "next/server";
import { runOnboarding } from "@/lib/onboarding/run";
import { requestRoot } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Activate the reviewed profile — the ONE write path of onboarding. Generates
 * the canonical user files (cv.md, config/profile.yml, config/job-search.yml,
 * modes/_profile.md, portals.yml, data/*) via the real profile-writer and lands
 * them in the ACTIVE profile's root (requestRoot()), archiving any pre-existing
 * file to data/profile-archives/ first (recoverable). A sanctioned profile write.
 */
export async function POST(req: Request) {
  let body: { text?: string; review?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  if (!body.review) {
    return NextResponse.json({ ok: false, error: "review required" }, { status: 400 });
  }
  const root = await requestRoot();
  const result = await runOnboarding("activate", [root], { text: body.text ?? "", review: body.review });
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
