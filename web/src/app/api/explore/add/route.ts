import { NextRequest } from "next/server";
import { addOffersToPipeline } from "@/lib/core/pipeline";
import { requestRoot } from "@/lib/profile-registry";
import type { DiscoveredOffer } from "@/lib/explore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Free + reversible: append chosen discovered offers to data/pipeline.md AND
// record them in data/scan-history.tsv, via the core's CANONICAL exported writers
// (no parallel writer). No tokens spent.
export async function POST(req: NextRequest) {
  let offers: DiscoveredOffer[] = [];
  try {
    const body = (await req.json()) as { offers?: DiscoveredOffer[] };
    offers = Array.isArray(body.offers) ? body.offers : [];
  } catch {
    return Response.json({ added: 0, error: "bad request" }, { status: 400 });
  }
  if (offers.length === 0) return Response.json({ added: 0 });

  // Append to the ACTIVE profile's pipeline + scan-history, never the engine root's.
  const root = await requestRoot();
  const result = await addOffersToPipeline(offers, root);
  return Response.json(result);
}
