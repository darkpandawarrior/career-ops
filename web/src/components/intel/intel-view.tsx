"use client";

import { useEffect, useState } from "react";
import { Loader2, BookOpen, Target, MessagesSquare, Trophy, Dumbbell, Building2, Clock, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CoachState } from "@/lib/coach";

type CadenceEntry = { company?: string; role?: string; status?: string; action?: string; due?: string; days?: number; [k: string]: unknown };

export function IntelView({ coach }: { coach: CoachState | null }) {
  const [cadence, setCadence] = useState<{ loading: boolean; entries: CadenceEntry[]; available: boolean }>({ loading: true, entries: [], available: false });
  const [patterns, setPatterns] = useState<{ loading: boolean; result: unknown; available: boolean }>({ loading: true, result: null, available: false });

  useEffect(() => {
    fetch("/api/cadence").then((r) => r.json()).then((d) =>
      setCadence({ loading: false, entries: Array.isArray(d.entries) ? d.entries : [], available: !!d.available }),
    ).catch(() => setCadence({ loading: false, entries: [], available: false }));
    fetch("/api/patterns").then((r) => r.json()).then((d) =>
      setPatterns({ loading: false, result: d.result ?? null, available: !!d.available }),
    ).catch(() => setPatterns({ loading: false, result: null, available: false }));
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="font-display text-2xl tracking-tight text-landing">Intel</h1>
      <p className="mt-1 text-sm text-muted">Interview coaching, follow-up cadence, and outcome patterns.</p>

      {/* Follow-up cadence */}
      <Section icon={Clock} title="Follow-up cadence">
        {cadence.loading ? (
          <Loading label="Computing cadence…" />
        ) : cadence.entries.length === 0 ? (
          <Empty>No follow-ups due.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface/60 text-xs uppercase tracking-wide text-faint">
                <tr><th className="px-3 py-2 font-medium">Company</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Action</th><th className="px-3 py-2 font-medium">Due</th></tr>
              </thead>
              <tbody>
                {cadence.entries.map((e, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-2">{e.company || "—"}</td>
                    <td className="px-3 py-2 text-muted">{e.status || "—"}</td>
                    <td className="px-3 py-2 text-muted">{e.action || (e as { recommendation?: string }).recommendation || "—"}</td>
                    <td className={cn("px-3 py-2 text-xs tabular-nums", /overdue|urgent/i.test(String(e.status)) ? "text-red-500" : "text-faint")}>
                      {e.due || (typeof e.days === "number" ? `${e.days}d` : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Rejection / outcome patterns */}
      <Section icon={TrendingDown} title="Outcome patterns">
        {patterns.loading ? (
          <Loading label="Analyzing outcomes…" />
        ) : !patterns.available ? (
          <Empty>Not enough evaluated/decided applications to analyze yet.</Empty>
        ) : (
          <PatternsResult result={patterns.result} />
        )}
      </Section>

      {/* Coach state */}
      {!coach ? (
        <Section icon={BookOpen} title="Interview coach">
          <Empty>No coaching state found (interview-coach-skill not set up for this candidate).</Empty>
        </Section>
      ) : (
        <>
          {coach.strategy.length > 0 && (
            <Section icon={Target} title="Active coaching strategy">
              <Bullets items={coach.strategy} />
            </Section>
          )}

          {coach.loops.length > 0 && (
            <Section icon={Building2} title="Active interview loops">
              <div className="flex flex-wrap gap-1.5">
                {coach.loops.map((l, i) => (
                  <span key={i} className="rounded-md bg-brand-soft px-2 py-1 text-xs text-brand">{l}</span>
                ))}
              </div>
            </Section>
          )}

          {coach.stories.length > 0 && (
            <Section icon={BookOpen} title={`Storybank (${coach.stories.length})`}>
              <div className="grid gap-2 sm:grid-cols-2">
                {coach.stories.map((s) => (
                  <div key={s.id} className="rounded-xl border border-border bg-surface/50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-brand">{s.id}</span>
                      <span className="text-[10px] uppercase tracking-wide text-faint">{s.strength}</span>
                    </div>
                    <p className="mt-0.5 text-sm font-medium">{s.title}</p>
                    <p className="mt-1 text-xs text-muted">{[s.skill, s.skill2].filter(Boolean).join(" · ")}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {(coach.effectivePatterns.length > 0 || coach.ineffectivePatterns.length > 0) && (
            <Section icon={TrendingUp} title="What works / what doesn't">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400"><TrendingUp className="size-3.5" /> Effective</p>
                  <Bullets items={coach.effectivePatterns} muted />
                </div>
                <div>
                  <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-red-500"><TrendingDown className="size-3.5" /> Ineffective</p>
                  <Bullets items={coach.ineffectivePatterns} muted />
                </div>
              </div>
            </Section>
          )}

          {coach.companyPatterns.length > 0 && (
            <Section icon={Building2} title="Company patterns">
              <div className="space-y-2">
                {coach.companyPatterns.map((c, i) => (
                  <details key={i} className="rounded-xl border border-border bg-surface/50 p-3">
                    <summary className="cursor-pointer text-sm font-medium">{c.company}</summary>
                    <p className="mt-2 whitespace-pre-wrap text-xs text-muted">{c.body}</p>
                  </details>
                ))}
              </div>
            </Section>
          )}

          {coach.questions.length > 0 && (
            <Section icon={MessagesSquare} title={`Question bank (${coach.questions.length})`}>
              <div className="space-y-1.5">
                {coach.questions.map((qn, i) => (
                  <div key={i} className="rounded-lg bg-surface/50 px-3 py-2 text-sm">
                    <p>{qn.question}</p>
                    <p className="mt-0.5 text-xs text-faint">{[qn.company, qn.round, qn.competency, qn.outcome].filter(Boolean).join(" · ")}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {coach.outcomes.length > 0 && (
            <Section icon={Trophy} title="Outcome log">
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface/60 text-xs uppercase tracking-wide text-faint">
                    <tr><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Company</th><th className="px-3 py-2 font-medium">Round</th><th className="px-3 py-2 font-medium">Result</th></tr>
                  </thead>
                  <tbody>
                    {coach.outcomes.map((o, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2 text-xs tabular-nums text-faint">{o.date}</td>
                        <td className="px-3 py-2">{o.company}</td>
                        <td className="px-3 py-2 text-muted">{o.round}</td>
                        <td className="px-3 py-2">{o.result}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {(coach.drillStage !== "?" || coach.drillQueue) && (
            <Section icon={Dumbbell} title="Drill progression">
              <p className="text-sm text-muted">
                Stage <span className="font-medium text-foreground">{coach.drillStage}</span>
                {coach.gatesPassed && <span> · gates passed: {coach.gatesPassed}</span>}
              </p>
              {coach.drillQueue && <p className="mt-1 text-xs text-faint">Revisit: {coach.drillQueue}</p>}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function PatternsResult({ result }: { result: unknown }) {
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    const lists = Object.entries(r).filter(([, v]) => Array.isArray(v) && (v as unknown[]).length);
    if (lists.length > 0) {
      return (
        <div className="space-y-4">
          {lists.map(([k, v]) => (
            <div key={k}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{k.replace(/_/g, " ")}</p>
              <Bullets items={(v as unknown[]).map((x) => (typeof x === "string" ? x : JSON.stringify(x)))} muted />
            </div>
          ))}
        </div>
      );
    }
  }
  return <pre className="overflow-auto rounded-xl border border-border bg-surface/50 p-3 text-xs text-muted">{JSON.stringify(result, null, 2)}</pre>;
}

function Section({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        <Icon className="size-3.5" /> {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Bullets({ items, muted }: { items: string[]; muted?: boolean }) {
  if (items.length === 0) return <Empty>—</Empty>;
  return (
    <ul className="space-y-1">
      {items.map((it, i) => (
        <li key={i} className={cn("flex items-start gap-2 text-sm", muted ? "text-muted" : "text-foreground")}>
          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-brand/60" /> {it}
        </li>
      ))}
    </ul>
  );
}

function Loading({ label }: { label: string }) {
  return <p className="flex items-center gap-2 text-sm text-faint"><Loader2 className="size-4 animate-spin" /> {label}</p>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border bg-surface/30 px-4 py-6 text-center text-sm text-muted">{children}</p>;
}
