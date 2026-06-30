import fs from "node:fs";
import { requestRoot } from "@/lib/profile-registry";
import { readPortfolio, DEPLOY_README } from "@/lib/portfolio/context";
import { buildZip } from "@/lib/portfolio/zip";
import { buildProjectFiles, templateDir } from "@/lib/portfolio/scaffold";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Download the active profile's portfolio as a deployable ZIP.
 *  - ?format=html   (default) → single self-contained index.html + deploy README.
 *  - ?format=project          → the FULL Vite/React project (with the AI chat),
 *                               npm install + npm run build, deploy to Vercel.
 */
export async function GET(req: Request) {
  const root = await requestRoot();
  const { exists, html, data } = readPortfolio(root);
  if (!exists || !html) {
    return Response.json({ error: "no portfolio to export — generate one first" }, { status: 400 });
  }
  const format = new URL(req.url).searchParams.get("format") === "project" ? "project" : "html";

  let files: { name: string; content: string }[];
  let filename: string;
  if (format === "project" && data && fs.existsSync(templateDir())) {
    files = buildProjectFiles(data);
    filename = "portfolio-site.zip";
  } else {
    files = [
      { name: "index.html", content: html },
      { name: "README-deploy.md", content: DEPLOY_README },
    ];
    filename = "portfolio.zip";
  }

  const bytes = buildZip(files).slice(); // fresh ArrayBuffer copy → plain BodyInit
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
