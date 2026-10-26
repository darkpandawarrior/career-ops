"use client";

import Link from "next/link";
import { Check, AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { pillTone, TONE } from "@/components/jobs/worker-pills";
import { cn } from "@/lib/cn";
import { PageShell, PageHeader } from "@/components/ui/page-shell";
import { EmptyState } from "@/components/ui/empty-state";

export default function JobsHistory() {
  const { jobs, clearFinished } = useJobs();

  return (
    <PageShell maxWidth="4xl" py="10">
      <PageHeader
        title="Workers"
        description={
          <>
            AI runs started from this dashboard, kept in this browser. <span className="tabular-nums">{jobs.length}</span> total.
          </>
        }
        actions={
          jobs.some((j) => j.status !== "running") && (
            <button
              onClick={clearFinished}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <Trash2 className="size-3.5" /> Clear finished
            </button>
          )
        }
      />

      {jobs.length === 0 ? (
        <EmptyState
          className="mt-8"
          description={
            <>
              No workers yet. Hit <span className="text-foreground">Evaluate</span> on an inbox posting to start one.
              <span className="mt-2 block">
                Ran an evaluation from your AI CLI? It shows up in{" "}
                <Link href="/pipeline?tab=ALL" className="text-foreground underline-offset-2 hover:underline">
                  Pipeline
                </Link>
                , not here.
              </span>
            </>
          }
        />
      ) : (
        <ul className="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface/40">
          {jobs.map((j) => {
            const tone = pillTone(j);
            return (
              <li key={j.id}>
                <Link href={`/jobs/${j.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover">
                  {j.status === "running" ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-brand" />
                  ) : j.status === "error" ? (
                    <AlertTriangle className="size-4 shrink-0 text-red-400" />
                  ) : (
                    <Check className="size-4 shrink-0 text-emerald-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{j.title}</div>
                    {(j.subtitle || j.result?.summary) && (
                      <div className="truncate text-xs text-muted">{j.result?.summary || j.subtitle}</div>
                    )}
                  </div>
                  {j.result?.score != null && (
                    <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums", TONE[tone].chip)}>
                      {j.result.score}/5
                    </span>
                  )}
                  <span className="hidden shrink-0 text-xs capitalize text-faint sm:block">{j.status}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
