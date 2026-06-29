import Link from "next/link";
import { Target, ArrowRight } from "lucide-react";

// Lightweight server prop derived from readCoachState — only what the snapshot
// needs (so page.tsx can pass a small object, not the whole CoachState).
export type CoachSnapshot = {
  loops: string[];
  drillStage: string;
  drillQueue: string;
  outcomes: { date: string; company: string; role: string; round: string; result: string }[];
};

// Loop bullets in coaching_state.md are descriptive paragraphs that lead with a
// bold "Company — Round (STATUS)." prefix. Surface that lead prominently and
// trim the trailing detail to one clause so the snapshot stays scannable.
function splitLoop(raw: string): { label: string; rest: string } {
  const bold = raw.match(/^\*\*(.+?)\*\*\s*(.*)$/s);
  const lead = (bold ? bold[1] : raw).replace(/\*\*/g, "").trim();
  let tail = (bold ? bold[2] : "").replace(/\*\*/g, "").trim();
  if (tail.length > 140) tail = tail.slice(0, 140).replace(/\s+\S*$/, "") + "…";
  return { label: lead, rest: tail };
}

// Interview snapshot (server, conditional): active loops as bullets, the drill
// stage + revisit-queue line, and the last 1–2 outcomes. Hidden entirely when
// there is no coach state. Deep-links into the Intel/Ops console.
export function InterviewSnapshot({ snapshot }: { snapshot: CoachSnapshot }) {
  const { loops, drillStage, drillQueue, outcomes } = snapshot;
  const recent = outcomes.slice(-2).reverse();
  // The revisit queue can be a long enumerated list — keep it to one clause.
  const queue = drillQueue.length > 120 ? drillQueue.slice(0, 120).replace(/[\s,;]+\S*$/, "") + "…" : drillQueue;
  if (loops.length === 0 && recent.length === 0 && (!drillStage || drillStage === "?")) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <Target className="size-4 text-brand" />
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Interview snapshot</h2>
        <span className="text-xs text-faint">· active loops & drill progress</span>
        <Link href="/ops" className="ml-auto inline-flex items-center gap-1 text-xs text-muted transition hover:text-brand">
          Open Intel <ArrowRight className="size-3" />
        </Link>
      </div>

      <div className="rounded-2xl border border-border bg-surface/50 p-5">
        {loops.length > 0 && (
          <ul className="grid gap-2.5">
            {loops.map((l, i) => {
              const { label, rest } = splitLoop(l);
              return (
                <li key={i} className="flex gap-2.5 text-[13px]">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />
                  <span className="line-clamp-2 min-w-0">
                    <span className="font-medium text-foreground">{label}</span>
                    {rest && <span className="text-muted"> {rest}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {drillStage && drillStage !== "?" && (
          <p className="mt-4 line-clamp-2 text-sm text-muted">
            Drill stage <span className="font-medium text-foreground">{drillStage}</span>
            {queue && (
              <>
                <span className="text-faint"> · revisit </span>
                <span className="text-foreground">{queue}</span>
              </>
            )}
          </p>
        )}

        {recent.length > 0 && (
          <ul className="mt-4 grid gap-1.5 border-t border-border pt-4">
            {recent.map((o, i) => (
              <li key={i} className="flex items-baseline gap-2 text-[13px]">
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">{o.date}</span>
                <span className="min-w-0 truncate text-muted">
                  <span className="font-medium text-foreground">{o.company}</span>
                  {o.round && <span> · {o.round}</span>}
                  {o.result && <span className="text-brand"> — {o.result}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
