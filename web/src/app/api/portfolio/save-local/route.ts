import { NextResponse } from "next/server";
import fs from "node:fs";
import { requestRoot } from "@/lib/profile-registry";
import { readPortfolio, saveLocalCopy } from "@/lib/portfolio/context";
import { templateDir } from "@/lib/portfolio/scaffold";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Write a local, editable copy of the full Vite project for the active profile. */
export async function POST() {
  const root = await requestRoot();
  const { exists, data } = readPortfolio(root);
  if (!exists || !data) {
    return NextResponse.json({ error: "generate a portfolio first" }, { status: 400 });
  }
  if (!fs.existsSync(templateDir())) {
    return NextResponse.json({ error: "the project template isn't available in this checkout" }, { status: 400 });
  }
  try {
    const dir = saveLocalCopy(data, root);
    return NextResponse.json({ ok: true, path: dir });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "save failed" }, { status: 500 });
  }
}
