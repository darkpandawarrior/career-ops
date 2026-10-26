import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { getProfilePath } from "@/lib/core/profile-path.mjs";

/**
 * Full read model for the /profile dashboard page — everything in
 * config/profile.yml (the whole schema per config/profile.example.yml), plus
 * the prose sections of modes/_profile.md split by `##` heading. This is
 * intentionally a superset of lib/profile-meta.ts (which stays as-is: it's a
 * small, already-tested shape consumed by the Intel banner). Read-only.
 */

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export type Archetype = { name: string; level: string; fit: string };
export type ProofPoint = { name: string; url: string; hero_metric: string };
export type LanguageLearning = {
  language: string;
  current_level: string;
  target_level: string;
  target_date: string;
  sentence: string;
  countries: string[];
};

export type FullProfile = {
  candidate: {
    full_name: string;
    email: string;
    phone: string;
    location: string;
    linkedin: string;
    portfolio_url: string;
    github: string;
    twitter: string;
    photo: string;
  };
  target_roles: {
    primary: string[];
    archetypes: Archetype[];
  };
  narrative: {
    headline: string;
    exit_story: string;
    superpowers: string[];
    proof_points: ProofPoint[];
  };
  compensation: {
    target_range: string;
    currency: string;
    minimum: string;
    location_flexibility: string;
  };
  location: {
    country: string;
    city: string;
    timezone: string;
    visa_status: string;
    onsite_availability: string;
  };
  language: { output: string; modes_dir: string };
  cv: { output_format: string; canva_resume_design_id: string };
  cover_letter: {
    notice_period_days: number | null;
    primary_domain: string;
    language_learning: LanguageLearning[];
  };
  spend_tier: string;
};

export function emptyFullProfile(): FullProfile {
  return {
    candidate: { full_name: "", email: "", phone: "", location: "", linkedin: "", portfolio_url: "", github: "", twitter: "", photo: "" },
    target_roles: { primary: [], archetypes: [] },
    narrative: { headline: "", exit_story: "", superpowers: [], proof_points: [] },
    compensation: { target_range: "", currency: "", minimum: "", location_flexibility: "" },
    location: { country: "", city: "", timezone: "", visa_status: "", onsite_availability: "" },
    language: { output: "en", modes_dir: "" },
    cv: { output_format: "html", canva_resume_design_id: "" },
    cover_letter: { notice_period_days: null, primary_domain: "", language_learning: [] },
    spend_tier: "standard",
  };
}

/** Read + parse config/profile.yml into the full schema (all fields, not just the Intel-banner subset). */
export function readFullProfile(root: string = careerOpsRoot()): FullProfile | null {
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

  const candidate = obj(doc.candidate);
  const targetRoles = obj(doc.target_roles);
  const narrative = obj(doc.narrative);
  const compensation = obj(doc.compensation);
  const location = obj(doc.location);
  const language = obj(doc.language);
  const cv = obj(doc.cv);
  const coverLetter = obj(doc.cover_letter);

  const archetypes = Array.isArray(targetRoles.archetypes)
    ? (targetRoles.archetypes as unknown[]).map((a) => {
        const e = obj(a);
        return { name: str(e.name), level: str(e.level), fit: str(e.fit) };
      }).filter((a) => a.name)
    : [];

  const proofPoints = Array.isArray(narrative.proof_points)
    ? (narrative.proof_points as unknown[]).map((p) => {
        const e = obj(p);
        return { name: str(e.name), url: str(e.url), hero_metric: str(e.hero_metric) };
      }).filter((p) => p.name)
    : [];

  const languageLearning = Array.isArray(coverLetter.language_learning)
    ? (coverLetter.language_learning as unknown[]).map((l) => {
        const e = obj(l);
        return {
          language: str(e.language),
          current_level: str(e.current_level),
          target_level: str(e.target_level),
          target_date: str(e.target_date),
          sentence: str(e.sentence),
          countries: strList(e.countries),
        };
      }).filter((l) => l.language)
    : [];

  return {
    candidate: {
      full_name: str(candidate.full_name),
      email: str(candidate.email),
      phone: str(candidate.phone),
      location: str(candidate.location),
      linkedin: str(candidate.linkedin),
      portfolio_url: str(candidate.portfolio_url),
      github: str(candidate.github),
      twitter: str(candidate.twitter),
      photo: str(candidate.photo),
    },
    target_roles: {
      primary: strList(targetRoles.primary),
      archetypes,
    },
    narrative: {
      headline: str(narrative.headline),
      exit_story: str(narrative.exit_story),
      superpowers: strList(narrative.superpowers),
      proof_points: proofPoints,
    },
    compensation: {
      target_range: str(compensation.target_range),
      currency: str(compensation.currency),
      minimum: str(compensation.minimum),
      location_flexibility: str(compensation.location_flexibility),
    },
    location: {
      country: str(location.country),
      city: str(location.city),
      timezone: str(location.timezone),
      visa_status: str(location.visa_status),
      onsite_availability: str(location.onsite_availability),
    },
    language: { output: str(language.output) || "en", modes_dir: str(language.modes_dir) },
    cv: { output_format: str(cv.output_format) || "html", canva_resume_design_id: str(cv.canva_resume_design_id) },
    cover_letter: {
      notice_period_days: num(coverLetter.notice_period_days),
      primary_domain: str(coverLetter.primary_domain),
      language_learning: languageLearning,
    },
    spend_tier: str(doc.spend_tier) || "standard",
  };
}

export type ProfileMdSection = { title: string; body: string };

/**
 * Split modes/_profile.md into its `##`-level sections (Target Roles, Adaptive
 * Framing, Exit Narrative, Comp Targets, Negotiation Scripts, Known Gaps,
 * Location Policy, etc.) so the dashboard can render the prose content
 * verbatim without re-deriving it. Best-effort: unknown/custom sections still
 * show up, nothing is dropped.
 */
export function readProfileMdSections(root: string = careerOpsRoot()): ProfileMdSection[] {
  let md: string;
  try {
    md = fs.readFileSync(path.join(root, "modes", "_profile.md"), "utf8");
  } catch {
    return [];
  }
  // Drop the web-assistant managed notes block and the leading HTML comment
  // banner — neither is meant for this prose view.
  md = md.replace(/<!--[\s\S]*?-->/g, "");
  const sections: ProfileMdSection[] = [];
  const lines = md.split("\n");
  let title: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (title !== null) {
      const body = buf.join("\n").trim();
      if (body) sections.push({ title, body });
    }
  };
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      flush();
      title = m[1];
      buf = [];
    } else if (title !== null) {
      buf.push(line);
    }
  }
  flush();
  return sections;
}
