// The data contract for a generated portfolio site. The user's AI CLI fills this
// shape from their cv.md + profile.yml; the renderer (render.ts) turns it into a
// single self-contained HTML page. Mirrors the proven cv-siddharth `profile.ts`.

export type Metric = { value: string; label: string; detail?: string };
export type ExperiencePoint = { label?: string; text: string };
export type Experience = { company: string; role: string; period: string; points: ExperiencePoint[] };
// A case study is a full narrative (problem → approach → outcome), not just a blurb
// — matching the depth of the real cv-siddharth reference site.
export type CaseStudy = {
  title: string;
  metric?: string;
  summary: string;
  problem?: string;
  approach?: string[];
  outcome?: string;
  tags?: string[];
};
export type SkillGroup = { group: string; items: string[] };
export type Education = { school: string; degree: string; period: string };
// A generic project/work item — role-neutral (an engineer's repo, a designer's
// case, a marketer's campaign, a researcher's paper all fit).
export type Project = { name: string; description: string; link?: string; tags?: string[] };

export type PortfolioData = {
  name: string;
  title: string;
  tagline: string;
  location?: string;
  email?: string;
  github?: string;
  linkedin?: string;
  website?: string;
  intro?: string;
  summary?: string;
  metrics?: Metric[];
  competencies?: string[];
  experience?: Experience[];
  caseStudies?: CaseStudy[];
  projects?: Project[];
  skills?: SkillGroup[];
  education?: Education;
  availability?: string;
  theme?: string;
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strList = (v: unknown): string[] => arr(v).map(str).filter(Boolean);

/**
 * Coerce an arbitrary parsed JSON object (the CLI's output) into a safe, fully
 * shaped PortfolioData — dropping junk, clamping list sizes, never throwing. The
 * name/title/tagline are the only required fields; everything else is optional.
 * Returns null if there isn't even a name to render.
 */
export function coercePortfolio(raw: unknown): PortfolioData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name);
  if (!name) return null;

  const metrics: Metric[] = arr(r.metrics)
    .map((m) => (m && typeof m === "object" ? (m as Record<string, unknown>) : {}))
    .map((m) => ({ value: str(m.value), label: str(m.label), detail: str(m.detail) || undefined }))
    .filter((m) => m.value && m.label)
    .slice(0, 6);

  const experience: Experience[] = arr(r.experience)
    .map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>) : {}))
    .map((e) => ({
      company: str(e.company),
      role: str(e.role),
      period: str(e.period),
      points: arr(e.points)
        .map((p) =>
          typeof p === "string"
            ? { text: p.trim() }
            : p && typeof p === "object"
              ? { label: str((p as Record<string, unknown>).label) || undefined, text: str((p as Record<string, unknown>).text) }
              : { text: "" },
        )
        .filter((p) => p.text)
        .slice(0, 8),
    }))
    .filter((e) => e.company || e.role)
    .slice(0, 8);

  const caseStudies: CaseStudy[] = arr(r.caseStudies)
    .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>) : {}))
    .map((c) => ({
      title: str(c.title),
      metric: str(c.metric) || undefined,
      // `summary` is the headline narrative; tolerate the older `blurb` key.
      summary: str(c.summary) || str(c.blurb),
      problem: str(c.problem) || undefined,
      approach: strList(c.approach).slice(0, 8),
      outcome: str(c.outcome) || undefined,
      tags: strList(c.tags).slice(0, 6),
    }))
    .filter((c) => c.title && c.summary)
    .slice(0, 8);

  const skills: SkillGroup[] = arr(r.skills)
    .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
    .map((s) => ({ group: str(s.group), items: strList(s.items).slice(0, 10) }))
    .filter((s) => s.group && s.items.length)
    .slice(0, 8);

  const projects: Project[] = arr(r.projects)
    .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>) : {}))
    .map((p) => ({ name: str(p.name), description: str(p.description), link: str(p.link) || undefined, tags: strList(p.tags).slice(0, 6) }))
    .filter((p) => p.name && p.description)
    .slice(0, 8);

  const edu = r.education && typeof r.education === "object" ? (r.education as Record<string, unknown>) : null;
  const education =
    edu && (str(edu.school) || str(edu.degree))
      ? { school: str(edu.school), degree: str(edu.degree), period: str(edu.period) }
      : undefined;

  return {
    name,
    title: str(r.title),
    tagline: str(r.tagline),
    location: str(r.location) || undefined,
    email: str(r.email) || undefined,
    github: str(r.github) || undefined,
    linkedin: str(r.linkedin) || undefined,
    website: str(r.website) || undefined,
    intro: str(r.intro) || undefined,
    summary: str(r.summary) || undefined,
    education,
    availability: str(r.availability) || undefined,
    theme: str(r.theme) || undefined,
    competencies: strList(r.competencies).slice(0, 12),
    metrics,
    experience,
    caseStudies,
    projects,
    skills,
  };
}

/** Pull the first balanced JSON object out of a CLI's (possibly chatty/fenced) stdout. */
export function extractPortfolioJson(text: string): unknown | null {
  if (!text) return null;
  // Prefer a ```json fenced block, else the first {...} balanced span.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: string[] = [];
  if (fence) candidates.push(fence[1]);
  const start = text.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) {
        candidates.push(text.slice(start, i + 1));
        break;
      }
    }
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try next */
    }
  }
  return null;
}
