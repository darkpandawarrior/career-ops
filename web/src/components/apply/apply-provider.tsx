"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ApplyField } from "@/lib/apply/extract";
import type { ApplyIssue, DriveStep } from "@/lib/apply/issue";
import { isRememberable } from "@/lib/apply/remember";
import { resolveLateSession } from "@/lib/apply/exit.mjs";

export type FillStep = { fieldId: string; label: string; ok: boolean; thumb?: string };
type Meta = { needsConfirmation?: boolean; ai?: boolean };
type Status = "idle" | "opening" | "driving" | "prefilling" | "ready" | "filling" | "done" | "error";

// A batch of applications to prepare SEQUENTIALLY, one real headed session at a
// time — never multiple Chrome windows at once (see AGENTS.md/drive.ts). Each
// item still goes through the exact same open→prefill→review→fill→handoff path;
// the queue only removes the "go find the next URL" friction between them.
export type QueueItem = { n?: string; url: string; title: string; company: string };

type ApplyCtx = {
  status: Status;
  url: string;
  title: string;
  company: string;
  n: string;
  /** Path the session was opened from, so the page has somewhere to go back to. */
  from: string;
  fields: ApplyField[];
  answers: Record<string, string>;
  meta: Record<string, Meta>;
  steps: FillStep[];
  shots: string[];
  prefillLog: string[];
  issues: ApplyIssue[];
  driveSteps: DriveStep[];
  error: string;
  open: (url: string, opts?: { prefill?: boolean; company?: string; n?: string; from?: string }) => Promise<void>;
  prefill: () => Promise<void>;
  setAnswer: (idOrLabel: string, value: string, fromAI?: boolean) => void;
  fill: () => Promise<void>;
  agentFill: () => Promise<void>;
  bringForward: () => Promise<void>;
  reset: () => void;
  remember: Record<string, boolean>;
  setRemember: (id: string, on: boolean) => void;
  memoryToast: string;
  // ── batch queue (additive; a single-job apply never touches these) ──
  queue: QueueItem[];
  queueIndex: number;
  startQueue: (items: QueueItem[]) => Promise<void>;
  queueNext: () => Promise<void>; // advance to the next item (used by "Skip" and after Mark Applied)
  stopQueue: () => void; // leave queue mode, keep the current session open
  // ── passive submit-detection (Part 2) — human-confirmed only, never auto-logs ──
  submitDetected: boolean;
  dismissSubmitDetected: () => void;
};

const Ctx = createContext<ApplyCtx | null>(null);
export function useApply(): ApplyCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApply must be used within <ApplyProvider>");
  return c;
}

/** Release the headless browser behind a session id. Fire-and-forget: the page
 *  is usually navigating away as this goes out, hence keepalive. */
function closeSession(id: string) {
  void fetch("/api/apply/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: id }), keepalive: true }).catch(() => {});
}

export function ApplyProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("idle");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [n, setN] = useState("");
  const [from, setFrom] = useState("");
  const [fields, setFields] = useState<ApplyField[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState<Record<string, Meta>>({});
  const [remember, setRememberMap] = useState<Record<string, boolean>>({});
  const [memoryToast, setMemoryToast] = useState("");
  const [steps, setSteps] = useState<FillStep[]>([]);
  const [shots, setShots] = useState<string[]>([]);
  const [prefillLog, setPrefillLog] = useState<string[]>([]);
  const [issues, setIssues] = useState<ApplyIssue[]>([]);
  const [driveSteps, setDriveSteps] = useState<DriveStep[]>([]);
  const [error, setError] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [submitDetected, setSubmitDetected] = useState(false);
  const sessionId = useRef<string | null>(null);
  // Path captured right at handoff — the polling effect below diffs future
  // /api/apply/page-url reads against this to notice a post-handoff navigation.
  const handoffPath = useRef<string | null>(null);
  const companyRef = useRef<string>("");
  const fieldsRef = useRef<ApplyField[]>([]);
  fieldsRef.current = fields;
  const answersRef = useRef<Record<string, string>>({});
  answersRef.current = answers;
  const metaRef = useRef<Record<string, Meta>>({});
  metaRef.current = meta;
  const rememberRef = useRef<Record<string, boolean>>({});
  rememberRef.current = remember;
  // Active profile's CLI (per-profile, from /api/cli — auto-defaults to first
  // installed). Resolved once on mount into a ref so the synchronous call sites
  // below keep working; never the global localStorage key.
  const cliIdRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/cli")
      .then((r) => r.json())
      .then((c) => { if (!cancelled) cliIdRef.current = c.selected ?? null; })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const cliId = useCallback(() => cliIdRef.current, []);
  // Bumped every time a session is abandoned or replaced. Leaving the page is
  // reachable while a request or stream is still in flight, and none of them can
  // be recalled, so each one carries the generation it started in and drops its
  // results if that generation is no longer current.
  const generation = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashMemory = useCallback((msg: string) => {
    setMemoryToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMemoryToast(""), 4500);
  }, []);
  const setRemember = useCallback((id: string, on: boolean) => setRememberMap((prev) => ({ ...prev, [id]: on })), []);
  const bringForward = useCallback(async () => {
    if (!sessionId.current) return;
    await fetch("/api/apply/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sessionId.current }) }).catch(() => {});
  }, []);
  // When a session opens with {prefill:true}, auto-fire prefill once fields are
  // ready — driven by an effect (not a fragile setTimeout) so it can't race the
  // session response or a navigation.
  const pendingPrefill = useRef(false);

  // Stream the agentic drive (the AI reaching the form live) and finalize the
  // session when it succeeds → fields ready → auto-prefill fires.
  const drive = useCallback(async (id: string) => {
    const gen = generation.current;
    setDriveSteps([]);
    try {
      const r = await fetch("/api/apply/drive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: id, cliId: cliId(), goal: "reach" }) });
      if (generation.current !== gen) return; // left mid-drive
      if (!r.body) {
        setError("The agent couldn't start.");
        setStatus("error");
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (generation.current !== gen) return; // left mid-drive
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: { t?: string; message?: string; fields?: ApplyField[]; title?: string; issues?: ApplyIssue[] } & DriveStep;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.t === "step") setDriveSteps((p) => [...p, ev as DriveStep]);
          else if (ev.t === "done") {
            finished = true;
            setFields(ev.fields ?? []);
            if (ev.title) setTitle(ev.title);
            setIssues(ev.issues ?? []);
            setStatus("ready"); // → the ready-effect auto-prefills if pending
          } else if (ev.t === "error") {
            finished = true;
            setError(ev.message || "The agent couldn't reach a fillable form.");
            setStatus("error");
          }
        }
      }
      if (generation.current !== gen) return; // left mid-drive
      if (!finished) {
        setError("The agent stopped before reaching a form.");
        setStatus("error");
      }
    } catch (e) {
      if (generation.current !== gen) return; // left mid-drive
      setError(`The agent couldn't reach the form: ${e instanceof Error ? e.message : "stream error"}.`);
      setStatus("error");
    }
  }, []);

  const open = useCallback(async (u: string, opts?: { prefill?: boolean; company?: string; n?: string; from?: string }) => {
    const gen = ++generation.current;
    // Opening a second form abandons the first one's browser exactly the way
    // leaving the page does, so it is released here too.
    if (sessionId.current) closeSession(sessionId.current);
    sessionId.current = null;
    setStatus("opening");
    setError("");
    setFields([]);
    setAnswers({});
    setMeta({});
    setRememberMap({});
    setMemoryToast("");
    setSteps([]);
    setShots([]);
    setIssues([]);
    setDriveSteps([]);
    setUrl(u);
    setCompany(opts?.company ?? "");
    setN(opts?.n ?? "");
    setFrom(opts?.from ?? "");
    companyRef.current = opts?.company ?? "";
    pendingPrefill.current = false;
    try {
      const r = await fetch("/api/apply/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: u, cliId: cliId() }) });
      const d = await r.json();
      // The user can leave while this is in flight, and the request can't be
      // recalled — a session that lands after they left is closed here or its
      // headless browser runs forever, unreferenced.
      const late = resolveLateSession({ stale: generation.current !== gen, sessionId: d.id });
      if (late !== "apply") {
        if (late === "close") closeSession(d.id);
        return;
      }
      if (d.error) {
        setError(d.error);
        setStatus("error");
        return;
      }
      sessionId.current = d.id;
      setTitle(d.title);
      setShots(d.shots ?? []);
      pendingPrefill.current = !!opts?.prefill;
      if (d.needsDrive) {
        // The form is behind navigation → the agent drives to reach it, streamed.
        setStatus("driving");
        await drive(d.id);
        return;
      }
      setFields(d.fields);
      setIssues(d.issues ?? []);
      setStatus("ready");
    } catch {
      if (generation.current !== gen) return; // left while it was opening
      setError("Could not open the form.");
      setStatus("error");
    }
  }, []);

  // ── batch queue: process ONE job at a time through the SAME open()/fill()
  // pipeline above — no parallel sessions. "advance" just calls open() again for
  // the next item, so every never-submit guard in session.ts/drive.ts applies
  // identically to every queued item (nothing about the pipeline itself changes).
  const queueRef = useRef<QueueItem[]>([]);
  queueRef.current = queue;
  const openItem = useCallback(
    (item: QueueItem) => open(item.url, { prefill: true, company: item.company, n: item.n }),
    [open],
  );
  const startQueue = useCallback(
    async (items: QueueItem[]) => {
      if (!items.length) return;
      setQueue(items);
      setQueueIndex(0);
      await openItem(items[0]);
    },
    [openItem],
  );
  const queueNext = useCallback(async () => {
    const next = queueIndex + 1;
    setQueueIndex(next);
    if (next < queueRef.current.length) await openItem(queueRef.current[next]);
  }, [openItem, queueIndex]);
  const stopQueue = useCallback(() => {
    setQueue([]);
    setQueueIndex(0);
  }, []);
  const dismissSubmitDetected = useCallback(() => setSubmitDetected(false), []);

  const prefill = useCallback(async () => {
    if (!sessionId.current) return;
    const gen = generation.current;
    if (!cliId()) {
      setError("Configure a CLI in Config first, then pre-fill from your CV.");
      return;
    }
    setStatus("prefilling");
    setError("");
    setPrefillLog([]);
    const applyAnswers = (raw: Record<string, { value?: string; needs_confirmation?: boolean }>) => {
      const a: Record<string, string> = {};
      const m: Record<string, Meta> = {};
      for (const [id, v] of Object.entries(raw)) {
        a[id] = v?.value ?? "";
        m[id] = { needsConfirmation: !!v?.needs_confirmation, ai: true };
      }
      setAnswers(a);
      setMeta(m);
    };
    try {
      const r = await fetch("/api/apply/prefill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sessionId.current, cliId: cliId() }) });
      if (generation.current !== gen) return; // left mid-prefill
      if (!r.body) {
        setError("Couldn't pre-fill — no response stream.");
        setStatus("ready");
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let got = false;
      let sawError = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (generation.current !== gen) return; // left mid-prefill
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: { t?: string; m?: string; el?: number; raw?: string; answers?: Record<string, { value?: string; needs_confirmation?: boolean }>; count?: number; truncated?: boolean; id?: string; value?: string; needs?: boolean };
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.t === "log") {
            setPrefillLog((p) => [...p, `+${((ev.el ?? 0) / 1000).toFixed(1)}s  ${ev.m}`]);
          } else if (ev.t === "field" && ev.id) {
            // a single answer just finished drafting → fill it now (the field
            // flashes; the shimmer recedes one row) for the top-to-bottom wave.
            got = true;
            const id = ev.id;
            const val = String(ev.value ?? "");
            const needs = !!ev.needs;
            setAnswers((m) => ({ ...m, [id]: val }));
            setMeta((m) => ({ ...m, [id]: { needsConfirmation: needs, ai: true } }));
          } else if (ev.t === "done") {
            got = true;
            applyAnswers(ev.answers ?? {});
            if ((ev.count ?? 0) === 0) setError("The planner returned 0 answers — see the diagnostics log below.");
            else if (ev.truncated) setError("The planner was cut off — some fields were recovered, others may be blank. See diagnostics.");
          } else if (ev.t === "error") {
            sawError = true;
            setError(ev.m ? `Couldn't pre-fill: ${ev.m}` : "Couldn't pre-fill from your CV.");
            setPrefillLog((p) => [...p, `✗ ${ev.m ?? "error"}${ev.raw ? ` — raw tail: ${ev.raw.slice(0, 160)}` : ""}`]);
          }
        }
      }
      if (generation.current !== gen) return; // left mid-prefill
      if (!got && !sawError) setError("Pre-fill ended without answers — see the diagnostics log below.");
      setStatus("ready");
    } catch (e) {
      if (generation.current !== gen) return; // left mid-prefill
      setError(`Couldn't pre-fill from your CV: ${e instanceof Error ? e.message : "stream error"}. See diagnostics.`);
      setStatus("ready");
    }
  }, []);

  // Auto-prefill exactly once after the fields are ready.
  useEffect(() => {
    if (status === "ready" && pendingPrefill.current) {
      pendingPrefill.current = false;
      void prefill();
    }
  }, [status, prefill]);

  // PASSIVE submit-detection (human-confirmed only — never auto-logs). After
  // handoff, the human is looking at the real ATS page about to click Submit
  // themselves. We poll page.url() (read-only; see sessionUrlPath) every few
  // seconds and, if the path changes — a common "redirected to a confirmation/
  // thank-you page" signal — flip submitDetected so the UI can offer a
  // confirm-only prompt. Stops the moment we leave "done" (new form opened, or
  // the queue advanced) so it never watches a session that's no longer current.
  useEffect(() => {
    if (status !== "done" || !sessionId.current) return;
    const id = sessionId.current;
    const t = setInterval(() => {
      if (sessionId.current !== id || submitDetected) return;
      fetch("/api/apply/page-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: id }) })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { path?: string } | null) => {
          if (!d?.path || sessionId.current !== id) return;
          if (handoffPath.current == null) {
            handoffPath.current = d.path; // baseline arrived late — adopt it, don't fire immediately
            return;
          }
          if (d.path !== handoffPath.current) setSubmitDetected(true);
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [status, submitDetected]);

  const setAnswer = useCallback((idOrLabel: string, value: string, fromAI = false) => {
    const fs = fieldsRef.current;
    const key = idOrLabel.toLowerCase();
    const f =
      fs.find((x) => x.id === idOrLabel) ||
      fs.find((x) => x.label.toLowerCase().includes(key)) ||
      fs.find((x) => key.includes(x.label.toLowerCase()) && x.label.length > 2);
    if (f) {
      setAnswers((prev) => ({ ...prev, [f.id]: value }));
      // user edit clears the AI badge (this answer is now theirs); an AI-origin
      // write (assistant revise) can pass fromAI=true to keep it.
      setMeta((prev) => ({ ...prev, [f.id]: { ...prev[f.id], ai: fromAI } }));
    }
  }, []);

  const fill = useCallback(async () => {
    if (!sessionId.current) return;
    const gen = generation.current;
    setStatus("filling");
    setSteps([]);
    // Persist the OPEN answers the user chose to remember → canonical memory →
    // future prefills reuse them (the system gets smarter with each form). Gated to
    // user-provided (!ai) open facts the user didn't uncheck. Best-effort, async.
    try {
      const items = fieldsRef.current
        .filter((f) => rememberRef.current[f.id] !== false && !metaRef.current[f.id]?.ai && isRememberable(f, answersRef.current[f.id]))
        .map((f) => ({ label: f.label, value: answersRef.current[f.id] }));
      if (items.length) {
        fetch("/api/apply/remember", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) })
          .then((r) => r.json())
          .then((d) => {
            if (d?.saved) flashMemory(`Saved ${d.saved} answer${d.saved === 1 ? "" : "s"} to your memory — I'll reuse ${d.saved === 1 ? "it" : "them"} on your next application.`);
          })
          .catch(() => {});
      }
    } catch {
      /* best-effort */
    }
    try {
      const r = await fetch("/api/apply/fill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sessionId.current, answers, fields, handoff: true, company: companyRef.current }) });
      const d = await r.json();
      // Also stops the escalation below from starting an agent drive on a
      // session the user has already walked away from.
      if (generation.current !== gen) return; // left mid-fill
      if (d.error) {
        setError(d.error);
        setStatus("error");
        return;
      }
      setSteps(d.steps ?? []);
      // merge the verify-after-fill warnings (required-empty / mismatch / validation)
      if (Array.isArray(d.issues) && d.issues.length) {
        setIssues((prev) => {
          const seen = new Set(prev.map((i: ApplyIssue) => i.message));
          return [...prev, ...(d.issues as ApplyIssue[]).filter((i) => !seen.has(i.message))];
        });
      }
      if (d.navigated) setError("Heads up: the form's page changed during fill — review it carefully before submitting (career-ops never submits for you).");
      setStatus("done");
      // Baseline for passive submit-detection: the page the human is looking at
      // right after handoff. The polling effect below watches for it to change.
      setSubmitDetected(false);
      handoffPath.current = null;
      fetch("/api/apply/page-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sessionId.current }) })
        .then((r) => r.json())
        .then((d2: { path?: string }) => { if (d2?.path) handoffPath.current = d2.path; })
        .catch(() => {});
      // ESCALATION ("si no va, full agente"): if deterministic fill clearly
      // didn't land (most fields failed / mismatched), let the agent fill it.
      const okCount = (d.steps ?? []).filter((s: FillStep) => s.ok).length;
      const total = (d.steps ?? []).length;
      const mismatch = (d.issues ?? []).some((i: ApplyIssue) => i.code === "fill-mismatch");
      if (cliId() && total > 0 && (okCount === 0 || (mismatch && okCount < total / 2))) {
        await agentFillRef.current();
      }
    } catch {
      if (generation.current !== gen) return; // left mid-fill
      setError("Fill failed.");
      setStatus("error");
    }
  }, [answers, fields]);

  // FULL-AGENT FILL — the agent fills the real form turn-by-turn from the verified
  // answers, streamed (drive panel), never submits, then hands off. Used as the
  // escalation when deterministic fill fails, or on demand.
  const agentFill = useCallback(async () => {
    if (!sessionId.current) return;
    const gen = generation.current;
    const fs = fieldsRef.current;
    const a = answersRef.current;
    const ans = fs.filter((f) => f.type !== "file" && (a[f.id] || "").trim()).map((f) => ({ label: f.label || f.id, value: a[f.id] }));
    setDriveSteps([]);
    setError("");
    setStatus("filling");
    try {
      const r = await fetch("/api/apply/drive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sessionId.current, cliId: cliId(), goal: "full", answers: ans }) });
      if (generation.current !== gen) return; // left mid-fill
      if (!r.body) {
        setError("The agent couldn't start filling.");
        setStatus("error");
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (generation.current !== gen) return; // left mid-fill
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: { t?: string; message?: string; filled?: boolean } & DriveStep;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.t === "step") setDriveSteps((p) => [...p, ev as DriveStep]);
          else if (ev.t === "done") {
            setIssues((prev) => [...prev, { level: "info", code: "ai-filled", message: ev.filled ? "AI filled the form for you — review every answer on the real form, then submit it yourself." : "AI did its best but couldn't finish — check the real form before submitting." }]);
            setStatus("done");
          } else if (ev.t === "error") {
            setError(ev.message || "The agent couldn't fill the form.");
            setStatus("error");
          }
        }
      }
    } catch (e) {
      if (generation.current !== gen) return; // left mid-fill
      setError(`The agent couldn't fill the form: ${e instanceof Error ? e.message : "stream error"}.`);
      setStatus("error");
    }
  }, []);
  const agentFillRef = useRef(agentFill);
  agentFillRef.current = agentFill;

  const reset = useCallback(() => {
    // Invalidate anything still in flight before clearing state, so a response
    // that lands after this can't repopulate the page the user just left.
    generation.current += 1;
    if (sessionId.current) closeSession(sessionId.current);
    sessionId.current = null;
    companyRef.current = "";
    pendingPrefill.current = false;
    handoffPath.current = null;
    setStatus("idle");
    setUrl("");
    setTitle("");
    setCompany("");
    setN("");
    setFrom("");
    setFields([]);
    setAnswers({});
    setMeta({});
    setRememberMap({});
    setMemoryToast("");
    setSteps([]);
    setShots([]);
    setPrefillLog([]);
    setIssues([]);
    setDriveSteps([]);
    setError("");
    setQueue([]);
    setQueueIndex(0);
    setSubmitDetected(false);
  }, []);

  const value = useMemo(
    () => ({
      status, url, title, company, n, from, fields, answers, meta, steps, shots, prefillLog, issues, driveSteps, error,
      open, prefill, setAnswer, fill, agentFill, bringForward, reset, remember, setRemember, memoryToast,
      queue, queueIndex, startQueue, queueNext, stopQueue, submitDetected, dismissSubmitDetected,
    }),
    [
      status, url, title, company, n, from, fields, answers, meta, steps, shots, prefillLog, issues, driveSteps, error,
      open, prefill, setAnswer, fill, agentFill, bringForward, reset, remember, setRemember, memoryToast,
      queue, queueIndex, startQueue, queueNext, stopQueue, submitDetected, dismissSubmitDetected,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
