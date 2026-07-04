import { requestRoot } from "@/lib/profile-registry";
import { readFullProfile, readProfileMdSections, emptyFullProfile } from "@/lib/full-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only: the merged profile view for the /profile dashboard page —
// config/profile.yml (full schema) + modes/_profile.md prose sections.
// Additive alongside the existing thin PATCH at /api/profile (name/email/
// location/roles/comp/remote only) — this endpoint never writes.
export async function GET() {
  const root = await requestRoot();
  const profile = readFullProfile(root);
  const sections = readProfileMdSections(root);
  return Response.json({
    exists: profile !== null,
    profile: profile ?? emptyFullProfile(),
    sections,
  });
}
