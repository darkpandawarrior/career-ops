import Link from "next/link";
import { LayoutGrid, ArrowRight } from "lucide-react";

// Board snapshot (server prop — no client fetch). The page passes jobDashboard's
// headline stats; we render Excellent / total / sources as compact KPIs with a
// link into the full board. Hidden when there are no scored roles at all.
export function BoardSnapshot({
  total,
  excellent,
  sources,
}: {
  total: number;
  excellent: number;
  sources: number;
}) {
  if (total === 0 && sources === 0) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <LayoutGrid className="size-4 text-brand" />
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Board snapshot</h2>
        <span className="text-xs text-faint">· scored market matches</span>
        <Link href="/board" className="ml-auto inline-flex items-center gap-1 text-xs text-muted transition hover:text-brand">
          Open board <ArrowRight className="size-3" />
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat value={excellent} label="Excellent" hint="score ≥ 8" tone="good" />
        <Stat value={total} label="Total roles" hint="on the board" />
        <Stat value={sources} label="Sources" hint="search leads" />
      </div>
    </section>
  );
}

function Stat({
  value,
  label,
  hint,
  tone = "muted",
}: {
  value: number;
  label: string;
  hint: string;
  tone?: "good" | "muted";
}) {
  return (
    <Link
      href="/board"
      className="rounded-2xl border border-border bg-surface/50 p-4 transition hover:border-brand/40 hover:bg-surface-hover"
    >
      <div className={tone === "good" ? "text-3xl font-semibold leading-none tabular-nums text-emerald-600 dark:text-emerald-400" : "text-3xl font-semibold leading-none tabular-nums text-foreground"}>
        {value}
      </div>
      <div className="mt-2 text-sm text-foreground">{label}</div>
      <div className="text-xs text-faint">{hint}</div>
    </Link>
  );
}
