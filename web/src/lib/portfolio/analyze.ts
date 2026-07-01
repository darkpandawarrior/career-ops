// The portfolio ANALYZER's output contract. The AI critiques the generated
// portfolio and returns strengths, gaps, and ACTIONABLE suggestions — each
// suggestion carries an `action` string that can be fed straight back into the
// refine flow (generate with {instruction: action}).

export type Suggestion = { title: string; why?: string; action: string };
export type Analysis = {
  score?: number; // 0–100 self-assessed strength of the portfolio
  strengths: string[];
  gaps: string[];
  suggestions: Suggestion[];
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map(str).filter(Boolean).slice(0, 8);

/** Coerce arbitrary parsed JSON into a safe Analysis, never throwing. */
export function coerceAnalysis(raw: unknown): Analysis | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const suggestions: Suggestion[] = (Array.isArray(r.suggestions) ? r.suggestions : [])
    .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
    .map((s) => ({ title: str(s.title), why: str(s.why) || undefined, action: str(s.action) }))
    .filter((s) => s.title && s.action)
    .slice(0, 8);
  const strengths = strList(r.strengths);
  const gaps = strList(r.gaps);
  if (!suggestions.length && !strengths.length && !gaps.length) return null;
  const n = Number(r.score);
  return {
    score: Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : undefined,
    strengths,
    gaps,
    suggestions,
  };
}

export const ANALYZE_PROMPT = `You are a sharp portfolio reviewer + hiring manager. Critique the candidate's portfolio JSON below against their CV and goals. Be specific and honest — name real weaknesses, not platitudes.

Emit EXACTLY ONE JSON object (optionally fenced):
{
  "score": 0-100 (how strong this portfolio is for landing their target role),
  "strengths": ["what genuinely lands — be specific"],
  "gaps": ["what's weak, missing, or vague — be specific"],
  "suggestions": [ { "title": "Short imperative fix", "why": "1 line on the payoff", "action": "A concrete instruction the generator can apply, e.g. 'Lead the hero with the 80% crash-reduction win and quantify the GPS case study with the before/after numbers.'" } ]
}

Rules: 3–6 suggestions, each with an ACTIONABLE \`action\` (it will be applied verbatim as a revision instruction). Ground every point in their actual data — never invent. Output JSON only.`;
