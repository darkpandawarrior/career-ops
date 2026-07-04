import { doctorState, readApplications, readInbox } from "@/lib/career-ops";
import { requestRoot } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side data-shape fingerprint for the in-app bug reporter. File
// existence (cv.md, config/profile.yml, …) can't be read from the browser, so
// the client's collect() fetches this instead of reimplementing the check.
// Reuses doctorState() — the SAME source of truth as /api/doctor — plus
// inbox/application counts. No file contents, just counts/booleans.
export async function GET() {
  const root = await requestRoot();
  const { phase, missing, hasCv, hasData } = doctorState(root);
  return Response.json({
    phase,
    missing,
    hasCv,
    hasData,
    inboxCount: readInbox(root).length,
    applicationCount: readApplications(root).length,
  });
}
