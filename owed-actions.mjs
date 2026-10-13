// Owed actions — the steps where THEY are waiting on YOU.
//
// FORK-ONLY. Upstream has no equivalent: career-ops models follow-ups (you chasing them) and has
// no concept of the inverse. That inverse is this user's measured dominant failure mode. Four
// applications died at an incomplete screening step, and on 2026-08-24 a fifth was mid-death — a
// Talent Pro questionnaire on the highest-scoring role in the pipeline (₹40-70L, remote, KMP)
// sat unanswered through two reminders while the tracker reported the row as merely "overdue",
// indistinguishable from 46 LinkedIn no-reply rows nobody can write to.
//
// The distinction matters because the two states need opposite handling:
//   - overdue follow-up  → you may nudge; they may simply be slow; often not actionable at all
//   - owed action        → the process is BLOCKED on you and will time out silently
//
// data/owed-actions.md is the hand-maintained record of the second kind. Before this module, zero
// files in the engine referenced it — the one artifact naming the real bottleneck was invisible to
// all 132 scripts. This reads it; it never writes it.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { resolveCareerOpsRoot } from './path-resolver.mjs';

const { dataRoot: CAREER_OPS_DATA } = resolveCareerOpsRoot(import.meta.url);

export const OWED_ACTIONS_FILE = join(CAREER_OPS_DATA, 'data', 'owed-actions.md');

// A row is a markdown table row whose first cell is the tracker's application number. The last
// cell is the done-marker. Unchecked forms seen in the wild: ☐ and an empty cell. Checked: ☑ ✅ x.
const ROW_RE = /^\|\s*(\d+)\s*\|(.*)\|\s*$/;
const DONE_RE = /[☑✅]|\[x\]/i;

/**
 * Parse data/owed-actions.md into the set of applications currently blocked on the user.
 *
 * Returns `[{ appNum, company, owed, since, action }]` for UNCHECKED rows only. A checked row is
 * finished and deliberately produces nothing — this is a queue, not a history.
 *
 * Fails open: a missing or unreadable file yields `[]`. This feeds an urgency signal, and a parse
 * problem must not manufacture urgency for applications that have none.
 */
export function parseOwedActions(text) {
  if (!text) return [];
  const out = [];
  // The real file also keeps history tables (Cleared, Drafted, Sent) whose rows start with an app
  // number too, so once a `## ` heading appears only an `## Owed…` section counts. Read
  // unsectioned, #60/#74/#75/#100 surfaced as urgent from the "Cleared" table on 2026-10-13.
  let inOwed = true;
  for (const line of text.split('\n')) {
    const h = /^##\s+(.*)/.exec(line);
    if (h) { inOwed = /^owed\b/i.test(h[1].trim()); continue; }
    if (!inOwed) continue;
    const m = ROW_RE.exec(line.trim());
    if (!m) continue;
    const appNum = Number(m[1]);
    if (!Number.isFinite(appNum)) continue;

    const cells = m[2].split('|').map((c) => c.trim());
    // The header row (`| # | Company | ...`) never matches ROW_RE because `#` is not a digit, and
    // the delimiter row (`|---|---|`) fails the same test. No explicit skip needed.
    const doneCell = cells[cells.length - 1] || '';
    if (DONE_RE.test(doneCell)) continue; // resolved

    out.push({
      appNum,
      company: cells[0] || '',
      owed: cells[1] || '',
      since: cells[2] || '',
      action: cells[3] || '',
    });
  }
  return out;
}

/** Read + parse the real file. `[]` when absent — see the fail-open note above. */
export function loadOwedActions(filePath = OWED_ACTIONS_FILE) {
  if (!filePath || !existsSync(filePath)) return [];
  try {
    return parseOwedActions(readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

/** Set of application numbers with an outstanding owed action — the shape urgency wants. */
export function owedAppNumbers(filePath = OWED_ACTIONS_FILE) {
  return new Set(loadOwedActions(filePath).map((r) => r.appNum));
}
