import { NextResponse } from "next/server";
import { readScanHistory, readAgentInbox } from "@/lib/career-ops";
import { requestRoot } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Scan-history log + agent inbox for the active profile (read-only). */
export async function GET() {
  const root = await requestRoot();
  return NextResponse.json({ scans: readScanHistory(root), inbox: readAgentInbox(root) });
}
