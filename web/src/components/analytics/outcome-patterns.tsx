"use client";

import { useEffect, useState } from "react";
import { Loader2, TrendingDown } from "lucide-react";
import { cn } from "@/lib/cn";

// Rejection / outcome pattern analysis — moved here from Intel so "why am I
// being rejected" lives next to the rest of the pipeline-derived analytics
// (funnel, score distribution, top companies) instead of split across two
// pages. Fetches the same /api/patterns endpoint (backed by the core's
// analyze-patterns.mjs), unchanged.
export function OutcomePatterns() {
  const [patterns, setPatterns] = useState<{ loading: boolean; result: unknown; available: boolean }>({ loading: true, result: null, available: false });

  useEffect(() => {
    fetch("/api/patterns").then((r) => r.json()).then((d) =>
      setPatterns({ loading: false, result: d.result ?? null, available: !!d.available }),
    ).catch(() => setPatterns({ loading: false, result: null, available: false }));
  }, []);

  return (
    <section id="patterns" className="mt-10 scroll-mt-8">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-muted">
        <TrendingDown className="size-3.5" /> Why you&apos;re being rejected
      </h2>
      <div className="mt-4">
        {patterns.loading ? (
          <Loading label="Analyzing outcomes…" />
        ) : !patterns.available ? (
          <Empty>Not enough evaluated/decided applications to analyze yet.</Empty>
        ) : (
          <PatternsResult result={patterns.result} />
        )}
      </div>
    </section>
  );
}

const titleCase = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()).trim();

function PatternsResult({ result }: { result: unknown }) {
  if (!result || typeof result !== "object") {
    return <pre className="overflow-auto rounded-xl border border-border bg-surface/50 p-3 text-xs text-muted">{JSON.stringify(result, null, 2)}</pre>;
  }
  const r = result as Record<string, unknown>;
  const isScalar = (v: unknown) => v == null || ["string", "number", "boolean"].includes(typeof v);
  const scalarObj = (v: unknown): v is Record<string, string | number> =>
    !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v as object).every(isScalar);

  return (
    <div className="space-y-5">
      {/* Hiring funnel */}
      {scalarObj(r.funnel) && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Funnel</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(r.funnel).map(([k, v]) => (
              <span key={k} className="rounded-md bg-surface-hover px-2 py-1 text-xs capitalize text-muted">
                {k} <span className="tabular-nums font-semibold text-foreground">{v}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {Array.isArray(r.recommendations) && r.recommendations.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Recommendations</p>
          <div className="space-y-2">
            {(r.recommendations as Record<string, unknown>[]).map((rec, i) => (
              <div key={i} className="rounded-xl border border-border bg-surface/50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{String(rec.action ?? "")}</p>
                  {rec.impact != null && (
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase",
                      String(rec.impact) === "high" ? "bg-brand-soft text-brand" : "bg-surface-hover text-faint")}>
                      {String(rec.impact)}
                    </span>
                  )}
                </div>
                {rec.reasoning != null && <p className="mt-1 text-xs text-muted">{String(rec.reasoning)}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Remaining sections: scalar-objects → chips; object-arrays → key/value rows */}
      {Object.entries(r)
        .filter(([k, v]) => !["funnel", "recommendations", "metadata"].includes(k) && !(Array.isArray(v) && v.length === 0))
        .map(([k, v]) => {
          if (scalarObj(v)) {
            return (
              <div key={k}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{titleCase(k)}</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(v).map(([kk, vv]) => (
                    <span key={kk} className="rounded-md bg-surface-hover px-2 py-1 text-xs text-muted">
                      {titleCase(kk)} <span className="tabular-nums font-semibold text-foreground">{String(vv)}</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          }
          if (Array.isArray(v)) {
            return (
              <div key={k}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{titleCase(k)}</p>
                <div className="space-y-1.5">
                  {(v as unknown[]).map((row, i) =>
                    row && typeof row === "object" ? (
                      <div key={i} className="rounded-lg bg-surface/50 px-3 py-2 text-xs text-muted">
                        {Object.entries(row as Record<string, unknown>).map(([kk, vv]) => (
                          <span key={kk} className="mr-3 inline-block">
                            <span className="text-faint">{titleCase(kk)}:</span>{" "}
                            <span className="text-foreground">{String(vv)}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div key={i} className="text-xs text-muted">{String(row)}</div>
                    ),
                  )}
                </div>
              </div>
            );
          }
          return null;
        })}
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return <p className="flex items-center gap-2 text-sm text-faint"><Loader2 className="size-4 animate-spin" /> {label}</p>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border bg-surface/30 px-4 py-6 text-center text-sm text-muted">{children}</p>;
}
