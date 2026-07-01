import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { requestRoot } from "@/lib/profile-registry";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";

async function cvPath() {
  return path.join(await requestRoot(), "cv.md");
}

const MAX_CV_BYTES = 200_000;

export async function GET() {
  try {
    return NextResponse.json({ content: fs.readFileSync(await cvPath(), "utf8"), exists: true });
  } catch {
    return NextResponse.json({ content: "", exists: false });
  }
}

export async function POST(req: Request) {
  let body: { content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }
  if (Buffer.byteLength(body.content, "utf8") > MAX_CV_BYTES) {
    return NextResponse.json({ error: "CV is too large (over 200KB)" }, { status: 413 });
  }
  // DATA_CONTRACT: cv.md is user-layer and gitignored (no git recovery). Never
  // blind-overwrite — snapshot the prior CV to a .bak first, write atomically.
  try {
    const bak = atomicWriteWithBackup(await cvPath(), body.content);
    return NextResponse.json({ ok: true, backedUp: !!bak });
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }
}
