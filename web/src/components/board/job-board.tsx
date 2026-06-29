"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search, RefreshCw, Download, ExternalLink, AlertTriangle,
  Sparkles, SlidersHorizontal, Inbox, Radar, Loader2, Check, Circle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import type { ScoredJob } from "@/lib/jobs/types";
import type { JobDashboard } from "@/lib/jobs/scoring";

type Tone = "good" | "warn" | "bad" | "muted";

function levelTone(job: ScoredJob): Tone {
  if (job.gates && job.gates.length > 0) return "bad";
  if (job.level === "Excellent" || job.level === "Strong") return "good";
  if (job.level === "Possible") return "warn";
  return "muted";
}

const SECTIONS = [
  { key: "recommended", label: "Recommended" },
  { key: "review", label: "Review" },
  { key: "sources", label: "Sources" },
  { key: "all", label: "All" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

const SCORE_TABS = [
  { min: 0, label: "All" },
  { min: 5, label: "Good+" },
  { min: 7, label: "Strong+" },
  { min: 9, label: "Excellent" },
] as const;

export function JobBoard({
  initial,
  rejectedCompanies = [],
}: {
  initial: JobDashboard;
  rejectedCompanies?: string[];
}) {
  const [data, setData] = useState<JobDashboard>(initial);
  const [q, setQ] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [section, setSection] = useState<SectionKey>("recommended");
  const [hideRejected, setHideRejected] = useState(true);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchLog, setSearchLog] = useState<string[]>([]);
  const [searchPhase, setSearchPhase] = useState(0);
  const [searchElapsed, setSearchElapsed] = useState(0);
  const rejectedSet = useMemo(() => new Set(rejectedCompanies.map((c) => c.toLowerCase())), [rejectedCompanies]);

  const reScore = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/jobs/cache", { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } finally {
      setBusy(false);
    }
  };

  // Run a real job-search refresh (crawls portals + feeds), streaming staged
  // progress (phase / tick / log / done events from job-search-cli.mjs).
  const runSearch = async () => {
    setSearching(true);
    setSearchLog([]);
    setSearchPhase(1);
    setSearchElapsed(0);
    let failed = false;
    try {
      const res = await fetch("/api/jobs/refresh", { method: "POST" });
      const reader = res.body?.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === "phase") setSearchPhase((p) => Math.max(p, ev.phase)); // monotonic — never regress
            else if (ev.type === "tick") setSearchElapsed(ev.elapsed);
            else if (ev.type === "log") setSearchLog((l) => [...l, ev.message]);
            else if (ev.type === "error") { failed = true; setSearchLog((l) => [...l, `⚠ ${ev.message}`]); }
            else if (ev.type === "done") {
              setSearchPhase(5); // all complete
              setSearchLog((l) => [...l, `✓ Done — ${ev.stats?.total ?? 0} roles scored.`]);
            }
          } catch {
            /* ignore non-JSON */
          }
        }
      }
      if (!failed) await reScore(); // reload the freshly-written board
    } catch {
      failed = true;
      setSearchLog((l) => [...l, "⚠ Search failed (network)."]);
    } finally {
      setSearching(false);
      if (failed) setSearchPhase(0);
    }
  };

  const isSources = section === "sources";

  const jobs = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = data.jobs.filter((j) => (isSources ? j.type === "searchLead" : j.type !== "searchLead"));
    return base
      .filter((j) => (section === "all" || isSources ? true : j.section === section))
      .filter((j) => (isSources ? true : Number(j.score) >= minScore))
      .filter((j) => (isSources || !hideRejected ? true : !rejectedSet.has((j.company ?? "").toLowerCase().trim())))
      .filter((j) =>
        !needle
          ? true
          : `${j.title} ${j.company} ${j.location ?? ""} ${(j.matchedSkills ?? []).join(" ")}`
              .toLowerCase()
              .includes(needle),
      )
      .sort((a, b) => (isSources ? String(a.title).localeCompare(String(b.title)) : Number(b.score) - Number(a.score)));
  }, [data.jobs, q, minScore, section, isSources, hideRejected, rejectedSet]);

  // Score distribution (real jobs) for the doughnut.
  const dist = useMemo(() => {
    const real = data.jobs.filter((j) => j.type !== "searchLead");
    const b = { excellent: 0, strong: 0, possible: 0, low: 0 };
    for (const j of real) {
      const s = Number(j.score);
      if (s >= 9) b.excellent++;
      else if (s >= 7) b.strong++;
      else if (s >= 5) b.possible++;
      else b.low++;
    }
    return b;
  }, [data.jobs]);

  const sectionCount = (key: SectionKey) => {
    if (key === "sources") return data.jobs.filter((j) => j.type === "searchLead").length;
    const real = data.jobs.filter((j) => j.type !== "searchLead");
    return key === "all" ? real.length : real.filter((j) => j.section === key).length;
  };

  const cfgInvalid = !data.searchConfig.valid;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-landing">Job board</h1>
          <p className="mt-1 text-sm text-muted">
            {data.diagnostics.note}
            {data.generatedAt && (
              <span className="text-faint"> · fed {new Date(data.generatedAt).toLocaleDateString()}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runSearch}
            disabled={searching}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50"
          >
            {searching ? <Loader2 className="size-3.5 animate-spin" /> : <Radar className="size-3.5" />} Run search
          </button>
          <button
            onClick={reScore}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> Re-score
          </button>
          <a
            href="/api/jobs/export"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <Download className="size-3.5" /> Export CSV
          </a>
        </div>
      </div>

      {/* live staged search progress */}
      {(searching || searchLog.length > 0) && (
        <RefreshProgress
          phase={searchPhase}
          elapsed={searchElapsed}
          searching={searching}
          log={searchLog}
          onDismiss={() => { setSearchLog([]); setSearchPhase(0); }}
        />
      )}

      {/* stat strip + score distribution */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={Inbox} value={data.stats.total} label="scored roles" />
        <Stat icon={Sparkles} value={data.stats.excellent} label="excellent (8+)" featured />
        <Stat icon={SlidersHorizontal} value={data.searchPlan?.queries ?? "—"} label="search queries" />
        <ScoreDonut dist={dist} />
      </div>

      {/* invalid-config banner */}
      {cfgInvalid && (
        <div className="mt-5 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <div>
            <p className="font-medium text-foreground">Job-search config needs review</p>
            <ul className="mt-1 list-disc pl-4 text-muted">
              {data.searchConfig.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            <Link href="/onboarding" className="mt-1 inline-block text-brand hover:underline">
              Finish onboarding →
            </Link>
          </div>
        </div>
      )}

      {/* toolbar */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by role, company, skill…"
            className="w-full rounded-md border border-border bg-surface py-2 pl-8 pr-3 text-sm outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <div className="flex overflow-hidden rounded-md border border-border">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={cn(
                "px-3 py-2 text-xs transition-colors",
                section === s.key ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-hover",
              )}
            >
              {s.label} <span className="tabular-nums opacity-60">{sectionCount(s.key)}</span>
            </button>
          ))}
        </div>
        {!isSources && (
          <>
            <div className="flex overflow-hidden rounded-md border border-border">
              {SCORE_TABS.map((t) => (
                <button
                  key={t.min}
                  onClick={() => setMinScore(t.min)}
                  className={cn(
                    "px-2.5 py-2 text-xs transition-colors",
                    minScore === t.min ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-hover",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {rejectedCompanies.length > 0 && (
              <button
                onClick={() => setHideRejected((v) => !v)}
                title="Hide roles from companies that already rejected you"
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2.5 py-2 text-xs transition-colors",
                  hideRejected ? "border-red-500/40 bg-red-500/10 text-red-500" : "border-border text-muted hover:bg-surface-hover",
                )}
              >
                ⛔ Rejected {hideRejected ? "off" : "on"}
              </button>
            )}
          </>
        )}
      </div>

      {/* list */}
      {jobs.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-12 text-center text-sm text-muted">
          {data.jobs.length === 0
            ? "No cached job feed yet. Run a scan from the CLI, or finish onboarding to drive scoring."
            : "No roles match these filters."}
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {jobs.map((j) => (
            <JobCard key={String(j.id ?? j.url ?? j.title)} job={j} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  value,
  label,
  featured,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number | string;
  label: string;
  featured?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface/50 p-4">
      <Icon className="size-4 text-brand" />
      <div className={cn("mt-2 text-2xl leading-none tabular-nums", featured ? "font-semibold text-brand" : "font-semibold")}>
        {value}
      </div>
      <div className="mt-1 text-xs text-faint">{label}</div>
    </div>
  );
}

const REFRESH_STAGES = [
  "Scan company boards",
  "ATS discovery",
  "Fetch job feeds",
  "Score & save",
] as const;

function RefreshProgress({
  phase, elapsed, searching, log, onDismiss,
}: {
  phase: number; elapsed: number; searching: boolean; log: string[]; onDismiss: () => void;
}) {
  const done = phase >= 5;
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface/60">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        {done ? <Check className="size-4 text-emerald-500" /> : <Radar className="size-4 animate-pulse text-brand" />}
        <span className="text-sm font-medium">{done ? "Search complete" : "Scanning for new jobs…"}</span>
        <span className="ml-auto text-xs tabular-nums text-faint">{elapsed}s</span>
        {!searching && (
          <button onClick={onDismiss} className="text-faint transition-colors hover:text-foreground" aria-label="Dismiss">
            <Circle className="hidden" />✕
          </button>
        )}
      </div>

      {/* 4-stage stepper */}
      <ol className="flex flex-col gap-0 px-4 py-3 sm:flex-row sm:items-center sm:gap-1">
        {REFRESH_STAGES.map((label, i) => {
          const n = i + 1;
          const state = done || phase > n ? "done" : phase === n ? "active" : "pending";
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full text-[10px]",
                  state === "done" ? "bg-emerald-500/20 text-emerald-500"
                    : state === "active" ? "bg-brand-soft text-brand"
                    : "bg-surface-hover text-faint",
                )}
              >
                {state === "done" ? <Check className="size-3" /> : state === "active" ? <Loader2 className="size-3 animate-spin" /> : n}
              </span>
              <span className={cn("text-xs", state === "pending" ? "text-faint" : "text-foreground")}>{label}</span>
              {i < REFRESH_STAGES.length - 1 && <span className="mx-1 hidden h-px flex-1 bg-border sm:block" />}
            </li>
          );
        })}
      </ol>

      {log.length > 0 && (
        <div className="max-h-32 overflow-auto border-t border-border px-4 py-2 font-mono text-[11px] leading-relaxed text-foreground/70">
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

const DONUT = [
  { key: "excellent", label: "Excellent", color: "var(--color-brand)" },
  { key: "strong", label: "Strong", color: "#10b981" },
  { key: "possible", label: "Possible", color: "#f59e0b" },
  { key: "low", label: "Low", color: "#a1a1aa" },
] as const;

function ScoreDonut({ dist }: { dist: { excellent: number; strong: number; possible: number; low: number } }) {
  const total = dist.excellent + dist.strong + dist.possible + dist.low;
  let acc = 0;
  const stops = DONUT.map((d) => {
    const v = dist[d.key];
    const from = total ? (acc / total) * 360 : 0;
    acc += v;
    const to = total ? (acc / total) * 360 : 0;
    return `${d.color} ${from}deg ${to}deg`;
  }).join(", ");
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface/50 p-4">
      <div
        className="relative size-14 shrink-0 rounded-full"
        style={{ background: total ? `conic-gradient(${stops})` : "var(--color-surface-hover)" }}
      >
        <div className="absolute inset-[22%] grid place-items-center rounded-full bg-surface text-xs font-semibold tabular-nums">
          {total}
        </div>
      </div>
      <ul className="space-y-0.5 text-[11px]">
        {DONUT.map((d) => (
          <li key={d.key} className="flex items-center gap-1.5 text-faint">
            <span className="size-2 rounded-sm" style={{ background: d.color }} />
            {d.label} <span className="tabular-nums text-foreground">{dist[d.key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function JobCard({ job }: { job: ScoredJob }) {
  // Source leads (search queries) have no score — render a compact card.
  if (job.type === "searchLead") {
    return (
      <li className="flex items-center gap-3 rounded-xl border border-border bg-surface/40 px-4 py-2.5">
        <Radar className="size-4 shrink-0 text-faint" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{job.title || job.company}</span>
          {job.source && <span className="block truncate text-xs text-faint">{String(job.source)}</span>}
        </span>
        {job.url && (
          <a href={job.url} target="_blank" rel="noreferrer" className="text-faint hover:text-brand">
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </li>
    );
  }
  const tone = levelTone(job);
  const skills = [...(job.matchedSkills ?? []), ...(job.supportingSkills ?? [])].slice(0, 8);
  const gated = (job.gates?.length ?? 0) > 0;
  return (
    <li className="relative overflow-hidden rounded-2xl border border-border bg-surface/50 p-4 transition-colors hover:border-brand/30">
      <div className="flex items-start gap-3">
        <div className="flex w-12 shrink-0 flex-col items-center">
          <Badge tone={tone} className="text-base">
            {job.score}
          </Badge>
          <span className="mt-1 text-[10px] uppercase tracking-wide text-faint">{job.level}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-foreground">{job.title}</h3>
            {job.url && (
              <a
                href={job.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-faint transition-colors hover:text-brand"
                aria-label="Open posting"
              >
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
          <p className="truncate text-sm text-muted">
            {job.company}
            {job.location ? ` · ${job.location}` : ""}
          </p>

          <p className="mt-1.5 text-xs text-brand">{job.priority}</p>

          {skills.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {skills.map((s) => (
                <span
                  key={s}
                  className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[11px] text-muted"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          {gated && (
            <p className="mt-2 flex items-center gap-1 text-xs text-red-500">
              <AlertTriangle className="size-3.5" /> {job.gates!.join("; ")}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
