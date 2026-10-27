import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { getProfilePath } from "@/lib/core/profile-path.mjs";

/** Lightweight read of config/profile.yml for the Intel banner (read-only). */
export type ProfileMeta = {
  fullName: string;
  headline: string;
  targetRange: string;
  currency: string;
  primaryRoles: string[];
  archetypes: { name: string; level: string; fit: string }[];
  superpowers: string[];
};

export function readProfileMeta(root: string = careerOpsRoot()): ProfileMeta | null {
  let raw: string;
  try {
    raw = fs.readFileSync(getProfilePath(root, { explicitRoot: true }), "utf8");
  } catch {
    return null;
  }
  let doc: Record<string, unknown>;
  try {
    doc = (raw.trim() ? (yaml.load(raw) as Record<string, unknown>) : {}) ?? {};
  } catch {
    return null;
  }
  const candidate = (doc.candidate as Record<string, unknown>) ?? {};
  const targetRoles = (doc.target_roles as Record<string, unknown>) ?? {};
  const narrative = (doc.narrative as Record<string, unknown>) ?? {};
  const comp = (doc.compensation as Record<string, unknown>) ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") as string[] : []);
  return {
    fullName: str(candidate.full_name),
    headline: str(narrative.headline),
    targetRange: str(comp.target_range),
    currency: str(comp.currency),
    primaryRoles: list(targetRoles.primary),
    archetypes: Array.isArray(targetRoles.archetypes)
      ? (targetRoles.archetypes as Record<string, unknown>[]).map((a) => ({
          name: str(a?.name),
          level: str(a?.level),
          fit: str(a?.fit),
        })).filter((a) => a.name)
      : [],
    superpowers: list(narrative.superpowers),
  };
}
