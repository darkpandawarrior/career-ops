import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { withTrackerLock } from "@/lib/core/tracker-lock";

/**
 * Profile-aware tracker write helpers — port dashboard-web/server.mjs's
 * updateAppField / togglePipelineItem / queueAgentTask / removeAgentTask. These
 * are the sanctioned user-data edits the legacy dashboard performed (notes,
 * pipeline checkboxes, agent inbox). Each takes an explicit `root` so it writes
 * into the ACTIVE profile. All writes are atomic; table-breaking chars rejected.
 */

export type EditResult = "ok" | "not-found" | "error" | "invalid";

/** Locate the 0-based column index of a header cell (case-insensitive). */
function columnIndex(lines: string[], header: string): number | null {
  for (const l of lines) {
    if (!l.trim().startsWith("|")) continue;
    const cells = l.split("|").map((c) => c.trim().toLowerCase());
    const idx = cells.findIndex((c) => c === header.toLowerCase());
    if (idx > 0) return idx;
    if (/^:?-{2,}:?$/.test(cells[1] ?? "")) return null; // separator before a header → no header
  }
  return null;
}

/** Set a single cell (by application number `n`) in data/applications.md.
 *  Holds the same cross-process tracker lock merge-tracker.mjs/set-status.mjs
 *  and the /api/status route use, so this can't race a batch merge or a
 *  status-dropdown click into a silently lost update. A held-lock timeout
 *  surfaces as "error" (same result shape as a write failure) rather than
 *  throwing, since EditResult has no dedicated timeout variant. Async because
 *  the lock wait must never block the server's event loop (see
 *  tracker-lock.ts's withTrackerLock doc comment) — callers now `await` it. */
export async function setAppCell(
  n: string,
  header: "Notes" | "Status",
  value: string,
  root: string = careerOpsRoot(),
): Promise<EditResult> {
  if (/[|\r\n]/.test(value)) return "invalid"; // would scramble the markdown row
  const file = path.join(root, "data", "applications.md");
  try {
    return await withTrackerLock(file, () => {
      let md: string;
      try {
        md = fs.readFileSync(file, "utf8");
      } catch {
        return "not-found";
      }
      const lines = md.split("\n");
      const col = columnIndex(lines, header) ?? (header === "Status" ? 6 : 9);
      let changed = false;
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trim().startsWith("|")) continue;
        const parts = lines[i].split("|");
        if (parts.length < 8 || parts[1].trim() !== String(n)) continue;
        if (col >= parts.length - 1) continue;
        parts[col] = ` ${value} `;
        lines[i] = parts.join("|");
        changed = true;
        break;
      }
      if (!changed) return "not-found";
      try {
        atomicWriteWithBackup(file, lines.join("\n"));
        return "ok";
      } catch {
        return "error";
      }
    }, { timeoutMs: 8_000 });
  } catch {
    return "error";
  }
}

/** Toggle a pipeline.md inbox item `- [ ] URL` ↔ `- [x] URL`. */
export function togglePipeline(url: string, done: boolean, root: string = careerOpsRoot()): EditResult {
  const file = path.join(root, "data", "pipeline.md");
  let md: string;
  try {
    md = fs.readFileSync(file, "utf8");
  } catch {
    return "not-found";
  }
  const esc = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const updated = md.replace(new RegExp(`- \\[[ xX]\\] ${esc}`), `- [${done ? "x" : " "}] ${url}`);
  if (updated === md) return "not-found";
  try {
    atomicWriteWithBackup(file, updated);
    return "ok";
  } catch {
    return "error";
  }
}

/** Append a task to data/agent-inbox.md (deduped, timestamped). */
export function queueAgentTask(text: string, root: string = careerOpsRoot()): EditResult {
  const clean = text.replace(/\n/g, " ").trim();
  if (!clean) return "invalid";
  const file = path.join(root, "data", "agent-inbox.md");
  let md = "";
  try {
    md = fs.readFileSync(file, "utf8");
  } catch {
    md = "# Agent Inbox\n\n";
  }
  if (md.includes(clean.slice(0, 80))) return "ok"; // dedupe
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  try {
    atomicWriteWithBackup(file, md.replace(/\n*$/, "\n") + `- [ ] ${stamp} — ${clean}\n`);
    return "ok";
  } catch {
    return "error";
  }
}

/** Remove an agent-inbox task whose text matches (substring). */
export function removeAgentTask(text: string, root: string = careerOpsRoot()): EditResult {
  const file = path.join(root, "data", "agent-inbox.md");
  let md: string;
  try {
    md = fs.readFileSync(file, "utf8");
  } catch {
    return "not-found";
  }
  const t = text.trim();
  const lines = md.split("\n");
  const out = lines.filter((l) => !(l.startsWith("- [ ]") && l.includes(t)));
  if (out.length === lines.length) return "not-found";
  try {
    atomicWriteWithBackup(file, out.join("\n"));
    return "ok";
  } catch {
    return "error";
  }
}
