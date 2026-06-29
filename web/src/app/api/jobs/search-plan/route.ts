import { NextResponse } from "next/server";
import { validateConfig, searchPlan } from "@/lib/jobs/scoring";
import { requestRoot } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The generated search plan (queries + portal filters) for the active profile,
 * built from `config/job-search.yml`. Returns 422 with validation errors when
 * the config is incomplete, so the UI can prompt the user to finish onboarding.
 */
export async function GET() {
  const root = await requestRoot();
  const v = validateConfig(root);
  if (!v.valid) {
    return NextResponse.json({ valid: false, errors: v.errors, warnings: v.warnings }, { status: 422 });
  }
  return NextResponse.json({ valid: true, warnings: v.warnings, plan: searchPlan(root) });
}
