import { recentLogs } from "./logbuf";

const REPO = "kirklazar-android/hiresignal";

/** Strip PII / secrets that could ride in error text, paths or logs BEFORE anything
 *  leaves the machine. Defence-in-depth — the user also reviews the full payload
 *  (preview-then-confirm) before the issue opens. */
export function scrub(s: string): string {
  return (s || "")
    .replace(/\/Users\/[^/\s"']+/g, "~")
    .replace(/\/home\/[^/\s"']+/g, "~")
    .replace(/[A-Za-z]:\\Users\\[^\\/\s"']+/gi, "~")
    .replace(/(sk|key|token|secret|bearer|api[-_]?key)([-_=:\s"']+)[A-Za-z0-9._-]{8,}/gi, "$1$2[redacted]");
}

/** Data-shape fingerprint from /api/report/shape — mirrors doctorState(). */
export type Shape = {
  phase: string;
  missing: string[];
  hasCv: boolean;
  hasData: boolean;
  inboxCount: number;
  applicationCount: number;
};

export type Diag = {
  version: string;
  channel: string;
  sha: string;
  route: string;
  cli: string;
  ua: string;
  viewport: string;
  logs: string[];
  shape: Shape | null;
};

/** Gather a STRUCTURAL diagnostic snapshot. Deliberately excludes anything personal:
 *  no cv.md, no profile, no application answers, no job URLs, no report content. */
export async function collect(): Promise<Diag> {
  let version = "";
  let channel = "stable";
  let sha = "";
  try {
    const d = await (await fetch("/api/version")).json();
    version = d.version || "";
    channel = d.channel || "stable";
    sha = d.sha || "";
  } catch {
    /* keep defaults */
  }
  let cli = "";
  try {
    // Per-profile CLI selection (/api/cli) — diagnostic should reflect the ACTIVE
    // profile's engine, not a stale global localStorage value.
    cli = (await (await fetch("/api/cli")).json()).selected || "";
  } catch {
    /* none */
  }
  let shape: Shape | null = null;
  try {
    shape = await (await fetch("/api/report/shape")).json();
  } catch {
    /* file-existence check unavailable */
  }
  return {
    version,
    channel,
    sha,
    route: scrub(location.pathname + location.search),
    cli,
    ua: navigator.userAgent,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    logs: recentLogs().map(scrub),
    shape,
  };
}

/** Short deterministic category label for an error message — used by fingerprint(). */
export function errorClass(msg: string): string {
  const s = (msg || "").trim();
  if (/networkerror|failed to fetch|load failed/i.test(s)) return "NetworkError";
  if (/typeerror/i.test(s)) return "TypeError";
  if (/rangeerror/i.test(s)) return "RangeError";
  if (/referenceerror/i.test(s)) return "ReferenceError";
  if (/syntaxerror/i.test(s)) return "SyntaxError";
  if (/^\[api]/i.test(s)) return "ApiError";
  return s ? "Error" : "None";
}

function strHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Stable short ID so duplicate reports (same route + same failure shape) collapse
 *  together at write time. Not cryptographic — just deterministic for the same inputs. */
export function fingerprint(d: Diag): string {
  const lastError = d.logs[d.logs.length - 1] || "";
  const parts = [d.route, errorClass(lastError), d.shape?.phase || ""];
  return `co-web-${strHash(parts.join("|"))}`;
}

/** The EXACT markdown body the user reviews and that becomes the GitHub issue. */
export function issueBody(d: Diag, description: string): string {
  return [
    "## What happened",
    scrub(description).trim() || "_(describe what you were doing and what went wrong)_",
    "",
    "## Environment",
    `- **Version:** \`${d.version || "?"}\` · ${d.channel}${d.sha ? ` · \`${d.sha}\`` : ""}`,
    `- **CLI:** ${d.cli || "—"}`,
    `- **Screen:** \`${d.route}\``,
    `- **Browser:** ${scrub(d.ua)}`,
    `- **Viewport:** ${d.viewport}`,
    "",
    "## Data shape",
    d.shape
      ? `- **Phase:** ${d.shape.phase} · **CV:** ${d.shape.hasCv ? "yes" : "no"} · **Data:** ${d.shape.hasData ? "yes" : "no"}\n` +
        `- **Inbox:** ${d.shape.inboxCount} · **Applications:** ${d.shape.applicationCount}\n` +
        `- **Missing prereqs:** ${d.shape.missing.length ? d.shape.missing.join(", ") : "none"}`
      : "_(unavailable)_",
    "",
    "## Recent errors",
    d.logs.length ? "```\n" + d.logs.join("\n") + "\n```" : "_(none captured)_",
    "",
    `Fingerprint: ${fingerprint(d)}`,
    "",
    "---",
    "_Filed from the in-app bug reporter. Contains NO CV, profile, application answers, or job URLs._",
  ]
    .join("\n")
    .slice(0, 6000);
}

export function issueUrl(d: Diag, description: string): string {
  const title = `[web ${d.channel}] ${(scrub(description) || "bug report").replace(/\s+/g, " ").trim().slice(0, 70)}`;
  const params = new URLSearchParams({ title, body: issueBody(d, description), labels: "2.0-beta,area:web" });
  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}
