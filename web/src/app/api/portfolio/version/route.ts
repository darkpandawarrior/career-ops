import { NextResponse } from "next/server";
import { requestRoot } from "@/lib/profile-registry";
import { restoreVersion, finalizeVersion } from "@/lib/portfolio/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Version management for the active profile's portfolio:
//  - restore: make a past version the current draft (re-renders html)
//  - finalize: bookmark a version as the "production" one (never locks editing)
export async function POST(req: Request) {
  let body: { action?: string; stamp?: string };
  try {
    body = (await req.json()) as { action?: string; stamp?: string };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const root = await requestRoot();
  const stamp = (body.stamp ?? "").trim();

  if (body.action === "restore") {
    if (!stamp) return NextResponse.json({ error: "stamp required" }, { status: 400 });
    const restored = restoreVersion(stamp, root);
    if (!restored) return NextResponse.json({ error: "unknown version" }, { status: 404 });
    return NextResponse.json({ ok: true, html: restored.html, data: restored.data });
  }

  if (body.action === "finalize") {
    // An empty stamp clears the production marker.
    const ok = finalizeVersion(stamp, root);
    if (!ok) return NextResponse.json({ error: "unknown version" }, { status: 404 });
    return NextResponse.json({ ok: true, final: stamp || null });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
