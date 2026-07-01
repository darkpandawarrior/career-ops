import { NextResponse } from "next/server";
import { setAppCell } from "@/lib/tracker-edit";
import { requestRoot } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Update the Notes cell of an existing tracker row (by application number). */
export async function POST(req: Request) {
  let b: { n?: string; notes?: string };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!b.n || typeof b.notes !== "string") {
    return NextResponse.json({ error: "n and notes required" }, { status: 400 });
  }
  const r = setAppCell(b.n, "Notes", b.notes, await requestRoot());
  if (r === "ok") return NextResponse.json({ ok: true });
  const code = r === "invalid" ? 400 : r === "not-found" ? 404 : 500;
  return NextResponse.json({ error: r }, { status: code });
}
