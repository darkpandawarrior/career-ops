import { NextResponse } from "next/server";
import { readCoachState } from "@/lib/coach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Interview-coach state (storybank, outcomes, question bank, drills, patterns). */
export async function GET() {
  const coach = readCoachState();
  return NextResponse.json({ available: !!coach, coach });
}
