import { sessionUrlPath } from "@/lib/apply/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only poll target for passive submit-detection: returns the apply
// session's CURRENT page URL. Calls only page.url() (see sessionUrlPath) — never
// clicks, types, or navigates anything. The client diffs this against the path
// it saw right after handoff and, on a change, offers a human-confirm prompt
// ("looks like you may have submitted — log this as Applied?"). Nothing here
// writes the tracker or interacts with the real form in any way.
export async function POST(req: Request) {
  let body: { sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
  const r = sessionUrlPath(body.sessionId);
  if (!r) return Response.json({ error: "session not found" }, { status: 404 });
  return Response.json(r);
}
