"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, BookOpen, Target, MessagesSquare, Trophy, Dumbbell, Building2, Clock, TrendingUp, TrendingDown, Wallet, Zap, HeartPulse, NotebookPen, History, UserRound, FileText, PlayCircle, Mail, Users, BarChart3 } from "lucide-react";
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

  useEffect(() => {
    fetch("/api/cadence").then((r) => r.json()).then((d) =>
      setCadence({ loading: false, entries: Array.isArray(d.entries) ? d.entries : [], available: !!d.available }),
    ).catch(() => setCadence({ loading: false, entries: [], available: false }));
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="font-display text-2xl tracking-tight text-landing">Intel</h1>
      <p className="mt-1 text-sm text-muted">Interview coaching, storybank, and follow-up cadence.</p>

      {/* CLI-only modes with no dedicated UI — pre-seed the assistant instead of
          building a bespoke surface for each (same chat-dispatch model as the
          onboarding banner's "co-assistant" kickoff). */}
      <div className="mt-4 flex flex-wrap gap-2">
        <RunModeButton icon={PlayCircle} label="Run interview practice" message="Run interview/practice mode — start a live mock-interview practice loop with me now." />
        <RunModeButton icon={Mail} label="Scan inbox for updates" message="Run email-sweep mode — scan my inbox for rejection/interview/offer emails and match them to the tracker." />
        <RunModeButton icon={Users} label="Draft LinkedIn outreach" message="Run contacto mode — help me draft LinkedIn outreach for a role I'm targeting." />
      </div>

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

      {/* Rejection/outcome pattern analysis ("why am I being rejected") lives on
          Analytics now, next to the funnel + score charts it's derived from. */}
      <Link
        href="/analytics#patterns"
        className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-surface/40 px-4 py-3 text-sm transition-colors hover:border-brand/40 hover:bg-brand-soft"
      >
        <span className="flex min-w-0 items-center gap-2 text-muted">
          <BarChart3 className="size-4 shrink-0 text-brand" />
          Looking for rejection patterns and &ldquo;why am I being rejected&rdquo;? That&apos;s on <span className="font-medium text-foreground">Analytics</span> now.
        </span>
        <span className="ml-auto shrink-0 text-xs font-medium text-brand">View →</span>
      </Link>

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

/** Opens the assistant console and pre-seeds it with a mode request — reuses the
 *  existing "co-assistant" CustomEvent kickoff (see onboarding-banner.tsx) instead
 *  of building a bespoke UI for each CLI-only mode. */
function RunModeButton({ icon: Icon, label, message }: { icon: React.ComponentType<{ className?: string }>; label: string; message: string }) {
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent("co-assistant", { detail: { message } }))}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/60 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-brand"
    >
      <Icon className="size-3.5" /> {label}
    </button>
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
