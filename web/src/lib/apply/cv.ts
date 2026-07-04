import fs from "node:fs";
import path from "node:path";

/**
 * Locate the tailored CV PDF the real `pdf` mode wrote to output/ for a given
 * company (newest match wins). STRICT company match — never returns a CV tailored
 * for a different company (we'd rather attach nothing than the wrong CV). Mirrors
 * the matching in /api/cv-pdf so the "View tailored CV" link and the apply
 * file-upload always resolve to the SAME file. Returns an absolute path or null.
 *
 * `root` must be the caller's own resolved profile root (`await requestRoot()`),
 * never `careerOpsRoot()` directly — this file is per-profile user data, and a
 * fixed engine-root lookup would leak one profile's tailored CV into another
 * profile's application (see cv-pdf/route.ts for the same pattern).
 */
export function resolveTailoredCv(root: string, company?: string): string | null {
  const c = (company ?? "").trim();
  if (!c) return null;
  const dir = path.join(root, "output");
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
  } catch {
    return null;
  }
  const slug = c.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const first = slug.split("-")[0];
  const matches = files.filter((f) => {
    const l = f.toLowerCase();
    if (l.includes(slug)) return true;
    const segs = l.replace(/\.pdf$/, "").split(/[^a-z0-9]+/);
    return first.length > 2 && segs.includes(first);
  });
  if (!matches.length) return null;
  matches.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
  return path.join(dir, matches[0]);
}

/**
 * Best-effort company name from an application form/page title. ATS titles look
 * like "Role - Region @ Company" (Ashby) or "Company — Role" / "Role at Company".
 * Used as a fallback when the apply flow was started by pasting a URL (no offer
 * context) rather than from a report's Apply button.
 */
export function companyFromTitle(title?: string): string {
  const t = (title ?? "").trim();
  if (!t) return "";
  const at = t.match(/@\s*([^|@]+?)\s*$/);
  if (at) return at[1].trim();
  const atWord = t.match(/\bat\s+([A-Z][\w&.\- ]+?)\s*$/);
  if (atWord) return atWord[1].trim();
  return "";
}
