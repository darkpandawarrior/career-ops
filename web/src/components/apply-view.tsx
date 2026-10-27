"use client";

import { Loader2, Wand2, Asterisk, Paperclip, Sparkles, ArrowUpRight, ShieldCheck, RotateCcw, FileCheck2, AlertTriangle, Terminal, Check, ScanLine, PenLine, CheckCircle2, Info, ExternalLink, MousePointerClick, User, Mail, Phone, Globe, MapPin, Building2, Clock, CalendarDays, DollarSign, GraduationCap, FileText, Link2, Code2, MessageSquareText, ListChecks, Bookmark, X, Send, SkipForward, HelpCircle, ArrowLeft, ClipboardCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ApplyIssue, DriveStep } from "@/lib/apply/issue";
import { useApply } from "@/components/apply/apply-provider";
import { needsLeaveConfirmation, resolveReturnPath } from "@/lib/apply/exit.mjs";
import { isResumeLabel } from "@/lib/apply/resume-label.mjs";
import type { ApplyField } from "@/lib/apply/extract";
import { isRememberable } from "@/lib/apply/remember";
import { cn } from "@/lib/cn";
import { Fragment, useEffect, useId, useRef, useState } from "react";

// Co-located UI animations (HMR-proof vs Tailwind v4's stale globals.css):
// field cascade-in, per-field "just drafted" flash, skeleton shimmer, hero orb.
const STYLE = `
@keyframes co-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.co-rise{animation:co-rise .55s cubic-bezier(.22,1,.36,1) both}
@keyframes co-flash{0%{box-shadow:0 0 0 0 hsl(26 82% 55% / 0)}22%{box-shadow:0 0 0 3px hsl(26 82% 55% / .38)}100%{box-shadow:0 0 0 0 hsl(26 82% 55% / 0)}}
.co-flash{animation:co-flash 1.15s ease both;border-radius:.6rem}
@keyframes co-shim{0%{background-position:-200% 0}100%{background-position:200% 0}}
.co-skel{background:linear-gradient(90deg, color-mix(in srgb,var(--fg) 5%, transparent) 25%, color-mix(in srgb,var(--fg) 12%, transparent) 37%, color-mix(in srgb,var(--fg) 5%, transparent) 63%);background-size:200% 100%;animation:co-shim 1.6s linear infinite;border-radius:.5rem}
.co-skel-brand{background-image:linear-gradient(90deg, hsl(26 73% 51% / .10) 25%, hsl(26 73% 51% / .30) 37%, hsl(26 73% 51% / .10) 63%)}
@keyframes co-orb{0%,100%{transform:scale(1);opacity:.55}50%{transform:scale(1.35);opacity:.9}}
.co-orb{animation:co-orb 2.4s ease-in-out infinite}
@keyframes co-spin{to{transform:rotate(360deg)}}
.co-ring{animation:co-spin 3s linear infinite}
@keyframes co-sweep{0%{transform:translateY(-130%)}100%{transform:translateY(130%)}}
.co-scan{overflow:hidden}
.co-scan::before{content:"";position:absolute;left:0;right:0;top:0;height:42%;z-index:1;pointer-events:none;background:linear-gradient(to bottom, transparent, hsl(26 73% 51% / .12) 65%, hsl(26 73% 51% / .5) 100%);animation:co-sweep 2.4s ease-in-out infinite;will-change:transform}
.co-dots{background-image:radial-gradient(hsl(26 73% 51% / .22) 1px, transparent 1.4px);background-size:13px 13px}
@keyframes co-indet{0%{left:-42%}100%{left:100%}}
.co-indet{position:relative;overflow:hidden}
.co-indet::after{content:"";position:absolute;top:0;bottom:0;left:-42%;width:42%;border-radius:inherit;background:hsl(26 73% 51% / .7);animation:co-indet 1.3s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.co-rise,.co-flash,.co-skel,.co-orb,.co-ring,.co-scan::before,.co-indet::after{animation:none}}
`;

// The form-proxy UI: the real employer form is opened headlessly on the user's
// machine and re-rendered here in plain language, pre-filled from their CV. The
// user verifies every answer, then we fill the real form behind the scenes and
// bring it to the front for them to submit. We never submit.
export function ApplyView() {
  const a = useApply();
  const [input, setInput] = useState("");
  const ctaRef = useRef<HTMLDivElement>(null);
  const prevStatus = useRef(a.status);
  const [justDrafted, setJustDrafted] = useState(false);
  const [shot, setShot] = useState<number | null>(null); // lightbox: review a fill screenshot full-size
  const [markingApplied, setMarkingApplied] = useState(false);
  const [markedApplied, setMarkedApplied] = useState(false);

  useEffect(() => {
    if (shot === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setShot(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shot]);

  // When the planner finishes drafting, the form is full of drafts but the next
  // move is the USER's (review → "Fill the real form"; we never submit). Without a
  // signal, that review-gate reads as "stuck". So on prefilling→ready we surface a
  // "drafted N answers" banner AND scroll the review CTA into view.
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = a.status;
    if (was === "prefilling" && a.status === "ready" && Object.keys(a.answers).length > 0) {
      setJustDrafted(true);
      const t = setTimeout(() => ctaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 450);
      return () => clearTimeout(t);
    }
  }, [a.status, a.answers]);

  if (a.status === "idle" || a.status === "error") {
    return (
      <div>
        <div className="flex max-w-2xl items-center gap-2 rounded-full border border-border bg-surface/70 py-1.5 pl-4 pr-1.5 shadow-sm transition focus-within:border-brand/50 focus-within:shadow-md">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && a.open(input.trim())}
            placeholder="Paste an application form URL (Ashby, Lever, Greenhouse…)"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-faint"
          />
          <button
            onClick={() => a.open(input.trim())}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200"
          >
            <Wand2 className="size-4" /> Read form
          </button>
        </div>
        {a.error && (
          <div className="mt-4 max-w-2xl rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3.5">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
              <div className="min-w-0">
                <p className="text-sm text-amber-800 dark:text-amber-300">{a.error}</p>
                {a.url && /^https?:\/\//.test(a.url) && (
                  <a href={a.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                    Open the form directly <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
        {/* A session that failed still has a row and an origin behind it, so the
            way back and the way to record it must survive the failure. */}
        {a.status === "error" && <ApplyExitBar />}
      </div>
    );
  }

  const opening = a.status === "opening";
  const driving = a.status === "driving";
  const prefilling = a.status === "prefilling";
  const filling = a.status === "filling";
  const done = a.status === "done";
  const busy = opening || driving;
  const phase = busy ? 0 : prefilling ? 1 : 2;
  const draftedCount = Object.values(a.answers).filter((v) => v && v.trim()).length;
  const confirmCount = a.fields.filter((f) => a.meta[f.id]?.needsConfirmation).length;
  const showDrafted = justDrafted && a.status === "ready" && draftedCount > 0;
  // While drafting, the FIRST still-empty field is the one being written now — mark
  // it as the active "cursor" so the user sees the fill advance down the form.
  const activeIdx = prefilling ? a.fields.findIndex((f) => !((a.answers[f.id] ?? "").trim())) : -1;
  // Before the first answer lands, show the captured page being scanned (if we have
  // a screenshot) instead of empty shimmer rows.
  const scanShot = a.shots[a.shots.length - 1];
  const showScan = prefilling && draftedCount === 0 && !!scanShot;
  // after a deterministic fill: did some fields not land? → offer the agentic finisher
  const failed = a.steps.filter((s) => !s.ok).length;
  const partial = done && (failed > 0 || a.issues.some((i) => i.code === "fill-mismatch" || i.code === "required-empty"));

  // "done" hands off to the user to click Submit themselves — this is the one-click
  // shortcut so they don't also have to go mark the tracker row by hand afterward.
  // Reuses the same write path as StatusSelect (POST /api/status), never a new one.
  async function markApplied() {
    if (!a.n || markingApplied) return;
    setMarkingApplied(true);
    try {
      const res = await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n: a.n, status: "Applied" }),
      });
      if (!res.ok) throw new Error("write failed");
      setMarkedApplied(true);
      // In queue mode, a logged Applied is the natural "advance" signal — move on
      // to the next item automatically (still just calling the same open()).
      if (inQueue) void a.queueNext();
    } catch {
      setMarkingApplied(false);
    }
  }

  // Human-confirmed only: clicking this both logs Applied (if we have a tracker
  // row) AND dismisses the passive-detection banner — never auto-logged.
  async function confirmSubmitted() {
    a.dismissSubmitDetected();
    await markApplied();
  }

  const inQueue = a.queue.length > 0;
  const queuePos = a.queueIndex + 1;
  const queueTotal = a.queue.length;
  const queueHasNext = a.queueIndex + 1 < a.queue.length;

  return (
    <div className="mx-auto max-w-2xl">
      <style>{STYLE}</style>

      {a.memoryToast && (
        <div className="fixed inset-x-0 bottom-6 z-[90] mx-auto flex w-fit max-w-[92vw] items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-700 shadow-lg backdrop-blur-md dark:text-emerald-300">
          <Sparkles className="size-4 shrink-0" /> {a.memoryToast}
        </div>
      )}

      {/* review lightbox — enlarge any fill screenshot to verify what was entered */}
      {shot !== null && a.steps[shot] && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Filled field screenshot" onClick={() => setShot(null)}>
          <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center gap-3 text-sm text-white">
              <span className="min-w-0 flex-1 truncate">
                {a.steps[shot].label || "Filled field"} <span className="text-white/50">· {shot + 1}/{a.steps.length}</span>
              </span>
              <button type="button" disabled={shot === 0} onClick={() => setShot(Math.max(0, shot - 1))} className="rounded-md px-2 py-1 text-white/80 hover:bg-white/10 disabled:opacity-30">←</button>
              <button type="button" disabled={shot >= a.steps.length - 1} onClick={() => setShot(Math.min(a.steps.length - 1, shot + 1))} className="rounded-md px-2 py-1 text-white/80 hover:bg-white/10 disabled:opacity-30">→</button>
              <button type="button" onClick={() => setShot(null)} aria-label="Close" className="rounded-md p-1 text-white/80 hover:bg-white/10"><X className="size-5" /></button>
            </div>
            {a.steps[shot].thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.steps[shot].thumb} alt="" className="max-h-[82vh] w-full rounded-lg border border-white/10 object-contain" />
            ) : (
              <div className="flex h-64 items-center justify-center rounded-lg border border-white/10 text-white/60">No screenshot for this step</div>
            )}
          </div>
        </div>
      )}

      {/* batch queue rail — additive; absent entirely for a single-job apply */}
      {inQueue && (
        <div className="co-rise mb-4 flex items-center gap-3 rounded-xl border border-brand/30 bg-brand-soft/50 px-4 py-2.5 text-sm">
          <ListChecks className="size-4 shrink-0 text-brand" />
          <span className="font-medium text-foreground">
            Application <span className="tabular-nums">{queuePos}</span> of <span className="tabular-nums">{queueTotal}</span>
          </span>
          <span className="min-w-0 flex-1 truncate text-muted">{a.company}</span>
          <button
            onClick={() => void a.queueNext()}
            disabled={!queueHasNext}
            title={queueHasNext ? "Skip this one and open the next queued application" : "This is the last queued application"}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface/60 px-3 py-1 text-xs font-medium text-muted transition-colors hover:text-brand disabled:opacity-40"
          >
            <SkipForward className="size-3.5" /> Skip / Next
          </button>
          <button onClick={a.stopQueue} title="Leave the queue (this application stays open)" className="shrink-0 text-xs text-faint transition-colors hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* journey: Read → Draft → Review */}
      <PhaseRail phase={phase} />

      {!busy && (
        <div className="co-rise mb-4 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-xl text-landing drop-shadow-sm">{a.title || "Application"}</h2>
          <button onClick={inQueue ? a.stopQueue : a.reset} className="inline-flex items-center gap-1 text-xs text-faint transition-colors hover:text-foreground">
            <RotateCcw className="size-3" /> new
          </button>
        </div>
      )}

      {/* opening: big magic hero + skeleton fields (no layout jump when real ones arrive) */}
      {opening && (
        <>
          <ProcessingHero title="Reading your form…" subtitle="Opening the real application on your machine and reading every field." />
          <FieldSkeleton />
        </>
      )}

      {/* driving: watch the agent reach the form live (it navigates, never submits) */}
      {driving && <DrivePanel steps={a.driveSteps} />}

      {a.error && (
        <p className="co-rise mb-3 flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 backdrop-blur-sm dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {a.error}
        </p>
      )}

      {!busy && (
        <div className="co-rise">
          <ApplyIssues issues={a.issues} />
          {/* drafted → make the review-gate unmistakable (the next move is yours) */}
          {showDrafted && (
            <div className="co-rise mb-4 flex items-start gap-2.5 rounded-xl border border-brand/30 bg-brand-soft/60 px-4 py-3 backdrop-blur-sm">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand" />
              <div className="min-w-0 text-sm">
                <span className="font-medium text-foreground">Drafted {draftedCount} answer{draftedCount === 1 ? "" : "s"} from your CV.</span>{" "}
                {confirmCount > 0 ? (
                  <span className="text-muted">
                    {confirmCount} need{confirmCount === 1 ? "s" : ""} your input (highlighted below). Review them, then <span className="font-medium text-foreground">fill the real form</span> — I never submit.
                  </span>
                ) : (
                  <span className="text-muted">
                    Review them below, then <span className="font-medium text-foreground">fill the real form</span> — I never submit.
                  </span>
                )}
              </div>
            </div>
          )}
          {/* drafting banner while the planner writes the answers (the scan panel
              carries its own label, so suppress this during the scan window) */}
          {prefilling && !showScan && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-brand/30 bg-brand-soft/60 px-4 py-3 backdrop-blur-sm">
              <span className="relative grid size-8 shrink-0 place-items-center">
                <span className="co-orb absolute inset-0 rounded-full bg-brand/40 blur-[6px]" />
                <Sparkles className="size-4 text-brand" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">Drafting your answers…</div>
                <RotatingStatus />
              </div>
              <Loader2 className="ml-auto size-4 shrink-0 animate-spin text-brand" />
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              onClick={a.prefill}
              disabled={prefilling || filling}
              className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft px-3.5 py-1.5 text-sm font-medium text-brand transition-colors hover:bg-brand/15 disabled:opacity-50"
            >
              {prefilling ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {prefilling ? "Drafting from your CV…" : "Pre-fill from my CV"}
            </button>
            <span className="text-xs text-muted">…or ask the corner assistant to write/revise any answer.</span>
          </div>

          {(prefilling || a.prefillLog.length > 0) && (
            <details className="mb-4 rounded-lg border border-border bg-surface/60 backdrop-blur-sm" open={false}>
              <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted">
                <Terminal className="size-3.5" /> Pre-fill diagnostics
                {prefilling && <Loader2 className="size-3 animate-spin text-brand" />}
                <span className="ml-auto text-faint">{a.prefillLog.length} steps</span>
              </summary>
              <div className="max-h-52 overflow-y-auto border-t border-border px-3 py-2">
                <ol className="space-y-0.5 font-mono text-[11px] leading-relaxed text-muted">
                  {a.prefillLog.map((l, i) => (
                    <li key={i} className={l.startsWith("✗") ? "text-amber-600 dark:text-amber-400" : ""}>
                      {l}
                    </li>
                  ))}
                  {prefilling && <li className="text-faint">…</li>}
                </ol>
              </div>
            </details>
          )}

          {/* until the first answer lands: the REAL captured page, being scanned */}
          {showScan && <ScanningForm shot={scanShot!} fields={a.fields} />}
          {/* the questions — cascade in, each flashes brand-orange the instant its
              drafted answer lands; the active row shimmers brand as it's written */}
          <div className={cn("space-y-1 rounded-2xl border border-border/70 bg-surface/80 p-2 shadow-2xl shadow-black/10 backdrop-blur-md sm:p-3", showScan && "hidden")}>
            {a.fields.map((f, i) => (
              <div key={f.id} className="co-rise rounded-xl px-3 py-2.5" style={{ animationDelay: `${Math.min(i * 45, 700)}ms` }}>
                <FieldRow
                  field={f}
                  value={a.answers[f.id] ?? ""}
                  needs={!!a.meta[f.id]?.needsConfirmation}
                  index={i}
                  drafting={prefilling}
                  active={i === activeIdx}
                  ai={!!a.meta[f.id]?.ai}
                  rememberShow={isRememberable(f, a.answers[f.id]) && !a.meta[f.id]?.ai}
                  remembering={a.remember[f.id] ?? true}
                  onRemember={(on) => a.setRemember(f.id, on)}
                  onChange={(v) => a.setAnswer(f.id, v)}
                />
              </div>
            ))}
          </div>

          <div ref={ctaRef} className={cn("mt-5", showDrafted && "co-flash")}>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={a.fill}
                disabled={filling || prefilling}
                className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground shadow-lg shadow-brand/25 transition-all hover:bg-brand-200 hover:shadow-brand/40 disabled:opacity-50"
              >
                {filling ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
                {filling ? "Filling the real form…" : "Fill the real form & review"}
              </button>
              <p className="inline-flex items-center gap-1.5 text-xs text-muted">
                <ShieldCheck className="size-3.5 text-emerald-500" /> Free &amp; instant — and never submits; you click Submit yourself.
              </p>
            </div>
            {/* escape hatch for multi-page / tricky forms — agentic, spends tokens.
                The primary path already auto-escalates to this if it can't fill. */}
            <button
              onClick={a.agentFill}
              disabled={filling || prefilling}
              title="For multi-page or tricky forms: the AI drives the real form field-by-field on your machine. Uses your AI (spends tokens). Never submits."
              className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-brand disabled:opacity-50"
            >
              <MousePointerClick className="size-3.5" /> or let the AI drive it field-by-field
              <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] text-brand">uses your AI</span>
            </button>
          </div>

          {/* agent filling the form live (full-agent escalation) */}
          {filling && a.driveSteps.length > 0 && <div className="mt-6"><DrivePanel steps={a.driveSteps} filling /></div>}

          {(filling || done) && a.steps.length > 0 && (
            <div className="co-rise mt-6">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-faint">
                Review what I filled <span className="font-normal normal-case tracking-normal text-faint/80">· click any shot to enlarge</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {a.steps.map((s, i) => (
                  <button key={i} type="button" onClick={() => setShot(i)} className="group shrink-0 text-left" title="Enlarge">
                    {s.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.thumb} alt={s.label || "filled field"} className="h-24 w-36 rounded-md border border-border object-cover transition group-hover:border-brand/60 group-hover:ring-2 group-hover:ring-brand/20" />
                    ) : (
                      <div className="flex h-24 w-36 items-center justify-center rounded-md border border-dashed border-border text-faint">…</div>
                    )}
                    <figcaption className={cn("mt-1 w-36 truncate text-[10px]", s.ok ? "text-faint" : "text-amber-500")}>{s.label || "field"}</figcaption>
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* passive submit-detection (Part 2): the real page's URL changed after
              handoff — a common "redirected to a confirmation page" signal. Purely
              observational (page.url() polling); this banner is a QUESTION, never
              an auto-log. The user clicks to confirm, same /api/status write as
              "Mark as Applied". */}
          {done && a.submitDetected && (
            <div className="co-rise mt-4 flex items-start gap-2.5 rounded-xl border border-brand/40 bg-brand-soft px-4 py-3 text-sm">
              <HelpCircle className="mt-0.5 size-5 shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <span className="font-medium text-foreground">Looks like the application page changed — did you submit it?</span>{" "}
                <span className="text-muted">career-ops never logs this on its own; confirm and I&apos;ll mark it Applied{inQueue ? " and move to the next one" : ""}.</span>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {a.n ? (
                    <button onClick={confirmSubmitted} className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand-200">
                      <Check className="size-3.5" /> Yes, mark Applied
                    </button>
                  ) : (
                    <span className="text-xs text-faint">(no tracker row linked to this application — nothing to mark)</span>
                  )}
                  <button onClick={a.dismissSubmitDetected} className="text-xs text-faint transition-colors hover:text-foreground">
                    Not yet
                  </button>
                </div>
              </div>
            </div>
          )}
          {done && (
            <div className="co-rise mt-4 flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm backdrop-blur-sm">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-500" />
              <div>
                <span className="font-medium text-emerald-700 dark:text-emerald-400">The pre-filled application is open in a separate Chrome window.</span>{" "}
                <span className="text-muted">Switch to it, review every answer, and click Submit there yourself — career-ops never submits for you. (You can also enlarge the shots above to double-check.)</span>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button onClick={a.bringForward} className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400">
                    <ExternalLink className="size-3.5" /> Can&apos;t find it? Bring the application window forward
                  </button>
                  {a.n && (
                    <button
                      onClick={markApplied}
                      disabled={markingApplied}
                      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:opacity-60 dark:text-emerald-400"
                    >
                      {markedApplied ? (
                        <>
                          <Check className="size-3.5" /> Marked as Applied
                        </>
                      ) : markingApplied ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" /> Marking…
                        </>
                      ) : (
                        <>
                          <Send className="size-3.5" /> Mark as Applied
                        </>
                      )}
                    </button>
                  )}
                  {inQueue && (
                    <button
                      onClick={() => void a.queueNext()}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/60 px-3 py-1 text-xs font-medium text-muted transition-colors hover:text-brand"
                    >
                      <SkipForward className="size-3.5" /> {queueHasNext ? "Next queued application" : "Finish queue"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          {/* deterministic fill left some fields → stronger, contextual agentic offer */}
          {partial && (
            <button
              onClick={a.agentFill}
              className="co-rise mt-3 inline-flex items-center gap-2 rounded-xl border border-brand/40 bg-brand-soft px-4 py-2.5 text-sm font-medium text-brand transition-colors hover:bg-brand/15"
            >
              <MousePointerClick className="size-4" /> {failed > 0 ? `${failed} field${failed === 1 ? "" : "s"} didn't fill` : "Some answers didn't land"} — let the AI finish it
              <span className="rounded-full bg-brand/15 px-1.5 py-0.5 text-[10px]">uses your AI</span>
            </button>
          )}
        </div>
      )}

      {/* the way out: back out of the form, or record that you sent it */}
      <ApplyExitBar />
    </div>
  );
}

// ── Leaving the page: back out, or record that you applied ─────────────────
// You submit the real form yourself on the employer's site, so the moment you
// apply happens outside career-ops — this is where you tell the tracker about
// it. The write goes through /api/status, the same route the tracker's own
// status control and this file's own inline "Mark as Applied" button use, so
// there is only ever one writer to the table.
function ApplyExitBar() {
  const a = useApply();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState("");
  // The status write outlives this bar when the user navigates while it is in
  // flight. The write still lands; what must not happen is dragging them back
  // off whatever page they moved on to once it returns.
  // Set on mount as well as cleared on unmount: React re-runs an effect after
  // its cleanup (StrictMode does this on every mount in development), so a
  // cleanup-only flag latches false while the bar is still on screen.
  const onPage = useRef(true);
  useEffect(() => {
    onPage.current = true;
    return () => {
      onPage.current = false;
    };
  }, []);

  // reset() also closes the headless form session on the user's machine —
  // navigating away without it strands the browser this page opened. The
  // destination is read before reset() clears the origin it comes from.
  //
  // The staleness check comes FIRST, before reset(). By the time a late status
  // response gets here the user may have started a different application, and
  // reset() is not addressed to a particular session: it would close whichever
  // one is open now, taking a form the user is in the middle of with it.
  // Leaving that session alone is the same outcome as navigating away from the
  // page by any other route.
  function leave() {
    if (!onPage.current) return;
    const target = resolveReturnPath(a.from);
    a.reset();
    router.push(target);
    router.refresh();
  }

  async function markApplied() {
    setMarking(true);
    setError("");
    try {
      const res = await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n: a.n, status: "Applied" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (!onPage.current) return; // moved on already; the row is unchanged
        setError(d.error || "Couldn't mark it applied — the tracker row is unchanged.");
        setMarking(false);
        return;
      }
      leave();
    } catch {
      if (!onPage.current) return; // moved on already
      // The route writes the tracker before it answers, so a connection that
      // drops on the way back leaves the write's fate genuinely unknown —
      // claiming the row is untouched here would be a guess.
      setError("Couldn't confirm the update — check the row in your tracker before relying on it.");
      setMarking(false);
    }
  }

  if (confirming) {
    return (
      <div className="co-rise mt-8 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 backdrop-blur-sm">
        <p className="text-sm font-medium text-foreground">Leave this application?</p>
        <p className="mt-1 text-xs text-muted">Your drafted answers live only on this page. Going back discards them and closes the form.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={leave}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-600 max-sm:min-h-[44px]"
          >
            <ArrowLeft className="size-3.5" /> Leave and discard
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground max-sm:min-h-[44px]"
          >
            Stay here
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 border-t border-border/70 pt-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => (needsLeaveConfirmation({ status: a.status, answers: a.answers }) ? setConfirming(true) : leave())}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[44px]"
        >
          <ArrowLeft className="size-4" /> Back
        </button>
        {a.n && (
          <button
            onClick={markApplied}
            disabled={marking}
            title={`Set tracker row #${a.n} to Applied and go back`}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-400 max-sm:min-h-[44px]"
          >
            {marking ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />}
            {marking ? "Updating your tracker…" : "Mark applied"}
          </button>
        )}
        {a.n && <span className="text-xs text-muted">Click this once you have submitted the real form yourself.</span>}
      </div>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ── Watch the agent reach the form live (it navigates, never submits) ───────
const DRIVE_VERB: Record<string, string> = { click: "Clicked", type: "Typed into", select: "Selected", scroll: "Scrolled", "parse-error": "Thinking…", stuck: "Stuck", reached_form: "Reached the form" };
function DrivePanel({ steps, filling }: { steps: DriveStep[]; filling?: boolean }) {
  const last = steps[steps.length - 1];
  return (
    <div className="co-rise">
      <div className="flex flex-col items-center gap-3 py-7 text-center">
        <span className="relative grid size-14 place-items-center">
          <span className="co-orb absolute inset-0 rounded-full bg-brand/30 blur-lg" />
          <span className="co-ring absolute inset-0 rounded-full border-2 border-brand/30 border-t-brand" />
          <MousePointerClick className="size-6 text-brand" />
        </span>
        <div className="font-display text-2xl text-landing">{filling ? "AI is filling the form…" : "Reaching your form…"}</div>
        <p className="max-w-sm text-sm text-muted">{filling ? "The AI is driving the real form field-by-field on your machine — it never submits; you review and submit." : "The AI is navigating the real application on your machine to reach the form — it never submits."}</p>
      </div>
      {last?.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={last.thumb} alt="" className="w-full rounded-xl border border-border shadow-xl shadow-black/10" />
      ) : (
        <div className="co-skel h-56 w-full rounded-xl" />
      )}
      {steps.length > 0 && (
        <ol className="mt-3 space-y-1.5 rounded-xl border border-border/70 bg-surface/70 p-3 backdrop-blur-sm">
          {steps.map((s, i) => (
            <li key={i} className={cn("flex items-center gap-2 text-xs", i === steps.length - 1 ? "text-foreground" : "text-muted")}>
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-[10px] font-semibold text-brand">{s.turn}</span>
              <span className="shrink-0 font-medium">{DRIVE_VERB[s.action] ?? s.action}</span>
              <span className="truncate text-faint">{s.detail}</span>
              {/* `submit-control` is the guard doing its job (good news, distinct
                  color); `not-offered`/`gone` are the page moving under us
                  (a caution, not a protection) — same amber as before this
                  field had a consumer at all. */}
              {s.note &&
                (s.refusal === "submit-control" ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-emerald-700 dark:text-emerald-400">
                    <ShieldCheck className="size-3" /> {s.note}
                  </span>
                ) : (
                  <span className="shrink-0 text-amber-500">· {s.note}</span>
                ))}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Issues the interpreter surfaced — never fail mute ───────────────────────
function ApplyIssues({ issues }: { issues: ApplyIssue[] }) {
  if (!issues.length) return null;
  const warns = issues.filter((i) => i.level === "warn" || i.level === "block");
  const infos = issues.filter((i) => i.level === "info");
  return (
    <div className="mb-4 space-y-2">
      {warns.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 backdrop-blur-sm">
          <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-4" /> A few things to check
          </div>
          <ul className="space-y-1 text-xs text-amber-800/90 dark:text-amber-300/90">
            {warns.map((i, k) => (
              <li key={k} className="flex gap-1.5">
                <span className="mt-px text-amber-500">•</span> {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {infos.map((i, k) => (
        <div key={k} className="flex items-center gap-1.5 text-xs text-muted">
          <Info className="size-3.5 shrink-0 text-faint" /> {i.message}
        </div>
      ))}
    </div>
  );
}

// ── Journey rail: Reading → Drafting → Review ───────────────────────────────
function PhaseRail({ phase }: { phase: number }) {
  const steps = [
    { label: "Reading form", icon: ScanLine },
    { label: "Drafting answers", icon: PenLine },
    { label: "Review & submit", icon: CheckCircle2 },
  ];
  return (
    <div className="mb-6 flex items-center gap-2.5">
      {steps.map((s, i) => {
        const Icon = s.icon;
        const state = i < phase ? "done" : i === phase ? "active" : "todo";
        return (
          <Fragment key={i}>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "relative grid size-6 place-items-center rounded-full border transition-colors",
                  state === "done" && "border-brand bg-brand text-brand-foreground",
                  state === "active" && "border-brand text-brand",
                  state === "todo" && "border-border text-faint",
                )}
              >
                {state === "done" ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
                {state === "active" && <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-brand/30" />}
              </span>
              <span className={cn("hidden text-xs font-medium sm:inline", i <= phase ? "text-foreground" : "text-faint")}>{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <span className="relative h-px flex-1 overflow-hidden rounded bg-border">
                <span className={cn("absolute inset-y-0 left-0 bg-brand transition-all duration-700", i < phase ? "w-full" : "w-0")} />
              </span>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

// Honest, calming rotation of what the planner is actually doing, so the (~1-2min)
// draft doesn't feel stalled. Crossfades every ~2.8s.
const DRAFT_MSGS = [
  "Reading your CV…",
  "Reading the role and company…",
  "Matching your experience to each question…",
  "Writing every answer in your own voice…",
  "Flagging anything that needs your call…",
];
function RotatingStatus() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % DRAFT_MSGS.length), 2800);
    return () => clearInterval(t);
  }, []);
  return (
    <div key={i} className="co-rise truncate text-xs text-muted">
      {DRAFT_MSGS[i]}
    </div>
  );
}

function ProcessingHero({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="co-rise flex flex-col items-center gap-3 py-14 text-center">
      <span className="relative grid size-16 place-items-center">
        <span className="co-orb absolute inset-0 rounded-full bg-brand/30 blur-lg" />
        <span className="co-ring absolute inset-0 rounded-full border-2 border-brand/30 border-t-brand" />
        <Sparkles className="size-7 text-brand" />
      </span>
      <div className="font-display text-3xl text-landing">{title}</div>
      <p className="max-w-sm text-sm text-muted">{subtitle}</p>
    </div>
  );
}

// Until the first answer lands, show the REAL Playwright capture of the form being
// "scanned" by a sweeping brand light — and, since extraction already found every
// field, REVEAL them one-by-one in an overlay (icon + label + ✓, paced so each is
// readable) with a counter + progress bar. Concrete "here's exactly what I found"
// beats a generic spinner: the labor-illusion makes the short wait feel productive.
function ScanningForm({ shot, fields }: { shot: string; fields: ApplyField[] }) {
  const n = fields.length;
  const [revealed, setRevealed] = useState(n ? 1 : 0);
  useEffect(() => {
    if (revealed >= n) return;
    const t = setInterval(() => setRevealed((r) => (r >= n ? r : r + 1)), 1900);
    return () => clearInterval(t);
  }, [revealed, n]);
  const cur = fields[Math.max(0, revealed - 1)];
  const CurIcon = cur ? fieldIcon(cur) : ScanLine;
  const pct = n ? Math.round((Math.min(revealed, n) / n) * 100) : 0;
  const done = n > 0 && revealed >= n; // all fields catalogued, still drafting
  return (
    <div className="co-rise co-scan relative rounded-2xl border border-border/70 bg-surface/60 shadow-2xl shadow-black/10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={shot} alt="" className="block max-h-[440px] w-full rounded-2xl object-cover object-top opacity-90 dark:opacity-70" />
      <div className="co-dots pointer-events-none absolute inset-0 rounded-2xl opacity-60" />
      <div className="absolute inset-x-0 bottom-0 z-[2] rounded-b-2xl bg-gradient-to-t from-surface via-surface/85 to-transparent px-5 pb-4 pt-12">
        <div className="flex items-center gap-3">
          <span className="relative grid size-9 shrink-0 place-items-center">
            <span className="co-orb absolute inset-0 rounded-full bg-brand/40 blur-[7px]" />
            {done ? <PenLine className="size-4 text-brand" /> : <ScanLine className="size-4 text-brand" />}
          </span>
          <div className="min-w-0 flex-1">
            {done ? (
              <>
                {/* all fields catalogued → switch to a LIVE drafting state so it never
                    looks frozen at N/N while the planner finishes writing the answers */}
                <div className="text-[11px] uppercase tracking-wide text-faint">Drafting your answers · {n} fields read</div>
                <RotatingStatus />
              </>
            ) : (
              <>
                <div className="text-[11px] uppercase tracking-wide text-faint">
                  Mapping the form · <span className="tabular-nums">{Math.min(revealed, n)}/{n}</span> fields
                </div>
                {cur && (
                  <div key={revealed} className="co-rise mt-0.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <CurIcon className="size-4 shrink-0 text-brand" />
                    <span className="truncate">{cur.label || "Untitled field"}</span>
                    <Check className="size-3.5 shrink-0 text-emerald-500" />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        {done ? (
          <div className="co-indet mt-2.5 h-1 rounded-full bg-border/70" />
        ) : (
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-border/70">
            <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

function FieldSkeleton() {
  return (
    <div className="co-rise space-y-3 rounded-2xl border border-border/70 bg-surface/70 p-5 backdrop-blur-md" style={{ animationDelay: "120ms" }}>
      {[64, 80, 48, 72, 56].map((w, i) => (
        <div key={i} className="space-y-2">
          <div className="co-skel h-3" style={{ width: `${w}px` }} />
          <div className="co-skel h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

// A familiar lucide glyph per field semantics (same line-icon family as the rest of
// the app / sidebar) so a long form reads at a glance and feels less heavy — the
// user recognises name/email/links/etc. before reading the label.
function fieldIcon(f: ApplyField) {
  const l = (f.label || "").toLowerCase();
  if (/policy|guideline|consent|terms|acknowledg|i agree|i have read/.test(l)) return ShieldCheck;
  if (/first name|last name|full name|preferred name|\bname\b/.test(l)) return User;
  if (/e-?mail/.test(l)) return Mail;
  if (/phone|mobile|\btel\b/.test(l)) return Phone;
  if (/linkedin/.test(l)) return Link2;
  if (/github|gitlab/.test(l)) return Code2;
  if (/portfolio|website|personal site|\bweb\b|twitter|\burl\b/.test(l)) return Globe;
  if (/location|city|country|address|based|relocat/.test(l)) return MapPin;
  if (/company|current employer|organi[sz]ation/.test(l)) return Building2;
  if (/salary|compensation|\bpay\b|\brate\b|expected comp/.test(l)) return DollarSign;
  if (/office|on-?site|remote|hybrid|% of time|days? (in|per)|in person/.test(l)) return Clock;
  if (/start date|notice period|availab|when can you/.test(l)) return CalendarDays;
  if (/degree|education|university|college|school|gpa/.test(l)) return GraduationCap;
  if (f.type === "file") return Paperclip;
  if (f.type === "url") return Link2;
  if (f.type === "select" || f.type === "radio") return ListChecks;
  if (f.type === "textarea") return MessageSquareText;
  return FileText;
}

function FieldRow({
  field: f,
  value,
  needs,
  index,
  drafting,
  active,
  ai,
  rememberShow,
  remembering,
  onRemember,
  onChange,
}: {
  field: ApplyField;
  value: string;
  needs: boolean;
  index: number;
  drafting: boolean;
  active?: boolean;
  ai?: boolean;
  rememberShow?: boolean;
  remembering?: boolean;
  onRemember?: (on: boolean) => void;
  onChange: (v: string) => void;
}) {
  const controlId = useId();
  const confirmationId = `${controlId}-confirmation`;
  // Announce the employer's requirement without imposing native validation on
  // this draft editor; the user still reviews/submits the real form separately.
  const controlProps = {
    id: controlId,
    "aria-required": f.required || undefined,
    "aria-describedby": needs ? confirmationId : undefined,
  };
  const labelText = f.label || "Untitled field";

  // Flash brand-orange the moment a drafted answer first lands (empty → value).
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!prev.current && value) {
      setFlash(true);
      // outlast the staggered animation-delay (≤900ms) + the 1.15s flash
      const t = setTimeout(() => setFlash(false), 2300);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);

  const base = cn(
    "w-full rounded-lg border bg-surface/60 px-3 py-2 text-sm outline-none transition focus:border-brand/60 focus:ring-2 focus:ring-brand/20",
    needs ? "border-amber-500/50" : "border-border",
  );
  // While the planner is drafting, an empty answer shimmers like it's being
  // written; it flashes into the real value the instant the draft lands.
  const writing = drafting && !value && f.type !== "file";
  const Icon = fieldIcon(f);
  return (
    <div className={flash ? "co-flash" : ""} style={flash ? { animationDelay: `${Math.min(index * 70, 900)}ms` } : undefined}>
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
        <Icon aria-hidden="true" className={cn("size-3.5 shrink-0 transition-colors", active ? "text-brand" : "text-faint")} />
        {f.type === "file" || f.type === "checkbox" ? (
          <span className={f.label ? undefined : "text-faint"}>{labelText}</span>
        ) : (
          <label htmlFor={controlId} className={f.label ? undefined : "text-faint"}>{labelText}</label>
        )}
        {f.required && <Asterisk aria-hidden="true" className="size-3 text-brand" />}
        {needs && <span id={confirmationId} className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">you confirm</span>}
        {ai && !!value && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand" title="Drafted by AI — edit the text and it becomes yours">
            <Sparkles aria-hidden="true" className="size-3" /> AI
          </span>
        )}
      </div>
      {/* consent/sensitive: show the real descriptive text + any link so the user
          READS before agreeing — career-ops never agrees on their behalf */}
      {needs && (f.description || f.link) && (
        <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs leading-relaxed text-muted">
          {f.description && <p>{f.description}</p>}
          {f.link && (
            <a href={f.link.href} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-medium text-brand hover:underline">
              {f.link.text} <ExternalLink className="size-3" />
            </a>
          )}
          <p className="mt-1.5 text-[11px] text-faint">Read this, then choose your answer yourself.</p>
        </div>
      )}
      {writing ? (
        <div className={cn("co-skel", active && "co-skel-brand", f.type === "textarea" ? "h-[68px]" : "h-9")} />
      ) : f.type === "textarea" ? (
        <textarea {...controlProps} rows={3} maxLength={f.maxLength} value={value} onChange={(e) => onChange(e.target.value)} placeholder={needs ? "You fill this one." : "…"} className={cn(base, "resize-none")} />
      ) : (f.type === "select" || f.type === "radio") && f.options && f.options.length > 0 ? (
        <select {...controlProps} value={value} onChange={(e) => onChange(e.target.value)} className={base}>
          <option value="">Choose…</option>
          {f.options.map((o, i) => (
            <option key={i} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : f.type === "checkbox" ? (
        <label className="flex items-center gap-2 text-sm text-muted">
          <input {...controlProps} type="checkbox" checked={value === "true" || value === "yes"} onChange={(e) => onChange(e.target.checked ? "true" : "")} className="size-4 accent-brand" /> {f.label || "Yes"}
        </label>
      ) : f.type === "file" ? (
        isResumeLabel(f.label) ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
            <FileCheck2 className="size-4 shrink-0" /> Your tailored CV (PDF) will be attached automatically — you can swap it on the real form.
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted">
            <Paperclip className="size-4 shrink-0" /> Attach this file yourself on the real form at the handoff.
          </div>
        )
      ) : (
        <input {...controlProps} type={["email", "tel", "url", "number", "date"].includes(f.type) ? f.type : "text"} maxLength={f.maxLength} value={value} onChange={(e) => onChange(e.target.value)} placeholder={needs ? "You fill this one." : "…"} className={base} />
      )}
      {/* an open answer the user surfaced (a talk/podcast link, a niche fact) → offer
          to remember it for FUTURE applications (pre-checked); saved to canonical memory */}
      {rememberShow && (
        <label className="mt-2 flex w-fit cursor-pointer items-center gap-1.5 rounded-md py-0.5 text-[11px] text-muted transition-colors hover:text-foreground">
          <input type="checkbox" checked={remembering ?? true} onChange={(e) => onRemember?.(e.target.checked)} className="size-3 accent-brand" />
          <Bookmark className="size-3 text-brand/70" /> Remember this for next time
        </label>
      )}
    </div>
  );
}
