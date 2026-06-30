import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { renderPortfolio } from "./render";
import { buildProjectFiles } from "./scaffold";
import type { PortfolioData } from "./schema";

// Per-profile portfolio drafts live under the web-managed (gitignored) dir, so a
// candidate's generated site never lands in the repo and never crosses profiles.
function portfolioDir(root: string): string {
  return path.join(root, ".career-ops-web", "portfolio");
}
const DATA = "data.json";
const HTML = "draft.html";
const FINAL = "final.txt";

export type Version = { stamp: string; isFinal: boolean };
export type PortfolioState = {
  exists: boolean;
  data: PortfolioData | null;
  html: string;
  versions: Version[];
  final: string | null;
};

function safeRead(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function listVersionStamps(dir: string): string[] {
  try {
    return fs
      .readdirSync(path.join(dir, "versions"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort()
      .reverse(); // newest first
  } catch {
    return [];
  }
}

/** Current per-profile portfolio draft (data + rendered html + version history + the marked "production" version). */
export function readPortfolio(root: string = careerOpsRoot()): PortfolioState {
  const dir = portfolioDir(root);
  const raw = safeRead(path.join(dir, DATA));
  let data: PortfolioData | null = null;
  if (raw) {
    try {
      data = JSON.parse(raw) as PortfolioData;
    } catch {
      data = null;
    }
  }
  const html = safeRead(path.join(dir, HTML)) ?? (data ? renderPortfolio(data) : "");
  const final = safeRead(path.join(dir, FINAL))?.trim() || null;
  const versions: Version[] = listVersionStamps(dir).map((stamp) => ({ stamp, isFinal: stamp === final }));
  return { exists: !!data, data, html, versions, final };
}

/** Persist a new portfolio: write data.json + render+write draft.html + snapshot a version (data). */
export function writePortfolio(
  data: PortfolioData,
  root: string = careerOpsRoot(),
  stamp?: string,
): { html: string } {
  const dir = portfolioDir(root);
  fs.mkdirSync(path.join(dir, "versions"), { recursive: true });
  const html = renderPortfolio(data);
  fs.writeFileSync(path.join(dir, DATA), JSON.stringify(data, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, HTML), html, "utf8");
  // Version snapshot stores the DATA (html is re-derived on restore — the renderer
  // is deterministic). Timestamp supplied by the caller — the lib stays clock-free.
  if (stamp) fs.writeFileSync(path.join(dir, "versions", `${stamp}.json`), JSON.stringify(data, null, 2), "utf8");
  return { html };
}

/** Read a version's data + rendered html WITHOUT mutating the current draft (for
 *  display, e.g. showing the marked production version by default). Null if unknown. */
export function readVersion(stamp: string, root: string = careerOpsRoot()): { html: string; data: PortfolioData } | null {
  const raw = safeRead(path.join(portfolioDir(root), "versions", `${stamp}.json`));
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as PortfolioData;
    return { html: renderPortfolio(data), data };
  } catch {
    return null;
  }
}

/** Make a past version the current draft (re-renders html). Does NOT snapshot a new
 *  version — restoring is navigation, not a new edit. Returns null if unknown. */
export function restoreVersion(stamp: string, root: string = careerOpsRoot()): { html: string; data: PortfolioData } | null {
  const dir = portfolioDir(root);
  const raw = safeRead(path.join(dir, "versions", `${stamp}.json`));
  if (!raw) return null;
  let data: PortfolioData;
  try {
    data = JSON.parse(raw) as PortfolioData;
  } catch {
    return null;
  }
  const html = renderPortfolio(data);
  fs.writeFileSync(path.join(dir, DATA), JSON.stringify(data, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, HTML), html, "utf8");
  return { html, data };
}

/** Bookmark a version as the "production/final" one. This never locks editing —
 *  you keep iterating; the marker just records which version is live. Pass "" to clear. */
export function finalizeVersion(stamp: string, root: string = careerOpsRoot()): boolean {
  const dir = portfolioDir(root);
  if (!stamp) {
    try {
      fs.rmSync(path.join(dir, FINAL), { force: true });
    } catch {
      /* none */
    }
    return true;
  }
  if (!fs.existsSync(path.join(dir, "versions", `${stamp}.json`))) return false;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, FINAL), stamp, "utf8");
  return true;
}

/** Write a local, editable copy of the FULL Vite project (template + this
 *  candidate's data) under the profile's portfolio dir. Returns the path. */
export function saveLocalCopy(data: PortfolioData, root: string = careerOpsRoot()): string {
  const dir = path.join(portfolioDir(root), "site");
  fs.rmSync(dir, { recursive: true, force: true }); // replace any prior copy
  for (const f of buildProjectFiles(data)) {
    const p = path.join(dir, f.name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.content, "utf8");
  }
  return dir;
}

/** Discard the current draft (and versions). */
export function deletePortfolio(root: string = careerOpsRoot()): void {
  try {
    fs.rmSync(portfolioDir(root), { recursive: true, force: true });
  } catch {
    /* already gone */
  }
}

function cap(s: string | null, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "\n…(truncated)" : s;
}

// Pull just the storybank table out of a coaching_state.md (the case-study gold:
// titled wins + their "earned secrets").
function storybankOf(md: string | null): string {
  if (!md) return "";
  const m = md.match(/##\s*Storybank[\s\S]*?(?=\n## |$)/i);
  return m ? cap(m[0], 4000) : "";
}

/**
 * Assemble the DEEP generation context — not just the CV, but every indexed
 * source that gives the portfolio cv-siddharth-level depth: the structured
 * profile, the personalization notes, the interview STORYBANK (titled wins +
 * earned-secret insights → rich case studies), and a digest of evaluation
 * reports. `cv` is returned separately so the route can gate on it; `extra` is
 * the labeled, size-capped supporting material. All reads are profile-scoped.
 */
export function buildPortfolioContext(root: string = careerOpsRoot()): { cv: string; extra: string } {
  const cv = safeRead(path.join(root, "cv.md")) ?? "";
  const profile = safeRead(path.join(root, "config", "profile.yml"));
  const profileNotes = safeRead(path.join(root, "modes", "_profile.md"));
  // coaching_state: profile-local, else the engine's shared interview-coach skill.
  const coaching =
    safeRead(path.join(root, "coaching_state.md")) ??
    (path.resolve(root) === path.resolve(careerOpsRoot())
      ? safeRead(path.resolve(careerOpsRoot(), "..", "interview-coach-skill", "coaching_state.md"))
      : null);
  const storybank = storybankOf(coaching);

  let reports = "";
  try {
    const dir = path.join(root, "reports");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !/RESERVED/.test(f)).slice(0, 4);
    reports = files.map((f) => cap(safeRead(path.join(dir, f)), 1500)).filter(Boolean).join("\n\n---\n\n");
  } catch {
    /* no reports */
  }

  const extra = [
    profile ? `## config/profile.yml\n${cap(profile, 6000)}` : "",
    profileNotes ? `## modes/_profile.md (personalization)\n${cap(profileNotes, 6000)}` : "",
    storybank ? `## Interview storybank (titled wins + earned secrets — use these for deep case studies)\n${storybank}` : "",
    reports ? `## Recent evaluation reports (for proof points)\n${cap(reports, 6000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { cv, extra };
}

export const DEPLOY_README = `# Your portfolio site

This folder is a complete, self-contained static site — \`index.html\` has everything
inlined (only Google Fonts loads over the network). Deploy it anywhere:

- **Netlify Drop** — drag this folder onto https://app.netlify.com/drop
- **GitHub Pages** — commit \`index.html\` to a repo, enable Pages on the branch
- **Vercel** — \`vercel deploy\` in this folder, or drag-drop in the dashboard
- **Any host** — upload \`index.html\`; no build step required

Generated by career-ops / HireSignal. Edit \`index.html\` freely.
`;
