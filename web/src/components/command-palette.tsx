"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search, CornerDownLeft, Radar, HeartPulse, Activity, Terminal, ArrowRight, Copy, Check,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { NAV_ITEMS } from "@/lib/nav-items";
import { COMMAND_CATALOG } from "@/lib/commands";

type Item = {
  id: string;
  title: string;
  hint?: string;
  kind: "nav" | "action" | "command";
  keywords: string;
  run: () => void;
};

/**
 * ⌘K command center — the dashboard's single control surface: navigate anywhere,
 * run real operations (job search, scan, health check), and copy career-ops /
 * interview-coach CLI commands. Mounted globally in the app shell.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("co:command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("co:command-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const runOp = async (op: string, label: string) => {
    setOpen(false);
    flash(`${label}…`);
    try {
      const r = await fetch("/api/ops/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op }),
      });
      const d = await r.json();
      flash(d.ok ? `${label}: done (exit ${d.code})` : `${label} failed`);
    } catch {
      flash(`${label} failed`);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1500);
  };

  const items = useMemo<Item[]>(() => {
    const nav: Item[] = NAV_ITEMS.map((n) => ({
      id: `nav:${n.href}`,
      title: n.label,
      hint: "Go to",
      kind: "nav",
      keywords: `${n.label} ${n.href}`,
      run: () => {
        setOpen(false);
        router.push(n.href);
      },
    }));
    const actions: Item[] = [
      { id: "act:search", title: "Run job search", hint: "Crawl portals + feeds", kw: "search refresh scan jobs board crawl", run: () => { setOpen(false); router.push("/board"); flash("Open the board and hit Run search"); } },
      { id: "act:scan", title: "Portal scan", hint: "Zero-token scan", kw: "scan portals ops discover", run: () => runOp("scan", "Portal scan") },
      { id: "act:health", title: "Pipeline health check", hint: "Verify pending URLs", kw: "health verify pipeline ops", run: () => runOp("pipeline-health", "Pipeline health") },
      { id: "act:liveness", title: "Liveness check", hint: "Re-check known URLs", kw: "liveness alive ops", run: () => runOp("liveness", "Liveness") },
    ].map((a) => ({ id: a.id, title: a.title, hint: a.hint, kind: "action" as const, keywords: a.kw, run: a.run }));
    const commands: Item[] = COMMAND_CATALOG.flatMap((g) =>
      g.commands.map((c) => ({
        id: `cmd:${c.cmd}`,
        title: c.cmd,
        hint: `${g.group} · ${c.label}`,
        kind: "command" as const,
        keywords: `${c.cmd} ${c.label} ${c.desc} ${g.group}`,
        run: () => copy(c.cmd),
      })),
    );
    return [...nav, ...actions, ...commands];
  }, [router]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return items;
    return items.filter((it) => it.keywords.toLowerCase().includes(n));
  }, [items, q]);

  useEffect(() => setActive(0), [q]);

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); filtered[active]?.run(); }
  };

  return (
    <>
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow-lg">
          {toast}
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="size-4 text-faint" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onListKey}
                placeholder="Search actions, pages, commands…"
                className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-faint"
              />
              <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-faint">esc</kbd>
            </div>
            <div className="max-h-80 overflow-auto py-1.5">
              {filtered.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No matches.</p>}
              {filtered.map((it, i) => (
                <button
                  key={it.id}
                  onMouseEnter={() => setActive(i)}
                  onClick={it.run}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2 text-left",
                    i === active ? "bg-brand-soft" : "hover:bg-surface-hover",
                  )}
                >
                  <KindIcon kind={it.kind} title={it.title} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm", it.kind === "command" && "font-mono text-[13px]")}>{it.title}</span>
                    {it.hint && <span className="block truncate text-xs text-faint">{it.hint}</span>}
                  </span>
                  {it.kind === "command" ? (
                    copied === it.title ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5 text-faint" />
                  ) : i === active ? (
                    <CornerDownLeft className="size-3.5 text-brand" />
                  ) : null}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-faint">
              <span className="flex items-center gap-1"><ArrowRight className="size-3 rotate-90" /> navigate</span>
              <span className="flex items-center gap-1"><CornerDownLeft className="size-3" /> run</span>
              <span className="ml-auto">⌘K to toggle</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function KindIcon({ kind, title }: { kind: Item["kind"]; title: string }) {
  if (kind === "command") return <Terminal className="size-4 shrink-0 text-faint" />;
  if (kind === "action") {
    const I = title.includes("search") ? Radar : title.includes("health") ? HeartPulse : Activity;
    return <I className="size-4 shrink-0 text-brand" />;
  }
  return <ArrowRight className="size-4 shrink-0 text-faint" />;
}
