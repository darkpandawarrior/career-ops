import fs from "node:fs";
import path from "node:path";
import { requestRoot } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Persistence for the HQ page's progress state (XP, module checkmarks,
// streaks). One JSON blob in the User Layer (data/hq/state.json, gitignored)
// so it survives browser resets and rides the personal-data backup registry.
async function stateFile(): Promise<string> {
  return path.join(await requestRoot(), "data", "hq", "state.json");
}

export async function GET() {
  const file = await stateFile();
  if (!fs.existsSync(file)) return Response.json({});
  try {
    return Response.json(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return Response.json({});
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof (body as { data?: unknown }).data !== "object") {
    return Response.json({ error: "expected {savedAt, data}" }, { status: 400 });
  }
  const file = await stateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body, null, 2));
  return Response.json({ ok: true });
}
