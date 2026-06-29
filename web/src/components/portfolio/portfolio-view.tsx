"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, Download, RotateCcw, Trash2, Loader2, Wand2, Settings, FileText } from "lucide-react";
import { cn } from "@/lib/cn";
import { PreviewFrame } from "./preview-frame";

type Phase = "empty" | "generating" | "preview" | "error";

export function PortfolioView({
  hasCv,
  initialHtml,
  initialExists,
}: {
  hasCv: boolean;
  initialHtml: string;
  initialExists: boolean;
}) {
  const [phase, setPhase] = useState<Phase>(initialExists ? "preview" : "empty");
  const [html, setHtml] = useState(initialHtml);
  // `data` is the structured PortfolioData; we keep it opaque and pass it back as
  // the revision base. Shape is owned by lib/portfolio/schema.ts.
  const [data, setData] = useState<unknown>(null);
  const [trace, setTrace] = useState("");
  const [error, setError] = useState("");
  const [instruction, setInstruction] = useState("");
  const [cliId, setCliId] = useState<string | null>(null);
  const busy = phase === "generating";

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cli")
      .then((r) => r.json())
      .then((c) => { if (!cancelled) setCliId(c.selected ?? null); })
      .catch(() => {});
    // Hydrate the structured data for an existing draft so refine has a base.
    if (initialExists) {
      fetch("/api/portfolio")
        .then((r) => r.json())
        .then((d) => { if (!cancelled) setData(d.data ?? null); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [initialExists]);

  async function run(body: Record<string, unknown>) {
    if (!cliId) return;
    setPhase("generating");
    setTrace("Starting…");
    setError("");
    try {
      const res = await fetch("/api/portfolio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliId, ...body }),
      });
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

  async function discard() {
    await fetch("/api/portfolio", { method: "DELETE" }).catch(() => {});
    setHtml("");
    setData(null);
    setPhase("empty");
  }

  // ── No CV yet ──
  if (!hasCv) {
    return (
      <Shell>
        <Empty
          icon={FileText}
          title="Add your CV first"
          body="Your portfolio site is generated from your CV. Add it, then come back here."
          cta={<Link href="/cv" className="btn-primary"><FileText className="size-4" /> Go to CV</Link>}
        />
      </Shell>
    );
  }

  // ── No CLI configured ──
  if (cliId === null) {
    return (
      <Shell>
        <Empty
          icon={Settings}
          title="Connect an AI CLI"
          body="The portfolio is generated locally by your own AI CLI. Pick one in Config."
          cta={<Link href="/config" className="btn-primary"><Settings className="size-4" /> Open Config</Link>}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      {phase === "empty" && (
        <Empty
          icon={Sparkles}
          title="Generate your portfolio site"
          body="Your AI reads your CV and builds a personal portfolio website — preview it, refine it by chat, and export a deployable ZIP."
          cta={
            <button type="button" onClick={() => run({})} className="btn-primary">
              <Sparkles className="size-4" /> Generate portfolio
            </button>
          }
        />
      )}

      {phase === "generating" && (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <Loader2 className="size-6 animate-spin text-brand" />
          <p className="text-sm text-muted">{trace}</p>
          <p className="text-xs text-faint">Running on your own AI — your data stays local.</p>
        </div>
      )}

      {phase === "error" && (
        <Empty
          icon={Sparkles}
          title="That didn't work"
          body={error || "Something went wrong."}
          cta={<button type="button" onClick={() => run({})} className="btn-primary"><RotateCcw className="size-4" /> Try again</button>}
        />
      )}

      {phase === "preview" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <a href="/api/portfolio/export" className="btn-primary"><Download className="size-4" /> Export ZIP</a>
            <button type="button" onClick={() => run({})} className="btn-ghost"><RotateCcw className="size-4" /> Regenerate</button>
            <button type="button" onClick={discard} className="btn-ghost text-red-400"><Trash2 className="size-4" /> Discard</button>
          </div>

          <RefineBar
            value={instruction}
            onChange={setInstruction}
            onSubmit={() => instruction.trim() && run({ instruction: instruction.trim(), base: data })}
            disabled={busy || !data}
          />

          <PreviewFrame html={html} />
        </div>
      )}
    </Shell>
  );
}

function RefineBar({ value, onChange, onSubmit, disabled }: { value: string; onChange: (v: string) => void; onSubmit: () => void; disabled: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-surface/50 p-2">
      <Wand2 className="ml-1 size-4 shrink-0 text-brand" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !disabled) onSubmit(); }}
        placeholder="Refine it — e.g. 'lead with the crash-reduction win', 'punchier tagline', 'add a projects section'…"
        aria-label="Refine the portfolio"
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
      />
      <button type="button" onClick={onSubmit} disabled={disabled} className="btn-primary !py-1.5 disabled:opacity-50">
        Apply
      </button>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <style>{`.btn-primary{display:inline-flex;align-items:center;gap:8px;border-radius:999px;background:var(--brand,#e8762a);color:#fff;padding:9px 16px;font-size:14px;font-weight:600}.btn-ghost{display:inline-flex;align-items:center;gap:8px;border-radius:999px;border:1px solid var(--border,#262626);padding:9px 16px;font-size:14px;font-weight:500;color:inherit}`}</style>
      <h1 className="font-display text-2xl tracking-tight">Portfolio</h1>
      <p className="mb-6 mt-1 text-sm text-muted">An AI-generated personal site from your CV — preview, refine, and export to deploy.</p>
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
