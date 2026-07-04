import fs from "node:fs";
import path from "node:path";

// The WEB build's own version + channel (NOT the user's data checkout) — read
// from the repo's VERSION (parent of the web/ cwd). Keep this build-time safe by
// avoiding shelling out to git during Next's trace phase.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readVersion(): string {
  const candidates = [
    path.join(process.cwd(), "..", "VERSION"),
    path.join(process.cwd(), "VERSION"),
  ];
  for (const p of candidates) {
    try {
      const v = fs.readFileSync(p, "utf8").split(/\s+/)[0].trim();
      if (v) return v;
    } catch {
      /* next candidate */
    }
  }
  return "";
}

function shortSha(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_GIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    ""
  ).slice(0, 7);
}

export async function GET() {
  const version = readVersion();
  const m = version.match(/-(rc|beta|alpha|next)(?![a-z])/i);
  const channel = m ? m[1].toLowerCase() : "stable";
  return Response.json({ version, channel, sha: shortSha() });
}
