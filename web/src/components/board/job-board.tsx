"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search, RefreshCw, Download, ExternalLink, AlertTriangle,
  Sparkles, SlidersHorizontal, Inbox, Radar, Loader2,
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
  { key: "all", label: "All" },
  { key: "recommended", label: "Recommended" },
  { key: "review", label: "Review" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

export function JobBoard({ initial }: { initial: JobDashboard }) {
  const [data, setData] = useState<JobDashboard>(initial);
  const [q, setQ] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [section, setSection] = useState<SectionKey>("all");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchLog, setSearchLog] = useState<string[]>([]);

  const reScore = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/jobs/cache", { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } finally {
      setBusy(false);
    }
  };

  // Run a real job-search refresh (crawls portals + feeds), streaming progress.
  const runSearch = async () => {
    setSearching(true);
    setSearchLog(["Connecting…"]);
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
            if (ev.type === "log") setSearchLog((l) => [...l, ev.message]);
            else if (ev.type === "error") setSearchLog((l) => [...l, `⚠ ${ev.message}`]);
            else if (ev.type === "done")
              setSearchLog((l) => [...l, `✓ Done — ${ev.stats?.total ?? 0} roles scored.`]);
          } catch {
            /* ignore non-JSON */
          }
        }
      }
      await reScore(); // reload the freshly-written board
    } catch {
      setSearchLog((l) => [...l, "⚠ Search failed (network)."]);
    } finally {
      setSearching(false);
    }
  };

  const jobs = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.jobs
      .filter((j) => j.type !== "searchLead")
      .filter((j) => (section === "all" ? true : j.section === section))
      .filter((j) => Number(j.score) >= minScore)
      .filter((j) =>
        !needle
          ? true
          : `${j.title} ${j.company} ${j.location ?? ""} ${(j.matchedSkills ?? []).join(" ")}`
              .toLowerCase()
              .includes(needle),
      )
      .sort((a, b) => Number(b.score) - Number(a.score));
  }, [data.jobs, q, minScore, section]);

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

      {/* live search progress */}
      {(searching || searchLog.length > 0) && (
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface/60">
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted">
            <Radar className="size-3.5" /> Job search
            {searching && <Loader2 className="size-3 animate-spin text-brand" />}
            {!searching && (
              <button onClick={() => setSearchLog([])} className="ml-auto text-faint hover:text-foreground">
                dismiss
              </button>
            )}
          </div>
          <div className="max-h-40 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/80">
            {searchLog.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </div>
      )}

      {/* stat strip */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        <Stat icon={Inbox} value={data.stats.total} label="scored roles" />
        <Stat icon={Sparkles} value={data.stats.excellent} label="excellent (8+)" featured />
        <Stat icon={SlidersHorizontal} value={data.searchPlan?.queries ?? "—"} label="search queries" />
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
              {s.label}
            </button>
          ))}
        </div>
        <select
          value={minScore}
          onChange={(e) => setMinScore(Number(e.target.value))}
          className="rounded-md border border-border bg-surface px-2.5 py-2 text-xs text-muted outline-none focus:border-brand/50"
        >
          <option value={0}>Any score</option>
          <option value={5}>5+</option>
          <option value={7}>7+ (Strong)</option>
          <option value={9}>9+ (Excellent)</option>
        </select>
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

function JobCard({ job }: { job: ScoredJob }) {
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
