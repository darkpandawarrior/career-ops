"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, ChevronsUpDown, Loader2, X, ArrowRight } from "lucide-react";
import type { Application, InboxJob } from "@/lib/career-ops";
import { Badge } from "@/components/ui/badge";
import { CompanyLogo } from "@/components/company-logo";
import { canonStatus, scoreNum, scoreTone, statusDot, CANONICAL_STATES } from "@/lib/format";
import { InboxTriage } from "@/components/inbox/inbox-triage";
import { cn } from "@/lib/cn";
import { PageShell, PageHeader } from "@/components/ui/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusDot } from "@/components/ui/status-dot";
import { companyPresentation, companySearchText } from "@/lib/company-presentation.mjs";

// INBOX (the action queue) is the default tab; the rest filter the tracker.
const TABS = [
  "INBOX",
  "ALL",
  "EVALUATED",
  "APPLIED",
  "RESPONDED",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
  "DISCARDED",
  "SKIP",
] as const;
type Tab = (typeof TABS)[number];

const SORT_KEYS = ["company", "role", "score", "status", "date"] as const;
type SortKey = (typeof SORT_KEYS)[number];

export function PipelineView({
  applications,
  inbox,
}: {
  applications: Application[];
  inbox: InboxJob[];
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // The URL is the SINGLE source of truth for tab/min/sort/dir, so the home stat
  // tiles' deep links AND the assistant's filterPipeline/navigate actions drive
  // the table identically (no useState mirror → no desync).
  const pTab = (params.get("tab") ?? "").toUpperCase();
  const tab: Tab = (TABS as readonly string[]).includes(pTab) ? (pTab as Tab) : "INBOX";
  const pMin = parseFloat(params.get("min") ?? "");
  const minFilter: number | null = Number.isFinite(pMin) ? pMin : null;
  const pSort = params.get("sort") ?? "";
  const sortKey: SortKey = (SORT_KEYS as readonly string[]).includes(pSort) ? (pSort as SortKey) : "score";
  const sort = { key: sortKey, dir: (params.get("dir") === "1" ? 1 : -1) as 1 | -1 };

  // Search stays LOCAL for snappy typing; seeded from the URL and re-synced only
  // when the URL's q changes (i.e. the assistant set it) — never per keystroke.
  const [q, setQ] = useState(params.get("q") ?? "");
  const lastUrlQ = useRef(params.get("q") ?? "");
  useEffect(() => {
    const urlQ = params.get("q") ?? "";
    if (urlQ !== lastUrlQ.current) {
      lastUrlQ.current = urlQ;
      setQ(urlQ);
    }
  }, [params]);

  const setParams = useCallback(
    (updates: Record<string, string | number | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v == null || v === "") sp.delete(k);
        else sp.set(k, String(v));
      }
      const qs = sp.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [params, router, pathname],
  );

  // Pending + deduped by URL (pipeline.md can list the same posting twice) so the
  // header count, the tab count, and the triage list all agree on one number.
  const pendingInbox = useMemo(() => {
    const seen = new Set<string>();
    const out: InboxJob[] = [];
    for (const j of inbox) {
      if (j.done || seen.has(j.url)) continue;
      seen.add(j.url);
      out.push(j);
    }
    return out;
  }, [inbox]);

  const filtered = useMemo(() => {
    if (tab === "INBOX") return [];
    let rows = applications;
    if (tab !== "ALL") rows = rows.filter((r) => canonStatus(r.status).includes(tab));
    if (minFilter != null) {
      rows = rows.filter((r) => {
        const n = scoreNum(r.score);
        return !Number.isNaN(n) && n >= minFilter;
      });
    }
    if (q.trim()) {
      const needle = q.toLowerCase();
      rows = rows.filter((r) => companySearchText(r).toLowerCase().includes(needle));
    }
    return [...rows].sort((a, b) => {
      if (sort.key === "score") {
        const an = scoreNum(a.score);
        const bn = scoreNum(b.score);
        const av = Number.isNaN(an) ? -Infinity : an;
        const bv = Number.isNaN(bn) ? -Infinity : bn;
        return (av - bv) * sort.dir;
      }
      // Sort the company column by what the row actually SHOWS: a confidential
      // employer renders as "Confidential · via X", so sorting the raw "?" would
      // pile every masked row together under a label nobody sees.
      const aValue = sort.key === "company" ? companyPresentation(a).label : a[sort.key] || "";
      const bValue = sort.key === "company" ? companyPresentation(b).label : b[sort.key] || "";
      return aValue.localeCompare(bValue) * sort.dir;
    });
  }, [applications, tab, q, sort, minFilter]);

  return (
    <PageShell maxWidth="6xl" className="max-sm:pb-24">
      <PageHeader
        title="Pipeline"
        description={
          <>
            <span className="tabular-nums">{pendingInbox.length}</span> in inbox ·{" "}
            <span className="tabular-nums">{applications.length}</span> tracked
          </>
        }
        actions={
          // the tracker has its own search; the inbox brings its own facet filters
          tab !== "INBOX" ? (
            <div className="relative w-64 max-w-[40vw]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search company or role…"
                className="w-full rounded-md border border-border bg-surface/60 py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40"
              />
            </div>
          ) : undefined
        }
      />

      {/* funnel mini-viz — status distribution across the tracker */}
      <Funnel applications={applications} />

      {/* tabs */}
      <div className="mt-6 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => {
          const count =
            t === "INBOX"
              ? pendingInbox.length
              : t === "ALL"
                ? applications.length
                : applications.filter((r) => canonStatus(r.status).includes(t)).length;
          return (
            <button
              key={t}
              onClick={() => setParams({ tab: t === "INBOX" ? null : t })}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors max-sm:min-h-[44px]",
                tab === t
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted hover:text-foreground",
              )}
            >
              {t} <span className="text-faint tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      {tab !== "INBOX" && minFilter != null && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-faint">Filtered:</span>
          <button
            type="button"
            onClick={() => setParams({ min: null })}
            className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand/15 max-sm:min-h-[44px]"
            title="Clear score filter"
          >
            score ≥ {minFilter.toFixed(1)}
            <X className="size-3" />
          </button>
        </div>
      )}

      {tab === "INBOX" ? (
        /* ── Inbox: the triage surface (Abundance → Triage → Shortlist → Score) ── */
        pendingInbox.length > 0 ? (
          <InboxTriage inbox={pendingInbox} />
        ) : (
          <EmptyState
            className="mt-4"
            variant="terminal"
            title={<>Your <span className="text-brand">inbox</span> is empty.</>}
            description="Find roles that match your CV — free, no tokens spent."
            actions={
              <>
                <Link
                  href="/explore?run=1"
                  className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground shadow-sm transition hover:bg-brand-200 max-sm:min-h-[44px]"
                >
                  Run your first free scan <ArrowRight className="size-4" />
                </Link>
                <p className="mt-4 font-mono text-xs text-faint">
                  Prefer the terminal? <span className="text-foreground/40">$</span> career-ops scan — or drop URLs into data/pipeline.md.
                </p>
              </>
            }
          />
        )
      ) : filtered.length > 0 ? (
        <>
          {/* ── Tracker table (desktop) ── */}
          <div className="mt-4 hidden overflow-hidden rounded-2xl border border-border md:block">
            <table className="w-full text-sm">
              <thead className="bg-surface/60 text-left text-xs uppercase tracking-wide text-faint">
                <tr>
                  {SORT_KEYS.map((k) => (
                    <th
                      key={k}
                      className="cursor-pointer select-none px-4 py-2.5 font-medium hover:text-foreground"
                      onClick={() => setParams({ sort: k, dir: sort.key === k ? sort.dir * -1 : -1 })}
                    >
                      <span className="inline-flex items-center gap-1">
                        {k}
                        <ChevronsUpDown className="size-3" />
                      </span>
                    </th>
                  ))}
                  <th className="px-4 py-2.5 font-medium">notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r, i) => {
                  const company = companyPresentation(r);
                  return (
                  <tr key={`${r.n}-${i}`} className="group transition-colors hover:bg-surface/40">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/pipeline/${r.n}`} className="flex items-center gap-2.5 transition-colors group-hover:text-brand">
                        <CompanyLogo name={company.logoName} size={20} />
                        {company.label}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      <Link href={`/pipeline/${r.n}`}>{r.role}</Link>
                      {r.via && r.via !== "—" && r.via !== "-" && (
                        <span className="ml-1.5 rounded-full bg-surface px-1.5 py-0.5 text-[11px] text-faint">via {r.via}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={scoreTone(r.score)}>{r.score || "—"}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      <StatusCell n={r.n} status={r.status} onSaved={() => router.refresh()} />
                    </td>
                    <td className="px-4 py-3 text-faint tabular-nums">{r.date}</td>
                    <td className="px-4 py-3 text-muted">
                      <NotesCell n={r.n} notes={r.notes} onSaved={() => router.refresh()} />
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Tracker cards (mobile) ── */}
          <div className="mt-4 space-y-2.5 md:hidden">
            {filtered.map((r, i) => {
              const company = companyPresentation(r);
              return (
              <div key={`${r.n}-${i}`} className="rounded-xl border border-border bg-surface/40 p-3.5 transition-colors hover:border-brand/30">
                <div className="flex items-start gap-2.5">
                  <CompanyLogo name={company.logoName} size={24} />
                  <Link href={`/pipeline/${r.n}`} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{company.label}</p>
                    <p className="truncate text-[13px] text-muted">
                      {r.role}
                      {r.via && r.via !== "—" && r.via !== "-" && <span className="ml-1 text-faint">via {r.via}</span>}
                    </p>
                  </Link>
                  <Badge tone={scoreTone(r.score)}>{r.score || "—"}</Badge>
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border pt-2.5">
                  <StatusCell n={r.n} status={r.status} onSaved={() => router.refresh()} />
                  <span className="shrink-0 text-xs tabular-nums text-faint">{r.date}</span>
                </div>
                <div className="mt-1.5 text-xs text-muted">
                  <NotesCell n={r.n} notes={r.notes} onSaved={() => router.refresh()} />
                </div>
              </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-12 text-center">
          <p className="font-display text-lg">No matches</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Try a different tab or clear the search.</p>
        </div>
      )}
    </PageShell>
  );
}

// The active funnel stages (in flow order) + the muted terminal buckets.
const FUNNEL_STAGES = ["EVALUATED", "APPLIED", "RESPONDED", "INTERVIEW", "OFFER"] as const;
const FUNNEL_MUTED = ["REJECTED", "DISCARDED"] as const;

/** Compact horizontal funnel of the status distribution. Buckets via canonStatus
 *  so aliases collapse to canonical tokens. Subtle, on-brand, read-only. */
function Funnel({ applications }: { applications: Application[] }) {
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of applications) {
      const c = canonStatus(a.status);
      const key = [...FUNNEL_STAGES, ...FUNNEL_MUTED].find((k) => c.includes(k));
      if (key) m[key] = (m[key] || 0) + 1;
    }
    return m;
  }, [applications]);

  const activeTotal = FUNNEL_STAGES.reduce((s, k) => s + (counts[k] || 0), 0);
  if (applications.length === 0) return null;

  return (
    <div className="mt-5 rounded-2xl border border-border bg-surface/40 p-3">
      <div className="flex items-stretch gap-1.5">
        {FUNNEL_STAGES.map((k) => {
          const n = counts[k] || 0;
          const pct = activeTotal > 0 ? Math.round((n / activeTotal) * 100) : 0;
          return (
            <div key={k} className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-baseline justify-between gap-1">
                <span className="truncate text-[10px] font-medium uppercase tracking-wide text-faint">{k}</span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">{n}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand to-brand-200"
                  style={{ width: `${Math.max(pct, n > 0 ? 8 : 0)}%` }}
                />
              </div>
            </div>
          );
        })}
        {FUNNEL_MUTED.some((k) => counts[k]) && (
          <div className="flex shrink-0 items-center gap-2 border-l border-border pl-2 text-[10px] text-faint">
            {FUNNEL_MUTED.map((k) =>
              counts[k] ? (
                <span key={k} className="uppercase tracking-wide">
                  {k} <span className="tabular-nums text-muted">{counts[k]}</span>
                </span>
              ) : null,
            )}
          </div>
        )}
      </div>
    </div>
  );
}


/** Inline status editor → POST /api/status {n,status}. */
function StatusCell({ n, status, onSaved }: { n: string; status: string; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const save = async (value: string) => {
    if (value === status) return;
    setBusy(true);
    try {
      await fetch("/api/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ n, status: value }),
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusDot dotClassName={statusDot(status)} />
      <select
        defaultValue={status.trim()}
        onChange={(e) => save(e.target.value)}
        disabled={busy}
        className="cursor-pointer rounded border border-transparent bg-transparent py-0.5 pl-0.5 pr-4 text-muted outline-none transition-colors hover:border-border hover:bg-surface focus:border-brand/50 max-sm:min-h-[44px]"
      >
        {!CANONICAL_STATES.includes(status.trim() as (typeof CANONICAL_STATES)[number]) && (
          <option value={status.trim()}>{status.trim() || "—"}</option>
        )}
        {CANONICAL_STATES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      {busy && <Loader2 className="size-3 animate-spin text-brand" />}
    </span>
  );
}

/** Inline notes editor → POST /api/notes {n,notes}. Click to edit, Enter/blur saves. */
function NotesCell({ n, notes, onSaved }: { n: string; notes: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(notes);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (value !== notes) {
        await fetch("/api/notes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ n, notes: value }),
        });
        onSaved();
      }
    } finally {
      setBusy(false);
      setEditing(false);
    }
  };
  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") { setValue(notes); setEditing(false); }
        }}
        disabled={busy}
        className="w-full min-w-40 rounded border border-brand/40 bg-surface px-2 py-1 text-xs outline-none max-sm:min-h-[44px]"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="line-clamp-2 max-w-xs text-left text-xs text-faint transition-colors hover:text-foreground max-sm:min-h-[44px]"
      title="Click to edit notes"
    >
      {notes?.trim() || <span className="italic opacity-60">add note…</span>}
    </button>
  );
}

