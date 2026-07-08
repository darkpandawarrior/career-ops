import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { requestRoot } from "@/lib/profile-registry";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProfilePatch = {
  name?: string;
  email?: string;
  location?: string;
  roles?: string[];
  compMin?: number;
  compMax?: number;
  currency?: string;
  remote?: string;
};

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(dst: unknown, src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = isObj(dst) ? { ...dst } : {};
  for (const [k, v] of Object.entries(src)) out[k] = isObj(v) ? deepMerge(out[k], v) : v;
  return out;
}

function patchToProfile(p: ProfilePatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const candidate: Record<string, unknown> = {};
  if (p.name) candidate.full_name = p.name;
  if (p.email) candidate.email = p.email;
  if (p.location) candidate.location = p.location;
  if (Object.keys(candidate).length) out.candidate = candidate;
  if (p.roles?.length) out.target_roles = { primary: p.roles.slice(0, 6) };
  const comp: Record<string, unknown> = {};
  if (p.compMin && p.compMax) comp.target_range = `${p.compMin}-${p.compMax}`;
  if (p.currency) comp.currency = p.currency;
  if (p.remote) comp.location_flexibility = p.remote;
  if (Object.keys(comp).length) out.compensation = comp;
  return out;
}

export async function POST(req: Request) {
  let patch: ProfilePatch;
  try {
    patch = (await req.json()) as ProfilePatch;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const proposed = patchToProfile(patch);
  if (Object.keys(proposed).length === 0) return Response.json({ error: "nothing to write" }, { status: 400 });

  const root = await requestRoot();
  const profileFile = path.join(root, "config", "profile.yml");
  let base: Record<string, unknown> = {};
  let seeded = false;

  if (!fs.existsSync(profileFile)) {
    try {
      base = (yaml.load(fs.readFileSync(path.join(root, "config", "profile.example.yml"), "utf8")) as Record<string, unknown>) || {};
      seeded = Object.keys(base).length > 0;
    } catch {
      base = {};
    }
  } else {
    let parsed: unknown;
    try {
      const raw = fs.readFileSync(profileFile, "utf8");
      parsed = raw.trim() ? yaml.load(raw) : {};
    } catch {
      return Response.json({ error: "config/profile.yml exists but is not valid YAML — refusing to overwrite it." }, { status: 409 });
    }
    base = isObj(parsed) ? parsed : {};
  }

  const merged = deepMerge(base, proposed);
  try {
    atomicWriteWithBackup(profileFile, yaml.dump(merged, { lineWidth: 100, noRefs: true }));
    syncJobSearchConfig(root, merged);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, seeded });
}

function syncJobSearchConfig(root: string, profile: Record<string, unknown>) {
  const file = path.join(root, "config", "job-search.yml");
  let existing: Record<string, unknown> = {};
  try {
    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    existing = isObj(parsed) ? parsed : {};
  } catch {
    existing = {};
  }

  const targetRoles = isObj(profile.target_roles) ? profile.target_roles : {};
  const candidate = isObj(profile.candidate) ? profile.candidate : {};
  const compensation = isObj(profile.compensation) ? profile.compensation : {};
  const strong = uniqueStrings([
    ...(Array.isArray(targetRoles.primary) ? targetRoles.primary : []),
  ]);

  const next = deepMerge(existing, {
    titles: {
      strong: strong.length > 0 ? strong : (isObj(existing.titles) && Array.isArray(existing.titles.strong) ? existing.titles.strong : []),
      adjacent: isObj(existing.titles) && Array.isArray(existing.titles.adjacent) ? existing.titles.adjacent : [],
      exclude: isObj(existing.titles) && Array.isArray(existing.titles.exclude) ? existing.titles.exclude : [],
    },
    location: {
      home_country: typeof candidate.location === "string"
        ? candidate.location
        : (isObj(existing.location) && typeof existing.location.home_country === "string" ? existing.location.home_country : ""),
    },
    compensation: {
      home_country: {
        currency: typeof compensation.currency === "string"
          ? compensation.currency
          : (isObj(existing.compensation) && isObj(existing.compensation.home_country) && typeof existing.compensation.home_country.currency === "string"
            ? existing.compensation.home_country.currency
            : null),
        minimum_annual: typeof compensation.minimum_annual === "number"
          ? compensation.minimum_annual
          : (isObj(existing.compensation) && isObj(existing.compensation.home_country) ? existing.compensation.home_country.minimum_annual ?? null : null),
      },
      remote: isObj(existing.compensation) && isObj(existing.compensation.remote) ? existing.compensation.remote : {},
      international: isObj(existing.compensation) && isObj(existing.compensation.international) ? existing.compensation.international : {},
    },
  });
  atomicWriteWithBackup(file, yaml.dump(next, { lineWidth: 100, noRefs: true }));
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
