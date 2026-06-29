import { NextResponse } from "next/server";
import { togglePipeline } from "@/lib/tracker-edit";
import { requestRoot } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mark a pipeline inbox URL done/undone (`- [ ]` ↔ `- [x]`). */
export async function POST(req: Request) {
  let b: { url?: string; done?: boolean };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!b.url) return NextResponse.json({ error: "url required" }, { status: 400 });
  const r = togglePipeline(b.url, b.done !== false, await requestRoot());
  if (r === "ok") return NextResponse.json({ ok: true });
  return NextResponse.json({ error: r }, { status: r === "not-found" ? 404 : 500 });
}
