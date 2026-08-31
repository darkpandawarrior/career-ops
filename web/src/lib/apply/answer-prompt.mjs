/**
 * answer-prompt.mjs - build the planner's pre-fill instruction from a form.
 *
 * Plain .mjs with no imports, for the same reason extract-json-object.mjs is:
 * the prompt is the part of apply/prefill that decides what the model is
 * allowed to answer, and it was unreachable by a test while it lived inline in
 * the route. The sensitive/consent carve-out is the line that matters - it is
 * what keeps legal, visa, work-authorization, salary, demographic and
 * "I agree" consent fields from being auto-filled - and nothing pinned it.
 *
 * Lifted from api/apply/prefill/route.ts (fork version: inlines the
 * candidate's real cv.md/profile/report text instead of telling the planner
 * to read files itself - see hiresignal-fork-adaptations-layer). The wording,
 * the tab-separated field list, the context block and the consent bullets are
 * the prompt the planner has been receiving all along; this is a relocation,
 * not a rewrite.
 */

/**
 * One form control, as much of it as the prompt needs. Structurally satisfied by
 * ApplyField, without importing it: extract.ts pulls in playwright-core, and a
 * module that does cannot be loaded by `node --test`.
 *
 * @typedef {Object} PromptField
 * @property {string} id
 * @property {string} type
 * @property {string} label
 * @property {boolean} [required]
 * @property {string[]} [options]
 */

/**
 * @param {{title: string, fields: PromptField[], memory?: string, cv?: string, profile?: string, report?: string}} opts
 * @returns {string}
 */
export function buildAnswerPrompt({ title, fields, memory = "", cv = "", profile = "", report = "" }) {
  const fieldsList = fields
    .map((f) => `${f.id}\t${f.type}${f.required ? "*" : ""}\t${f.label}${f.options ? `\t[options: ${f.options.join(" | ")}]` : ""}`)
    .join("\n");
  const haveCv = cv.trim().length > 0;
  const ctxBlock = haveCv
    ? `\n\n--- THE CANDIDATE'S REAL DATA (ground EVERY answer in this; invent NOTHING) ---\nCV (cv.md):\n"""\n${cv.slice(0, 16000)}\n"""${profile ? `\n\nProfile (config/profile.yml):\n"""\n${profile.slice(0, 4000)}\n"""` : ""}${report ? `\n\nPrior evaluation report for this role:\n"""\n${report}\n"""` : ""}`
    : `\nRead cv.md and config/profile.yml; if a matching report for this company exists in reports/, read it too.`;
  return `You are pre-filling a job application for the user (company/role: ${title}). Ground EVERY answer in the candidate's REAL data below — never invent facts.${memory ? `\n\nDurable notes about the user (prior answers they chose to remember):\n${memory}` : ""}${ctxBlock}

FIELDS (id ⇥ type ⇥ label ⇥ options):
${fieldsList}

For each field give the best answer:
- identity/contact (name, email, phone, github, linkedin, location) → from the data above.
- free-text (Why us?, cover-letter, "most impactful thing you've built", etc.) → a concise, honest, concrete answer in the candidate's own voice (no buzzwords, active voice, real metrics only). Keep each under ~120 words.
- select/radio → choose the best-matching option using the EXACT option text from the list.
- NEVER auto-answer SENSITIVE or CONSENT fields → set needs_confirmation:true and value:"" (the user decides these themselves):
  · legal / work-authorization / visa / sponsorship · salary / compensation expectations
  · demographic / EEO / veteran / disability / "voluntary self-identification"
  · CONSENT / acknowledgement / policy / guidelines / "I agree" / "I have read" / "I understand" / any Yes-No confirmation of terms — the user must READ and agree themselves.

Output ONLY a compact JSON object mapping each field id → {"value": "...", "needs_confirmation": boolean}. No prose, no markdown, no code fence.`;
}
