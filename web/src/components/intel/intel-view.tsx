"use client";

import { useEffect, useState } from "react";
import { Loader2, BookOpen, Target, MessagesSquare, Trophy, Dumbbell, Building2, Clock, TrendingUp, TrendingDown, Wallet, Zap, HeartPulse, NotebookPen, History, UserRound, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";
import type { CoachState } from "@/lib/coach";
import type { ProfileMeta } from "@/lib/profile-meta";

type CadenceEntry = {
  company?: string;
  role?: string;
  status?: string;
  urgency?: string;
  nextFollowupDate?: string;
  daysUntilNext?: number;
  daysSinceApplication?: number;
  [k: string]: unknown;
};

function urgencyTone(u?: string): string {
  const k = (u || "").toLowerCase();
  if (k.includes("overdue") || k.includes("urgent")) return "text-red-500";
  if (k.includes("soon") || k.includes("due")) return "text-amber-600 dark:text-amber-400";
  return "text-faint";
}

export function IntelView({ coach, profile }: { coach: CoachState | null; profile?: ProfileMeta | null }) {
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

      {profile && <ProfileBanner profile={profile} />}

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
                <tr>
                  <th className="px-3 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Urgency</th>
                  <th className="px-3 py-2 font-medium">Next follow-up</th>
                </tr>
              </thead>
              <tbody>
                {cadence.entries.map((e, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{e.company || "—"}</td>
                    <td className="px-3 py-2 text-muted">{e.role || "—"}</td>
                    <td className="px-3 py-2 capitalize text-muted">{e.status || "—"}</td>
                    <td className={cn("px-3 py-2 text-xs font-medium capitalize", urgencyTone(e.urgency))}>{e.urgency || "—"}</td>
                    <td className="px-3 py-2 text-xs tabular-nums text-faint">
                      {e.nextFollowupDate || "—"}
                      {typeof e.daysUntilNext === "number" && (
                        <span className={cn("ml-1", e.daysUntilNext < 0 ? "text-red-500" : "text-faint")}>
                          ({e.daysUntilNext < 0 ? `${-e.daysUntilNext}d overdue` : `in ${e.daysUntilNext}d`})
                        </span>
                      )}
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
                {coach.stories.map((s) => {
                  const detail = coach.details[s.id];
                  return (
                    <details key={s.id} className="group rounded-xl border border-border bg-surface/50 p-3">
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-brand">{s.id}</span>
                          <span className="text-[10px] uppercase tracking-wide text-faint">{s.strength}</span>
                        </div>
                        <p className="mt-0.5 text-sm font-medium">{s.title}</p>
                        <p className="mt-1 text-xs text-muted">{[s.skill, s.skill2].filter(Boolean).join(" · ")}</p>
                      </summary>
                      {detail?.body && (
                        <p className="mt-2 whitespace-pre-wrap border-t border-border pt-2 text-xs text-muted">{detail.body}</p>
                      )}
                    </details>
                  );
                })}
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

          {coach.coachingNotes.length > 0 && (
            <Section icon={NotebookPen} title="Coaching notes">
              <Bullets items={coach.coachingNotes} muted />
            </Section>
          )}

          {coach.sessionLog.length > 0 && (
            <Section icon={History} title="Session log">
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface/60 text-xs uppercase tracking-wide text-faint">
                    <tr><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Commands</th><th className="px-3 py-2 font-medium">Outcomes</th></tr>
                  </thead>
                  <tbody>
                    {coach.sessionLog.map((s, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2 text-xs tabular-nums text-faint">{s.date}</td>
                        <td className="px-3 py-2 text-muted">{s.commands}</td>
                        <td className="px-3 py-2 text-muted">{s.outcomes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {coach.profileBullets.length > 0 && (
            <Section icon={UserRound} title="Coach profile">
              <Bullets items={coach.profileBullets} muted />
            </Section>
          )}
        </>
      )}

      <CvSection />
    </div>
  );
}

/** Collapsible canonical CV viewer — fetches /api/cv on first expand, renders
 *  the markdown. Hidden gracefully when the CV is empty/absent. */
function CvSection() {
  const [state, setState] = useState<{ loaded: boolean; loading: boolean; content: string }>({ loaded: false, loading: false, content: "" });

  const load = () => {
    if (state.loaded || state.loading) return;
    setState((s) => ({ ...s, loading: true }));
    fetch("/api/cv")
      .then((r) => r.json())
      .then((d) => setState({ loaded: true, loading: false, content: typeof d.content === "string" ? d.content : "" }))
      .catch(() => setState({ loaded: true, loading: false, content: "" }));
  };

  return (
    <section className="mt-8">
      <details onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && load()}>
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-muted transition-colors hover:text-foreground">
          <FileText className="size-3.5" /> Canonical CV (cv.md)
        </summary>
        <div className="mt-3">
          {state.loading ? (
            <Loading label="Loading CV…" />
          ) : !state.content.trim() ? (
            <Empty>No cv.md found for this candidate.</Empty>
          ) : (
            <article className="report-prose rounded-2xl border border-border bg-surface/40 p-5">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{state.content}</ReactMarkdown>
            </article>
          )}
        </div>
      </details>
    </section>
  );
}

function ProfileBanner({ profile }: { profile: ProfileMeta }) {
  const [health, setHealth] = useState<{ loading: boolean; out: string | null }>({ loading: false, out: null });
  const runHealth = async () => {
    setHealth({ loading: true, out: null });
    try {
      const r = await fetch("/api/ops/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "pipeline-health" }),
      });
      const d = await r.json();
      setHealth({ loading: false, out: d.output || d.error || "(no output)" });
    } catch {
      setHealth({ loading: false, out: "Health check failed." });
    }
  };
  return (
    <div className="mt-5 rounded-2xl border border-border bg-surface/50 p-4">
      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-faint"><Wallet className="size-3" /> Target comp</p>
          <p className="mt-1 text-sm text-foreground">{profile.targetRange || "—"}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-faint">Archetypes</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {profile.archetypes.length
              ? profile.archetypes.slice(0, 5).map((a) => (
                  <span key={a.name} className={cn("rounded-md px-1.5 py-0.5 text-[11px]", a.fit === "primary" ? "bg-brand-soft text-brand" : "bg-surface-hover text-muted")}>
                    {a.name}
                  </span>
                ))
              : <span className="text-sm text-muted">{profile.primaryRoles.join(", ") || "—"}</span>}
          </div>
        </div>
        <div>
          <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-faint"><Zap className="size-3" /> Superpowers</p>
          <ul className="mt-1 space-y-0.5">
            {profile.superpowers.slice(0, 4).map((s, i) => (
              <li key={i} className="line-clamp-1 text-xs text-muted">{s}</li>
            ))}
            {profile.superpowers.length === 0 && <li className="text-sm text-muted">—</li>}
          </ul>
        </div>
        <div>
          <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-faint"><HeartPulse className="size-3" /> System</p>
          <button
            onClick={runHealth}
            disabled={health.loading}
            className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
          >
            {health.loading ? <Loader2 className="size-3.5 animate-spin" /> : <HeartPulse className="size-3.5" />} Health check
          </button>
        </div>
      </div>
      {health.out && (
        <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-border bg-surface/60 px-3 py-2 text-[11px] text-foreground/80 whitespace-pre-wrap">{health.out}</pre>
      )}
    </div>
  );
}

const titleCase = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()).trim();

function PatternsResult({ result }: { result: unknown }) {
  if (!result || typeof result !== "object") {
    return <pre className="overflow-auto rounded-xl border border-border bg-surface/50 p-3 text-xs text-muted">{JSON.stringify(result, null, 2)}</pre>;
  }
  const r = result as Record<string, unknown>;
  const isScalar = (v: unknown) => v == null || ["string", "number", "boolean"].includes(typeof v);
  const scalarObj = (v: unknown): v is Record<string, string | number> =>
    !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v as object).every(isScalar);

  return (
    <div className="space-y-5">
      {/* Hiring funnel */}
      {scalarObj(r.funnel) && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Funnel</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(r.funnel).map(([k, v]) => (
              <span key={k} className="rounded-md bg-surface-hover px-2 py-1 text-xs capitalize text-muted">
                {k} <span className="tabular-nums font-semibold text-foreground">{v}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {Array.isArray(r.recommendations) && r.recommendations.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Recommendations</p>
          <div className="space-y-2">
            {(r.recommendations as Record<string, unknown>[]).map((rec, i) => (
              <div key={i} className="rounded-xl border border-border bg-surface/50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{String(rec.action ?? "")}</p>
                  {rec.impact != null && (
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase",
                      String(rec.impact) === "high" ? "bg-brand-soft text-brand" : "bg-surface-hover text-faint")}>
                      {String(rec.impact)}
                    </span>
                  )}
                </div>
                {rec.reasoning != null && <p className="mt-1 text-xs text-muted">{String(rec.reasoning)}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Remaining sections: scalar-objects → chips; object-arrays → key/value rows */}
      {Object.entries(r)
        .filter(([k, v]) => !["funnel", "recommendations", "metadata"].includes(k) && !(Array.isArray(v) && v.length === 0))
        .map(([k, v]) => {
          if (scalarObj(v)) {
            return (
              <div key={k}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{titleCase(k)}</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(v).map(([kk, vv]) => (
                    <span key={kk} className="rounded-md bg-surface-hover px-2 py-1 text-xs text-muted">
                      {titleCase(kk)} <span className="tabular-nums font-semibold text-foreground">{String(vv)}</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          }
          if (Array.isArray(v)) {
            return (
              <div key={k}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{titleCase(k)}</p>
                <div className="space-y-1.5">
                  {(v as unknown[]).map((row, i) =>
                    row && typeof row === "object" ? (
                      <div key={i} className="rounded-lg bg-surface/50 px-3 py-2 text-xs text-muted">
                        {Object.entries(row as Record<string, unknown>).map(([kk, vv]) => (
                          <span key={kk} className="mr-3 inline-block">
                            <span className="text-faint">{titleCase(kk)}:</span>{" "}
                            <span className="text-foreground">{String(vv)}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div key={i} className="text-xs text-muted">{String(row)}</div>
                    ),
                  )}
                </div>
              </div>
            );
          }
          return null;
        })}
    </div>
  );
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
