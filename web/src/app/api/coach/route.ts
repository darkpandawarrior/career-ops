import { NextResponse } from "next/server";
import { readCoachState } from "@/lib/coach";
import { requestRoot } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Interview-coach state (storybank, outcomes, question bank, drills, patterns). */
export async function GET() {
  const root = await requestRoot();
  const coach = readCoachState(root);
  return NextResponse.json({ available: !!coach, coach });
}
