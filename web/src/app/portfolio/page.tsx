import fs from "node:fs";
import path from "node:path";
import { requestRoot } from "@/lib/profile-registry";
import { readPortfolio } from "@/lib/portfolio/context";
import { PortfolioView } from "@/components/portfolio/portfolio-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Generate an AI portfolio SITE from the active profile's CV — preview it, refine
// it by chat, and export a deployable ZIP. Everything is per-profile + local-first.
export default async function PortfolioPage() {
  const root = await requestRoot();
  let hasCv = false;
  try {
    hasCv = fs.existsSync(path.join(root, "cv.md"));
  } catch {
    /* ignore */
  }
  const { exists, html } = readPortfolio(root);
  return <PortfolioView hasCv={hasCv} initialHtml={exists ? html : ""} initialExists={exists} />;
}
