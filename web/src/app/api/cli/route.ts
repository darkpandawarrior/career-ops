import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { requestRoot } from "@/lib/profile-registry";
import { detectClis, KNOWN } from "@/lib/clis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PROFILE-AWARE CLI selection. Detection (`/api/clis`) is system-wide, but WHICH
// CLI drives the assistant/AI-search is a per-candidate choice — so it lives in
// `<profile_root>/config/cli.yml`, not a single global localStorage key shared by
// every profile on this origin. GET returns the installed CLIs + the active
// profile's saved (or auto-defaulted) choice; POST persists a choice for it.
function cliConfigPath(root: string): string {
  return path.join(root, "config", "cli.yml");
}

export async function GET() {
  const root = await requestRoot();
  const clis = detectClis();
  const installedIds = new Set(clis.filter((c) => c.installed).map((c) => c.id));

  let selected: string | null = null;
  try {
    const doc = yaml.load(fs.readFileSync(cliConfigPath(root), "utf8")) as { cliId?: string } | null;
    if (doc?.cliId) selected = doc.cliId;
  } catch {
    /* no saved choice yet */
  }

  // A saved-but-now-uninstalled choice (or none) falls back to the first installed
  // CLI — so the assistant is usable the moment ANY supported CLI is on PATH,
  // without the user first visiting Config. This is what fixed "no CLI configured".
  if (!selected || !installedIds.has(selected)) {
    selected = clis.find((c) => c.installed)?.id ?? null;
  }

  return NextResponse.json({ clis, selected });
}

export async function POST(req: Request) {
  let body: { cliId?: string };
  try {
    body = (await req.json()) as { cliId?: string };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const cliId = body.cliId;
  // Validate against the KNOWN registry (not install state) so a choice can be
  // saved even if the binary is momentarily off PATH; GET re-validates on read.
  if (!cliId || !KNOWN.some((c) => c.id === cliId)) {
    return NextResponse.json({ error: "unknown cliId" }, { status: 400 });
  }

  const root = await requestRoot();
  try {
    fs.mkdirSync(path.join(root, "config"), { recursive: true });
    fs.writeFileSync(cliConfigPath(root), yaml.dump({ cliId }), "utf8");
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
