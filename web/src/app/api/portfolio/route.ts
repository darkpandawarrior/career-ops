import { NextResponse } from "next/server";
import { requestRoot } from "@/lib/profile-registry";
import { readPortfolio, deletePortfolio } from "@/lib/portfolio/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current per-profile portfolio draft. */
export async function GET() {
  const root = await requestRoot();
  const { exists, data, html, versions, final } = readPortfolio(root);
  return NextResponse.json({ exists, data, html, versions, final });
}

/** Discard the active profile's draft. */
export async function DELETE() {
  const root = await requestRoot();
  deletePortfolio(root);
  return NextResponse.json({ ok: true });
}
