// Import path: turn an EXISTING portfolio-site data module (the `src/data/profile.ts`
// shape that scaffold.ts emits + that cv-* reference sites use) back into our portable
// PortfolioData. This is the inverse of scaffold.ts's serializer — so a candidate who
// already has a finalized site can pull it into the dashboard verbatim, with no AI and
// no approximation. coercePortfolio() downstream clamps/validates the result.

import type { PortfolioData } from "./schema";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object";
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Map a portfolio-site data module — the named exports `profile`, `education`,
 * `metrics`, `competencies`, `experience`, `caseStudies`, `skills`, `projects`
 * (others ignored) — into a PortfolioData. Tolerant of missing pieces; pass the
 * result through coercePortfolio() before persisting/rendering.
 *
 * Field notes (kept faithful to the reference `profile.ts`):
 *  - title  ← profile.resumeTitle (the fuller headline) || profile.title
 *  - website ← profile.portfolio || profile.website
 *  - projects[].description ← project.tagline || project.description (the punchy line)
 *  - projects[].link ← first of project.links[]; tags ← project.badges
 *  - caseStudies drop their `slug` (PortfolioData is slug-free)
 */
export function profileModuleToPortfolio(mod: unknown): PortfolioData {
  const m = isObj(mod) ? mod : {};
  const p = isObj(m.profile) ? m.profile : {};

  const metrics = arr(m.metrics)
    .filter(isObj)
    .map((x) => ({ value: str(x.value), label: str(x.label), detail: str(x.detail) || undefined }));

  const experience = arr(m.experience)
    .filter(isObj)
    .map((e) => ({
      company: str(e.company),
      role: str(e.role),
      period: str(e.period),
      points: arr(e.points)
        .map((pt) =>
          typeof pt === "string"
            ? { text: pt.trim() }
            : isObj(pt)
              ? { label: str(pt.label) || undefined, text: str(pt.text) }
              : { text: "" },
        )
        .filter((pt) => pt.text),
    }));

  const caseStudies = arr(m.caseStudies)
    .filter(isObj)
    .map((c) => ({
      title: str(c.title),
      metric: str(c.metric) || undefined,
      summary: str(c.summary),
      problem: str(c.problem) || undefined,
      approach: arr(c.approach).map(str).filter(Boolean),
      outcome: str(c.outcome) || undefined,
      tags: arr(c.tags).map(str).filter(Boolean),
    }));

  const projects = arr(m.projects)
    .filter(isObj)
    .map((pr) => {
      const links = arr(pr.links).filter(isObj);
      return {
        name: str(pr.name),
        description: str(pr.tagline) || str(pr.description),
        link: str(links[0]?.url) || undefined,
        tags: arr(pr.badges).map(str).filter(Boolean),
      };
    });

  const skills = arr(m.skills)
    .filter(isObj)
    .map((s) => ({ group: str(s.group), items: arr(s.items).map(str).filter(Boolean) }));

  const edu = isObj(m.education) ? m.education : null;
  const education =
    edu && (str(edu.school) || str(edu.degree))
      ? { school: str(edu.school), degree: str(edu.degree), period: str(edu.period) }
      : undefined;

  return {
    name: str(p.name),
    title: str(p.resumeTitle) || str(p.title),
    tagline: str(p.tagline),
    location: str(p.location) || undefined,
    email: str(p.email) || undefined,
    github: str(p.github) || undefined,
    linkedin: str(p.linkedin) || undefined,
    website: str(p.portfolio) || str(p.website) || undefined,
    intro: str(p.intro) || undefined,
    summary: str(p.summary) || undefined,
    availability: str(p.availability) || undefined,
    theme: str(m.theme) || str(p.theme) || undefined,
    competencies: arr(m.competencies).map(str).filter(Boolean),
    metrics,
    experience,
    caseStudies,
    projects,
    skills,
    education,
  };
}
