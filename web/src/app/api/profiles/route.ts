import { NextResponse } from "next/server";
import { listProfiles, requestSlug } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * List the registered candidate profiles for the switcher. Each entry carries a
 * ready-to-use `?profile=slug` URL and an `active` flag for the current request.
 * Returns an empty list in single-profile mode (no profiles.yml) — the UI can
 * then hide the switcher entirely. Never exposes absolute filesystem paths.
 */
export async function GET() {
  const active = await requestSlug();
  const profiles = listProfiles().map((p) => ({
    name: p.name,
    display_name: p.display_name,
    color: p.color ?? null,
    exists: p.exists,
    active: p.name === active,
    url: `/?profile=${p.name}`,
  }));
  return NextResponse.json({ profiles, active });
}
