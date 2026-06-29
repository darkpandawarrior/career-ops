import { requestRoot } from "@/lib/profile-registry";
import { readPortfolio, DEPLOY_README } from "@/lib/portfolio/context";
import { buildZip } from "@/lib/portfolio/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download the active profile's portfolio as a deployable ZIP (index.html + README). */
export async function GET() {
  const root = await requestRoot();
  const { exists, html } = readPortfolio(root);
  if (!exists || !html) {
    return Response.json({ error: "no portfolio to export — generate one first" }, { status: 400 });
  }
  const zip = buildZip([
    { name: "index.html", content: html },
    { name: "README-deploy.md", content: DEPLOY_README },
  ]);
  // Return a fresh ArrayBuffer copy so the body is a plain BodyInit (not a Node Buffer view).
  const bytes = zip.slice();
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="portfolio.zip"',
      "Cache-Control": "no-store",
    },
  });
}
