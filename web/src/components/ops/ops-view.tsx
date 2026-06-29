"use client";

import { useMemo, useState } from "react";
import {
  Search, Radar, ShieldCheck, Activity, HeartPulse, Loader2, ExternalLink, Inbox, Terminal,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { ScanHistory, AgentInboxItem } from "@/lib/career-ops";

const OPS = [
  { op: "pipeline-health", label: "Pipeline health", icon: HeartPulse, hint: "Verify pending URLs", heavy: false },
  { op: "scan", label: "Portal scan", icon: Radar, hint: "Crawl tracked portals", heavy: true },
  { op: "scan-verify", label: "Scan + verify", icon: ShieldCheck, hint: "Scan, then liveness-check", heavy: true },
  { op: "liveness", label: "Liveness", icon: Activity, hint: "Re-check known URLs", heavy: true },
] as const;

function statusTone(s: string): string {
  const k = (s || "").toLowerCase();
  if (k.includes("new")) return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (k.includes("applied")) return "bg-sky-500/15 text-sky-600 dark:text-sky-400";
  if (k.includes("expired") || k.includes("dead") || k.includes("closed")) return "bg-red-500/15 text-red-500";
  if (k.includes("seen") || k.includes("known")) return "bg-surface-hover text-muted";
  return "bg-surface-hover text-muted";
}

export function OpsView({ scans, inbox }: { scans: ScanHistory; inbox: AgentInboxItem[] }) {
  const [q, setQ] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [out, setOut] = useState<{ label: string; output: string; code: number | null } | null>(null);

  const runOp = async (op: string, label: string) => {
    setRunning(op);
    setOut({ label, output: "Running…", code: null });
    try {
      const r = await fetch("/api/ops/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op }),
      });
      const d = await r.json();
      setOut({ label, output: d.output || d.error || "(no output)", code: d.code ?? null });
    } catch {
      setOut({ label, output: "Failed to run operation (network error).", code: 1 });
    } finally {
      setRunning(null);
    }
  };

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return scans.rows;
    return scans.rows.filter((r) =>
      `${r.company} ${r.title} ${r.status} ${r.portal} ${r.location}`.toLowerCase().includes(n),
    );
  }, [scans.rows, q]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div>
        <h1 className="font-display text-2xl tracking-tight text-landing">Ops</h1>
        <p className="mt-1 text-sm text-muted">
          Discovery log + operations. {scans.total.toLocaleString()} roles seen
          {scans.lastScan && <span className="text-faint"> · last scan {scans.lastScan}</span>}
        </p>
      </div>

      {/* operations */}
      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        {OPS.map(({ op, label, icon: Icon, hint, heavy }) => (
          <button
            key={op}
            onClick={() => runOp(op, label)}
            disabled={!!running}
            className="group rounded-2xl border border-border bg-surface/50 p-4 text-left transition-colors hover:border-brand/40 hover:bg-surface-hover disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              {running === op ? <Loader2 className="size-4 animate-spin text-brand" /> : <Icon className="size-4 text-brand" />}
              <span className="text-sm font-medium">{label}</span>
            </div>
            <p className="mt-1 text-xs text-faint">
              {hint}
              {heavy && <span className="ml-1 rounded bg-amber-500/15 px-1 text-amber-600 dark:text-amber-400">slow</span>}
            </p>
          </button>
        ))}
      </div>

      {/* op output */}
      {out && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface/60">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted">
            <Terminal className="size-3.5" /> {out.label}
            {out.code !== null && (
              <span className={cn("ml-auto rounded px-1.5 py-0.5", out.code === 0 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-red-500/15 text-red-500")}>
                exit {out.code}
              </span>
            )}
          </div>
          <pre className="max-h-72 overflow-auto px-4 py-3 text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">{out.output}</pre>
        </div>
      )}

      {/* byStatus chips */}
      {Object.keys(scans.byStatus).length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {Object.entries(scans.byStatus).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
            <span key={s} className={cn("rounded-md px-2 py-1 text-xs font-medium", statusTone(s))}>
              {s} <span className="tabular-nums opacity-70">{n}</span>
            </span>
          ))}
        </div>
      )}

      {/* agent inbox */}
      {inbox.length > 0 && (
        <section className="mt-6">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            <Inbox className="size-3.5" /> Agent inbox
          </h2>
          <ul className="mt-2 space-y-1">
            {inbox.map((it, i) => (
              <li key={i} className={cn("flex items-start gap-2 rounded-md bg-surface/50 px-3 py-1.5 text-sm", it.done && "text-faint line-through")}>
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", it.done ? "bg-emerald-500" : "bg-brand")} />
                {it.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* scan history */}
      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Scan history</h2>
          <div className="relative w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter…"
              className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-xs outline-none focus:border-brand/50"
            />
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-10 text-center text-sm text-muted">
            {scans.total === 0 ? "No scan history yet — run a Portal scan above." : "No rows match that filter."}
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface/60 text-xs uppercase tracking-wide text-faint">
                <tr>
                  <th className="px-3 py-2 font-medium">Seen</th>
                  <th className="px-3 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Portal</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Location</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 400).map((r, i) => (
                  <tr key={i} className="border-t border-border hover:bg-surface-hover">
                    <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-faint">{r.first_seen}</td>
                    <td className="px-3 py-2">{r.company || "—"}</td>
                    <td className="px-3 py-2">
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-brand">
                          <span className="line-clamp-1">{r.title || "—"}</span>
                          <ExternalLink className="size-3 shrink-0 text-faint" />
                        </a>
                      ) : (
                        r.title || "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{r.portal}</td>
                    <td className="px-3 py-2">
                      <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", statusTone(r.status))}>{r.status || "—"}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{r.location}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 400 && (
              <div className="border-t border-border px-3 py-2 text-center text-xs text-faint">
                showing first 400 of {rows.length.toLocaleString()}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
