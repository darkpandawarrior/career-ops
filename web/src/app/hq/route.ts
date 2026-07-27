import fs from "node:fs";
import path from "node:path";
import { requestRoot } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves the user's personal HQ page from the User Layer (data/hq/hq.html,
// gitignored — see DATA_CONTRACT.md). The page itself carries the user's
// prep plan and pipeline strategy, so it never lives in this repo's tree.
export async function GET() {
  const file = path.join(await requestRoot(), "data", "hq", "hq.html");
  if (!fs.existsSync(file)) {
    return new Response(
      "No HQ page yet. Ask your agent to generate data/hq/hq.html (see DATA_CONTRACT.md — User Layer).",
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
  const html =
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    fs.readFileSync(file, "utf8");
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
