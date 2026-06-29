import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { isValidSlug, registryPath, readRegistry } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a new candidate profile — ports dashboard-web's /api/profiles/create.
 * Scaffolds profiles/<slug>/{data,config,reports} and registers it in
 * profiles.yml at the engine root (profile-independent). The new profile is
 * empty; the user fills it via onboarding (or migrate-profile.mjs).
 */
export async function POST(req: Request) {
  let b: { slug?: string; display_name?: string; color?: string };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const slug = (b.slug ?? "").trim();
  const display_name = (b.display_name ?? "").trim();
  if (!slug || !display_name) {
    return NextResponse.json({ error: "slug and display_name are required" }, { status: 400 });
  }
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: "slug must be lowercase alphanumeric / dash / underscore" }, { status: 400 });
  }
  const root = careerOpsRoot();
  const profileDir = path.join(root, "profiles", slug);
  if (fs.existsSync(profileDir)) {
    return NextResponse.json({ error: `Profile "${slug}" already exists` }, { status: 409 });
  }
  try {
    for (const sub of ["data", "config", "reports"]) {
      fs.mkdirSync(path.join(profileDir, sub), { recursive: true });
    }
    const reg = (readRegistry().length ? { profiles: readRegistry() } : { profiles: [] }) as {
      profiles: { name: string; display_name: string; root: string; color?: string }[];
    };
    if (!reg.profiles.find((p) => p.name === slug)) {
      reg.profiles.push({ name: slug, display_name, root: `profiles/${slug}`, color: b.color || "#0284c7" });
      fs.writeFileSync(registryPath(), yaml.dump(reg), "utf8");
    }
    return NextResponse.json({ ok: true, slug, url: `/?profile=${slug}` });
  } catch (err) {
    return NextResponse.json({ error: String((err as Error)?.message ?? err) }, { status: 500 });
  }
}
