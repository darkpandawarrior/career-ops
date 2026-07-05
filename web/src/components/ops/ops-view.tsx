"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Radar, ShieldCheck, Activity, HeartPulse, Loader2, ExternalLink, Inbox, Terminal, Plus, X, Link2, Gauge, Repeat2, History, Coins,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { PageShell, PageHeader } from "@/components/ui/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import type { ScanHistory, AgentInboxItem } from "@/lib/career-ops";
import type { PortalsMeta } from "@/lib/portals-meta";
import { COMMAND_CATALOG } from "@/lib/commands";

const QUICK_TASKS = [
  "Process the agent inbox",
  "Evaluate the next inbox posting",
  "Run a deep scan for new roles",
  "Draft follow-ups for overdue applications",
] as const;

const OPS = [
  { op: "pipeline-health", label: "Pipeline health", icon: HeartPulse, hint: "Verify pending URLs", heavy: false },
  { op: "scan", label: "Portal scan", icon: Radar, hint: "Crawl tracked portals", heavy: true },
  { op: "scan-verify", label: "Scan + verify", icon: ShieldCheck, hint: "Scan, then liveness-check", heavy: true },
  { op: "liveness", label: "Liveness", icon: Activity, hint: "Re-check known URLs", heavy: true },
  { op: "process-quality", label: "Process quality", icon: Gauge, hint: "Recruiting friction signals", heavy: false },
  { op: "detect-reposts", label: "Detect reposts", icon: Repeat2, hint: "Roles re-listed 2+ times", heavy: false },
  { op: "apify-search", label: "Broad search", icon: Coins, hint: "LinkedIn/Indeed/Glassdoor — costs Apify credits", heavy: true, paid: true },
] as const;

/** Splits an agent-inbox.md entry ("{stamp} — {request} → result: {summary}")
 *  into its displayable parts. `result` is only present on resolved entries. */
function splitInboxEntry(text: string): { when?: string; body: string; result?: string } {
  const m = text.match(/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})\s*[—-]\s*(.+)$/);
  const when = m?.[1];
  const rest = m?.[2] ?? text;
  const r = rest.match(/^(.+?)\s*→ result:\s*(.+)$/);
  return r ? { when, body: r[1].trim(), result: r[2].trim() } : { when, body: rest };
}

function statusTone(s: string): string {
  const k = (s || "").toLowerCase();
  if (k.includes("new")) return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (k.includes("applied")) return "bg-sky-500/15 text-sky-600 dark:text-sky-400";
  if (k.includes("expired") || k.includes("dead") || k.includes("closed")) return "bg-red-500/15 text-red-500";
  if (k.includes("seen") || k.includes("known")) return "bg-surface-hover text-muted";
  return "bg-surface-hover text-muted";
}

export function OpsView({
  scans,
  inbox,
  portals = { companies: [], queries: [] },
}: {
  scans: ScanHistory;
  inbox: AgentInboxItem[];
  portals?: PortalsMeta;
}) {
  const [q, setQ] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [out, setOut] = useState<{ label: string; output: string; code: number | null } | null>(null);
  const [task, setTask] = useState("");
  const [livenessUrl, setLivenessUrl] = useState("");
  const [checkingLiveness, setCheckingLiveness] = useState(false);
  const router = useRouter();

  const queueText = async (text: string) => {
    const t = text.trim();
    if (!t) return;
    await fetch("/api/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t }) });
    router.refresh();
  };
  const queueTask = async () => {
    const text = task.trim();
    if (!text) return;
    setTask("");
    await queueText(text);
  };
  const removeTask = async (text: string) => {
    await fetch("/api/queue", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    router.refresh();
  };

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

  const checkLiveness = async () => {
    const url = livenessUrl.trim();
    if (!url || checkingLiveness) return;
    setCheckingLiveness(true);
    setOut({ label: "Liveness · URL check", output: `Checking ${url}…`, code: null });
    try {
      const r = await fetch("/api/liveness", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const d = await r.json();
      const tag = d.live === true ? "✅ live\n\n" : d.live === false ? "❌ dead\n\n" : "";
      setOut({ label: "Liveness · URL check", output: tag + (d.output || d.error || "(no output)"), code: d.code ?? (d.ok ? 0 : 1) });
    } catch {
      setOut({ label: "Liveness · URL check", output: "Failed to check liveness (network error).", code: 1 });
    } finally {
      setCheckingLiveness(false);
    }
  };

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return scans.rows;
    return scans.rows.filter((r) =>
      `${r.company} ${r.title} ${r.status} ${r.portal} ${r.location}`.toLowerCase().includes(n),
    );
  }, [scans.rows, q]);

  const pending = useMemo(() => inbox.filter((it) => !it.done), [inbox]);
  const resolved = useMemo(() => inbox.filter((it) => it.done), [inbox]);

  return (
    <PageShell maxWidth="5xl">
      <PageHeader
        title="Ops"
        description={
          <>
            Discovery log + operations. {scans.total.toLocaleString()} roles seen
            {scans.lastScan && <span className="text-faint"> · last scan {scans.lastScan}</span>}
          </>
        }
      />

      {/* operations */}
      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        {OPS.map(({ op, label, icon: Icon, hint, heavy, ...rest }) => {
          const paid = "paid" in rest && rest.paid;
          return (
            <button
              key={op}
              onClick={() => {
                if (paid && !window.confirm(`${label} costs real Apify credits per run (a few cents to a couple dollars). Run it anyway?`)) return;
                runOp(op, label);
              }}
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
                {paid && <span className="ml-1 rounded bg-brand-soft px-1 text-brand">paid</span>}
              </p>
            </button>
          );
        })}
      </div>

      {/* ad-hoc liveness — paste any job URL, spawn check-liveness.mjs for it */}
      <div className="mt-3 flex gap-2">
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <input
            value={livenessUrl}
            onChange={(e) => setLivenessUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && checkLiveness()}
            placeholder="Paste a job URL to check liveness…"
            className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-sm outline-none focus:border-brand/50"
          />
        </div>
        <button
          onClick={checkLiveness}
          disabled={!livenessUrl.trim() || checkingLiveness}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-50"
        >
          {checkingLiveness ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />} Check
        </button>
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

      {/* agent inbox — queue tasks for the agent to run */}
      <section className="mt-6">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
          <Inbox className="size-3.5" /> Agent inbox
        </h2>
        <div className="mt-2 flex gap-2">
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && queueTask()}
            placeholder="Queue a task for the agent…"
            className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand/50"
          />
          <button
            onClick={queueTask}
            disabled={!task.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:bg-brand-200 disabled:opacity-50"
          >
            <Plus className="size-3.5" /> Queue
          </button>
        </div>

        {/* quick-queue suggestions */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK_TASKS.map((t) => (
            <button
              key={t}
              onClick={() => queueText(t)}
              className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-brand/40 hover:text-brand"
            >
              + {t}
            </button>
          ))}
        </div>

        {pending.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {pending.map((it, i) => {
              const { when, body } = splitInboxEntry(it.text);
              return (
                <li key={i} className="group flex items-start gap-2 rounded-md bg-surface/50 px-3 py-1.5 text-sm">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block">{body}</span>
                    {when && <span className="text-[10px] tabular-nums text-faint">{when}</span>}
                  </span>
                  <button onClick={() => removeTask(it.text)} className="text-faint opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100" aria-label="Remove">
                    <X className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-faint">No queued tasks. Add one above — the agent runs them at the next session start.</p>
        )}

        {resolved.length > 0 && (
          <details className="mt-3 group/history">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-faint transition-colors hover:text-brand">
              <History className="size-3.5" /> Resolved ({resolved.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {resolved.map((it, i) => {
                const { when, body, result } = splitInboxEntry(it.text);
                return (
                  <li key={i} className="flex items-start gap-2 rounded-md bg-surface/30 px-3 py-1.5 text-sm text-faint">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block line-through">{body}</span>
                      <span className="flex flex-wrap gap-x-2 text-[10px]">
                        {when && <span className="tabular-nums">{when}</span>}
                        {result && <span className="text-emerald-600 dark:text-emerald-400">→ {result}</span>}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </section>

      {/* commands + tracked companies + queries */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {COMMAND_CATALOG.map((g) => (
          <div key={g.group} className="rounded-2xl border border-border bg-surface/40 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">{g.group}</h3>
            <ul className="mt-2 space-y-1">
              {g.commands.map((c) => (
                <li key={c.cmd}>
                  <button
                    onClick={() => navigator.clipboard?.writeText(c.cmd)}
                    title={`${c.desc} — click to copy`}
                    className="w-full truncate rounded px-1.5 py-1 text-left font-mono text-[11px] text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                  >
                    {c.cmd}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="rounded-2xl border border-border bg-surface/40 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            Tracked companies <span className="text-faint">{portals.companies.filter((c) => c.enabled).length}</span>
          </h3>
          <div className="mt-2 flex max-h-44 flex-wrap gap-1 overflow-auto">
            {portals.companies.length === 0 && <span className="text-xs text-faint">none in portals.yml</span>}
            {portals.companies.map((c) =>
              c.url ? (
                <a key={c.name} href={c.url} target="_blank" rel="noreferrer" title={c.notes || c.url}
                  className={cn("rounded-md px-1.5 py-0.5 text-[11px] transition-colors hover:bg-surface-hover", c.enabled ? "bg-surface-hover text-muted" : "text-faint line-through")}>
                  {c.name}
                </a>
              ) : (
                <span key={c.name} className={cn("rounded-md px-1.5 py-0.5 text-[11px]", c.enabled ? "bg-surface-hover text-muted" : "text-faint line-through")}>{c.name}</span>
              ),
            )}
          </div>
          {portals.queries.length > 0 && (
            <>
              <h4 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-faint">Search queries</h4>
              <ul className="mt-1 space-y-0.5">
                {portals.queries.slice(0, 12).map((q) => (
                  <li key={q.name} className={cn("truncate text-[11px]", q.enabled ? "text-muted" : "text-faint line-through")}>{q.name}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

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
          <EmptyState
            className="mt-4"
            description={scans.total === 0 ? "No scan history yet — run a Portal scan above." : "No rows match that filter."}
          />
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
    </PageShell>
  );
}
