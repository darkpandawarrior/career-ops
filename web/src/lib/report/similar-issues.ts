// Dupe-deflection for the bug-report kit: search open GitHub issues on the same
// repo the "file this issue" link already points at (see REPO in ./report).
// Public repo, public search API — no token needed. Best-effort only: a rate
// limit or offline network silently yields no suggestions, it never blocks
// the report flow.
//
// PRIVACY: every caller of searchIssues() must gate the call behind the user's
// own click on "Report a bug" (fingerprint search) or an explicit in-modal
// button press (free-text search). Never call this on page load or on a bare
// keystroke — see beta-banner.tsx for the click-gating.
const REPO = "kirklazar-android/hiresignal";

export type SimilarIssue = { number: number; title: string; url: string };

export async function searchIssues(q: string): Promise<SimilarIssue[]> {
  try {
    const res = await fetch(
      `https://api.github.com/search/issues?per_page=4&q=${encodeURIComponent(`repo:${REPO} is:issue is:open ${q}`)}`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!res.ok) return [];
    const d = await res.json();
    return (d.items || []).map((i: { number: number; title: string; html_url: string }) => ({
      number: i.number,
      title: i.title,
      url: i.html_url,
    }));
  } catch {
    return [];
  }
}
