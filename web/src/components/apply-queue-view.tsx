"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ListChecks, Send, CheckSquare, Square } from "lucide-react";
import { useApply } from "@/components/apply/apply-provider";
import { CompanyLogo } from "@/components/company-logo";
import { Badge } from "@/components/ui/badge";
import { scoreTone } from "@/lib/format";
import { cn } from "@/lib/cn";

export type QueueCandidate = { n: string; company: string; role: string; score: string; status: string; url: string | null };

// Batch apply-prep: pick several evaluated-but-not-yet-applied roles, queue them,
// and process them SEQUENTIALLY through the existing single-session apply flow
// (open → prefill → human reviews/fills/submits → mark applied or skip → next).
// No parallel Chrome windows — see apply-provider.tsx's startQueue/queueNext.
export function ApplyQueueView({ candidates }: { candidates: QueueCandidate[] }) {
  const router = useRouter();
  const apply = useApply();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const eligible = useMemo(() => candidates.filter((c) => !!c.url), [candidates]);

  const toggle = (n: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  const toggleAll = () => setSelected((prev) => (prev.size === eligible.length ? new Set() : new Set(eligible.map((c) => c.n))));

  const startBatch = async () => {
    const items = eligible
      .filter((c) => selected.has(c.n))
      .map((c) => ({ n: c.n, url: c.url!, title: c.role, company: c.company }));
    if (!items.length) return;
    await apply.startQueue(items);
    router.push("/apply");
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center gap-3">
        <ListChecks className="size-6 text-brand" />
        <h1 className="font-display text-2xl tracking-tight text-landing">Apply queue</h1>
      </div>
      <p className="mt-1.5 max-w-xl text-sm text-muted">
        Pick several evaluated roles and queue them. career-ops opens and pre-fills them one at a time — you still review,
        fill, and click Submit yourself on every single one; the queue just removes the busywork between applications.
      </p>

      {eligible.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-12 text-center">
          <p className="font-display text-lg">Nothing to queue yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Evaluate a few roles from Explore or the Pipeline first — once they have a posting URL and aren&apos;t already
            applied, they&apos;ll show up here.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={toggleAll}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
            >
              {selected.size === eligible.length ? <CheckSquare className="size-4 text-brand" /> : <Square className="size-4" />}
              {selected.size === eligible.length ? "Deselect all" : "Select all"}
            </button>
            <span className="text-xs text-faint">{selected.size} selected · {eligible.length} eligible</span>
          </div>

          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface/40">
            {eligible.map((c) => {
              const on = selected.has(c.n);
              return (
                <li key={c.n}>
                  <button
                    type="button"
                    onClick={() => toggle(c.n)}
                    className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover", on && "bg-brand-soft/40")}
                  >
                    {on ? <CheckSquare className="size-4 shrink-0 text-brand" /> : <Square className="size-4 shrink-0 text-faint" />}
                    <CompanyLogo name={c.company} size={20} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.company}</span>
                      <span className="block truncate text-xs text-muted">{c.role}</span>
                    </span>
                    <Badge tone={scoreTone(c.score)}>{c.score || "—"}</Badge>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => void startBatch()}
              className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground shadow-lg shadow-brand/25 transition-all hover:bg-brand-200 disabled:opacity-50"
            >
              <Send className="size-4" /> Queue {selected.size || ""} application{selected.size === 1 ? "" : "s"}
            </button>
            <p className="text-xs text-muted">Opens the first one now — you review and submit each yourself, one at a time.</p>
          </div>
        </>
      )}
    </div>
  );
}
