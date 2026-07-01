import path from "node:path";
import { NextResponse } from "next/server";
import yaml from "js-yaml";
import { runOnboarding } from "@/lib/onboarding/run";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { careerOpsRoot } from "@/lib/career-ops";
import { isValidSlug, readRegistry, registryPath, requestRoot } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Activate the reviewed profile — the ONE write path of onboarding. Generates
 * the canonical user files (cv.md, config/profile.yml, config/job-search.yml,
 * modes/_profile.md, portals.yml, data/*) via the real profile-writer and lands
 * them in the ACTIVE profile's root (requestRoot()), archiving any pre-existing
 * file to data/profile-archives/ first (recoverable). A sanctioned profile write.
 */
export async function POST(req: Request) {
  let body: { text?: string; review?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  if (!body.review) {
    return NextResponse.json({ ok: false, error: "review required" }, { status: 400 });
  }
  const root = await requestRoot();
  const result = await runOnboarding("activate", [root], { text: body.text ?? "", review: body.review });
  if (!result.ok) return NextResponse.json(result, { status: 422 });

  const review = body.review as { candidate?: { full_name?: string; email?: string } } | undefined;
  const fullName = String(review?.candidate?.full_name ?? "").trim();
  const email = String(review?.candidate?.email ?? "").trim();
  const slugBase = fullName || email.split("@")[0] || path.basename(root);
  const slug = slugBase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "profile";

  try {
    const engineRoot = careerOpsRoot();
    const relativeRoot = path.relative(engineRoot, root) || ".";
    const registry = readRegistry();
    const existing = registry.find((p) => path.resolve(engineRoot, p.root) === path.resolve(root));
    if (!existing) {
      const uniqueSlug = registry.some((p) => p.name === slug) ? `${slug}-${Date.now().toString(36)}` : slug;
      const name = isValidSlug(uniqueSlug) ? uniqueSlug : `profile-${Date.now().toString(36)}`;
      registry.push({ name, display_name: fullName || name, root: relativeRoot, color: "#0284c7" });
      atomicWriteWithBackup(registryPath(), yaml.dump({ profiles: registry }));
      return NextResponse.json({ ...result, profile: { name, root: relativeRoot } }, { status: 200 });
    }
  } catch {
    // Registry creation is best-effort; onboarding files already succeeded.
  }

  return NextResponse.json(result, { status: 200 });
}
