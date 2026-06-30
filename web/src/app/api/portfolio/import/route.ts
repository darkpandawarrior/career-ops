import { NextResponse } from "next/server";
import { requestRoot } from "@/lib/profile-registry";
import { readPortfolio, writePortfolio, finalizeVersion } from "@/lib/portfolio/context";
import { coercePortfolio } from "@/lib/portfolio/schema";
import { profileModuleToPortfolio } from "@/lib/portfolio/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Import an existing portfolio into the active profile — no AI, no tokens. Accepts
 * either a `module` (the named exports of a portfolio-site `src/data/profile.ts`)
 * or a ready `data` (PortfolioData). The payload is mapped → coerced → persisted as
 * a new version. Pass `finalize: true` to immediately bookmark it as production
 * (e.g. when importing a site that is already the live/production version).
 */
export async function POST(req: Request) {
  let body: { module?: unknown; data?: unknown; finalize?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const raw = body.data ?? (body.module !== undefined ? profileModuleToPortfolio(body.module) : null);
  const data = coercePortfolio(raw);
  if (!data) return NextResponse.json({ error: "nothing importable (need at least a name)" }, { status: 400 });

  const root = await requestRoot();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const { html } = writePortfolio(data, root, stamp);
  if (body.finalize) finalizeVersion(stamp, root);

  const { versions, final } = readPortfolio(root);
  return NextResponse.json({ ok: true, stamp, html, versions, final });
}
