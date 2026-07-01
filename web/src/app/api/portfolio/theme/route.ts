import { NextResponse } from "next/server";
import { requestRoot } from "@/lib/profile-registry";
import { readPortfolio, writePortfolio } from "@/lib/portfolio/context";
import { THEMES } from "@/lib/portfolio/themes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Set the active draft's theme and re-render it (a tweak — not a new version). */
export async function POST(req: Request) {
  let body: { theme?: string };
  try {
    body = (await req.json()) as { theme?: string };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const theme = (body.theme ?? "").trim();
  if (!THEMES[theme]) return NextResponse.json({ error: "unknown theme" }, { status: 400 });

  const root = await requestRoot();
  const { exists, data } = readPortfolio(root);
  if (!exists || !data) return NextResponse.json({ error: "generate a portfolio first" }, { status: 400 });

  const { html } = writePortfolio({ ...data, theme }, root); // no stamp → updates the draft, no new version
  return NextResponse.json({ ok: true, theme, html });
}
