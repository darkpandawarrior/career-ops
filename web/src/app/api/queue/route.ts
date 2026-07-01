import { NextResponse } from "next/server";
import { queueAgentTask, removeAgentTask } from "@/lib/tracker-edit";
import { requestRoot } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Queue a free-form task into the agent inbox. */
export async function POST(req: Request) {
  let b: { text?: string };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!b.text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });
  const r = queueAgentTask(b.text, await requestRoot());
  return r === "ok" ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r }, { status: 500 });
}

/** Remove a queued task (body: { text }). */
export async function DELETE(req: Request) {
  let b: { text?: string };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!b.text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });
  const r = removeAgentTask(b.text, await requestRoot());
  if (r === "ok") return NextResponse.json({ ok: true });
  return NextResponse.json({ error: r }, { status: r === "not-found" ? 404 : 500 });
}
