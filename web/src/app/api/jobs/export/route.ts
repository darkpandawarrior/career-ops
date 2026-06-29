import { jobDashboard } from "@/lib/jobs/scoring";
import { requestRoot } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Quote a CSV cell (RFC-4180): wrap in quotes, double embedded quotes. */
function csv(value: unknown): string {
  const s = value == null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Export the active profile's scored job board as CSV — the same jobs the board
 * shows, ranked, for a spreadsheet / external pipeline. Read-only.
 */
export async function GET() {
  const data = jobDashboard(await requestRoot());
  const header = ["score", "level", "priority", "title", "company", "location", "matchedSkills", "gates", "url"];
  const rows = data.jobs
    .filter((j) => j.type !== "searchLead")
    .sort((a, b) => Number(b.score) - Number(a.score))
    .map((j) =>
      [
        j.score,
        j.level,
        j.priority,
        j.title,
        j.company,
        j.location ?? "",
        (j.matchedSkills ?? []).join("; "),
        (j.gates ?? []).join("; "),
        j.url ?? "",
      ]
        .map(csv)
        .join(","),
    );
  const body = [header.map(csv).join(","), ...rows].join("\r\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hiresignal-jobs.csv"`,
    },
  });
}
