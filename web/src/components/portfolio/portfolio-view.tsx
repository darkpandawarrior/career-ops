"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, Download, RotateCcw, Trash2, Loader2, Wand2, Settings, FileText, History, Star, ClipboardCheck, ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { PreviewFrame } from "./preview-frame";

type Phase = "empty" | "generating" | "preview" | "error";
type Version = { stamp: string; isFinal: boolean };
type Suggestion = { title: string; why?: string; action: string };
type Analysis = { score?: number; strengths: string[]; gaps: string[]; suggestions: Suggestion[] };

const fmtStamp = (s: string) => s.replace(/T/, " ").replace(/-/g, (m, i) => (i < 10 ? "-" : ":")).replace(/Z$/, "").slice(0, 16);

export function PortfolioView({ hasCv, initialHtml, initialExists }: { hasCv: boolean; initialHtml: string; initialExists: boolean }) {
  const [phase, setPhase] = useState<Phase>(initialExists ? "preview" : "empty");
  const [html, setHtml] = useState(initialHtml);
  const [data, setData] = useState<unknown>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [final, setFinal] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [trace, setTrace] = useState("");
  const [error, setError] = useState("");
  const [instruction, setInstruction] = useState("");
  const [cliId, setCliId] = useState<string | null>(null);
  const busy = phase === "generating";

  const loadState = useCallback(async () => {
    try {
      const d = await (await fetch("/api/portfolio")).json();
      setData(d.data ?? null);
      setVersions(d.versions ?? []);
      setFinal(d.final ?? null);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cli").then((r) => r.json()).then((c) => { if (!cancelled) setCliId(c.selected ?? null); }).catch(() => {});
    if (initialExists) loadState();
    return () => { cancelled = true; };
  }, [initialExists, loadState]);

  async function run(body: Record<string, unknown>) {
    if (!cliId) return;
    setPhase("generating");
    setTrace("Starting…");
    setError("");
    setAnalysis(null);
    try {
      const res = await fetch("/api/portfolio/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cliId, ...body }) });
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({}));
        setError(e.error || "Generation failed.");
        setPhase("error");
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let evt: { kind?: string; label?: string; html?: string; data?: unknown; error?: string };
          try { evt = JSON.parse(line); } catch { continue; }
          if (evt.kind === "status" && evt.label) setTrace(evt.label);
          else if (evt.kind === "done" && evt.html) {
            setHtml(evt.html);
            setData(evt.data ?? null);
            setInstruction("");
            setPhase("preview");
            void loadState();
          } else if (evt.kind === "error") {
            setError(evt.error || "Generation failed.");
            setPhase("error");
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setPhase("error");
    }
  }

  async function analyze() {
    if (!cliId || analyzing) return;
    setAnalyzing(true);
    setError("");
    try {
      const r = await fetch("/api/portfolio/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cliId }) });
      const d = await r.json();
      if (d.analysis) setAnalysis(d.analysis);
      else setError(d.error || "Analysis failed.");
    } catch { setError("Analysis failed."); } finally { setAnalyzing(false); }
  }

  async function restore(stamp: string) {
    const r = await fetch("/api/portfolio/version", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", stamp }) }).then((x) => x.json()).catch(() => null);
    if (r?.html) { setHtml(r.html); setData(r.data); void loadState(); }
  }
  async function finalize(stamp: string) {
    const next = final === stamp ? "" : stamp;
    await fetch("/api/portfolio/version", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "finalize", stamp: next }) }).catch(() => {});
    setFinal(next || null);
    void loadState();
  }
  async function discard() {
    await fetch("/api/portfolio", { method: "DELETE" }).catch(() => {});
    setHtml(""); setData(null); setVersions([]); setFinal(null); setAnalysis(null); setPhase("empty");
  }

  if (!hasCv) return <Shell><Empty icon={FileText} title="Add your CV first" body="Your portfolio site is generated from your CV. Add it, then come back." cta={<Link href="/cv" className="btn-primary"><FileText className="size-4" /> Go to CV</Link>} /></Shell>;
  if (cliId === null) return <Shell><Empty icon={Settings} title="Connect an AI CLI" body="The portfolio is generated locally by your own AI CLI. Pick one in Config." cta={<Link href="/config" className="btn-primary"><Settings className="size-4" /> Open Config</Link>} /></Shell>;

  return (
    <Shell>
      {phase === "empty" && (
        <Empty icon={Sparkles} title="Generate your portfolio site" body="Your AI reads your CV (and your interview storybank, reports & profile) and builds a deep personal portfolio — preview, refine by chat, version it, and export a deployable ZIP."
          cta={<button type="button" onClick={() => run({})} className="btn-primary"><Sparkles className="size-4" /> Generate portfolio</button>} />
      )}

      {phase === "generating" && (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <Loader2 className="size-6 animate-spin text-brand" />
          <p className="text-sm text-muted">{trace}</p>
          <p className="text-xs text-faint">Running on your own AI — your data stays local.</p>
        </div>
      )}

      {phase === "error" && (
        <Empty icon={Sparkles} title="That didn't work" body={error || "Something went wrong."} cta={<button type="button" onClick={() => run({})} className="btn-primary"><RotateCcw className="size-4" /> Try again</button>} />
      )}

      {phase === "preview" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <a href="/api/portfolio/export" className="btn-primary"><Download className="size-4" /> Export ZIP</a>
            <button type="button" onClick={analyze} disabled={analyzing} className="btn-ghost disabled:opacity-50">{analyzing ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />} Analyze</button>
            <button type="button" onClick={() => setShowVersions((v) => !v)} className="btn-ghost"><History className="size-4" /> Versions{versions.length ? ` (${versions.length})` : ""}</button>
            <button type="button" onClick={() => run({})} className="btn-ghost"><RotateCcw className="size-4" /> Regenerate</button>
            <button type="button" onClick={discard} className="btn-ghost text-red-400"><Trash2 className="size-4" /> Discard</button>
          </div>

          {showVersions && versions.length > 0 && (
            <div className="rounded-xl border border-border bg-surface/40 p-3">
              <p className="mb-2 px-1 text-xs uppercase tracking-wide text-faint">Version history — restore any, or mark one as your production version (you keep iterating).</p>
              <ul className="divide-y divide-border">
                {versions.map((v) => (
                  <li key={v.stamp} className="flex items-center gap-2 py-2 text-sm">
                    <span className="font-mono text-xs text-muted">{fmtStamp(v.stamp)}</span>
                    {v.isFinal && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold uppercase text-brand">Production</span>}
                    <div className="ml-auto flex items-center gap-1">
                      <button type="button" onClick={() => restore(v.stamp)} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-hover hover:text-foreground">Restore</button>
                      <button type="button" onClick={() => finalize(v.stamp)} aria-label={v.isFinal ? "Unmark production" : "Mark as production"} className={cn("rounded-md p-1.5", v.isFinal ? "text-brand" : "text-faint hover:text-foreground")}><Star className={cn("size-4", v.isFinal && "fill-current")} /></button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis && (
            <div className="rounded-xl border border-border bg-surface/40 p-4">
              <div className="mb-2 flex items-center gap-2">
                <ClipboardCheck className="size-4 text-brand" />
                <span className="text-sm font-semibold">Analysis</span>
                {typeof analysis.score === "number" && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">{analysis.score}/100</span>}
              </div>
              {analysis.strengths.length > 0 && <Bullets label="Strengths" items={analysis.strengths} tone="text-emerald-400" />}
              {analysis.gaps.length > 0 && <Bullets label="Gaps" items={analysis.gaps} tone="text-amber-400" />}
              {analysis.suggestions.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1.5 text-xs uppercase tracking-wide text-faint">Suggestions — click to apply</p>
                  <div className="flex flex-col gap-1.5">
                    {analysis.suggestions.map((s, i) => (
                      <button key={i} type="button" disabled={busy || !data} onClick={() => run({ instruction: s.action, base: data })}
                        className="group flex items-start gap-2 rounded-lg border border-border bg-surface/50 p-2.5 text-left text-sm hover:border-brand/40 disabled:opacity-50">
                        <Wand2 className="mt-0.5 size-3.5 shrink-0 text-brand" />
                        <span className="flex-1"><span className="font-medium">{s.title}</span>{s.why ? <span className="text-muted"> — {s.why}</span> : ""}</span>
                        <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-faint group-hover:text-brand" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <RefineBar value={instruction} onChange={setInstruction} onSubmit={() => instruction.trim() && run({ instruction: instruction.trim(), base: data })} disabled={busy || !data} />
          <PreviewFrame html={html} />
        </div>
      )}
    </Shell>
  );
}

function Bullets({ label, items, tone }: { label: string; items: string[]; tone: string }) {
  return (
    <div className="mt-2">
      <p className="text-xs uppercase tracking-wide text-faint">{label}</p>
      <ul className="mt-1 space-y-1">
        {items.map((t, i) => <li key={i} className={cn("text-sm", "text-muted")}><span className={cn("mr-1.5", tone)}>•</span>{t}</li>)}
      </ul>
    </div>
  );
}

function RefineBar({ value, onChange, onSubmit, disabled }: { value: string; onChange: (v: string) => void; onSubmit: () => void; disabled: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-surface/50 p-2">
      <Wand2 className="ml-1 size-4 shrink-0 text-brand" />
      <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !disabled) onSubmit(); }}
        placeholder="Refine it — e.g. 'lead with the crash-reduction win', 'punchier tagline', 'add a projects section'…"
        aria-label="Refine the portfolio" className="flex-1 bg-transparent text-sm outline-none placeholder:text-faint" />
      <button type="button" onClick={onSubmit} disabled={disabled} className="btn-primary !py-1.5 disabled:opacity-50">Apply</button>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <style>{`.btn-primary{display:inline-flex;align-items:center;gap:8px;border-radius:999px;background:var(--brand,#e8762a);color:#fff;padding:9px 16px;font-size:14px;font-weight:600}.btn-ghost{display:inline-flex;align-items:center;gap:8px;border-radius:999px;border:1px solid var(--border,#262626);padding:9px 16px;font-size:14px;font-weight:500;color:inherit}`}</style>
      <h1 className="font-display text-2xl tracking-tight">Portfolio</h1>
      <p className="mb-6 mt-1 text-sm text-muted">An AI-generated personal site from your CV — preview, refine, analyze, version, and export to deploy.</p>
      {children}
    </div>
  );
}

function Empty({ icon: Icon, title, body, cta }: { icon: React.ComponentType<{ className?: string }>; title: string; body: string; cta: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface/30 py-20 text-center">
      <Icon className={cn("size-7 text-brand")} />
      <h2 className="font-display text-xl">{title}</h2>
      <p className="max-w-md text-sm text-muted">{body}</p>
      <div className="mt-2">{cta}</div>
    </div>
  );
}
