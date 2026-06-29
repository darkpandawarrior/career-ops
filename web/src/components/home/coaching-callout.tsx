import Link from "next/link";
import { Lightbulb, ArrowRight } from "lucide-react";

// Lightweight server prop derived from readCoachState — the effective patterns
// (what works for this candidate) + the current coaching strategy line.
export type CoachingCallout = {
  effectivePatterns: string[];
  strategy: string[];
};

// Coaching callout (server, conditional): 2–3 of the candidate's effective
// patterns as bullets plus a single strategy line, linking into Intel. Hidden
// when there is nothing to surface.
export function CoachingCallout({ callout }: { callout: CoachingCallout }) {
  const patterns = callout.effectivePatterns.slice(0, 3);
  const strategy = callout.strategy[0];
  if (patterns.length === 0 && !strategy) return null;

  return (
    <section className="mt-8">
      <div className="rounded-2xl border border-border bg-brand-soft/40 bg-gradient-to-br from-brand/10 via-transparent to-transparent bg-origin-border p-5">
        <div className="mb-3 flex items-center gap-2">
          <Lightbulb className="size-4 text-brand" />
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Your coaching edge</h2>
          <Link href="/ops" className="ml-auto inline-flex items-center gap-1 text-xs text-muted transition hover:text-brand">
            Intel <ArrowRight className="size-3" />
          </Link>
        </div>

        {patterns.length > 0 && (
          <ul className="grid gap-1.5">
            {patterns.map((p, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-muted">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-brand" />
                <span className="line-clamp-2">{p}</span>
              </li>
            ))}
          </ul>
        )}

        {strategy && (
          <p className="mt-3 border-t border-border/60 pt-3 text-[13px]">
            <span className="font-medium text-foreground">Strategy: </span>
            <span className="line-clamp-2 inline text-muted">{strategy}</span>
          </p>
        )}
      </div>
    </section>
  );
}
