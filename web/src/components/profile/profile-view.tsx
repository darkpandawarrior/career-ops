"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  UserRound,
  Target,
  Sparkles,
  Wallet,
  MapPin,
  Languages,
  FileText,
  ScrollText,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { FullProfile, ProfileMdSection } from "@/lib/full-profile";

type ApiResponse = { exists: boolean; profile: FullProfile; sections: ProfileMdSection[] };
type State = { loading: boolean; data: ApiResponse | null; error: string };

const FIT_TONE: Record<string, "good" | "warn" | "muted"> = {
  primary: "good",
  secondary: "warn",
  adjacent: "muted",
};

export function ProfileView() {
  const [state, setState] = useState<State>({ loading: true, data: null, error: "" });

  useEffect(() => {
    fetch("/api/profile/full")
      .then((r) => r.json())
      .then((d: ApiResponse) => setState({ loading: false, data: d, error: "" }))
      .catch(() => setState({ loading: false, data: null, error: "Couldn't load the profile." }));
  }, []);

  if (state.loading) {
    return <Loading label="Loading profile…" />;
  }
  if (state.error || !state.data) {
    return <Empty>{state.error || "Couldn't load the profile."}</Empty>;
  }
  if (!state.data.exists) {
    return (
      <Empty>
        No <code className="text-foreground">config/profile.yml</code> yet. Onboard first (chat with the assistant,
        or run <code className="text-foreground">/career-ops</code> onboarding) to create one.
      </Empty>
    );
  }

  const { profile, sections } = state.data;
  const sectionByTitle = (needle: string) => sections.find((s) => s.title.toLowerCase().includes(needle.toLowerCase()));

  return (
    <div className="space-y-8">
      {/* Candidate */}
      <Section icon={UserRound} title="Candidate">
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" value={profile.candidate.full_name} />
            <Field label="Email" value={profile.candidate.email} />
            <Field label="Phone" value={profile.candidate.phone} />
            <Field label="Location" value={profile.candidate.location} />
            <Field label="LinkedIn" value={profile.candidate.linkedin} />
            <Field label="Portfolio" value={profile.candidate.portfolio_url} />
            <Field label="GitHub" value={profile.candidate.github} />
            <Field label="Twitter/X" value={profile.candidate.twitter} />
          </div>
        </Card>
      </Section>

      {/* Target roles & archetypes */}
      <Section icon={Target} title="Target roles & archetypes">
        <Card>
          <p className="text-[11px] uppercase tracking-wide text-faint">Primary roles</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {profile.target_roles.primary.length
              ? profile.target_roles.primary.map((r) => (
                  <span key={r} className="rounded-md bg-brand-soft px-2 py-1 text-xs text-brand">{r}</span>
                ))
              : <span className="text-sm text-muted">—</span>}
          </div>

          {profile.target_roles.archetypes.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface/60 text-xs uppercase tracking-wide text-faint">
                  <tr>
                    <th className="px-3 py-2 font-medium">Archetype</th>
                    <th className="px-3 py-2 font-medium">Level</th>
                    <th className="px-3 py-2 font-medium">Fit</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.target_roles.archetypes.map((a, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{a.name}</td>
                      <td className="px-3 py-2 text-muted">{a.level || "—"}</td>
                      <td className="px-3 py-2">
                        <Badge tone={FIT_TONE[a.fit] ?? "muted"}>{a.fit || "—"}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>

      {/* Narrative */}
      <Section icon={Sparkles} title="Narrative">
        <Card>
          <Field label="Headline" value={profile.narrative.headline} block />
          <Field label="Exit story" value={profile.narrative.exit_story} block className="mt-3" />

          <p className="mt-4 text-[11px] uppercase tracking-wide text-faint">Superpowers</p>
          {profile.narrative.superpowers.length ? (
            <ul className="mt-1.5 space-y-1">
              {profile.narrative.superpowers.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-brand/60" /> {s}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted">—</p>
          )}

          {profile.narrative.proof_points.length > 0 && (
            <>
              <p className="mt-4 text-[11px] uppercase tracking-wide text-faint">Proof points</p>
              <div className="mt-1.5 space-y-1.5">
                {profile.narrative.proof_points.map((p, i) => (
                  <div key={i} className="rounded-lg bg-surface/50 px-3 py-2 text-sm">
                    <span className="font-medium">{p.name}</span>
                    {p.hero_metric && <span className="ml-2 text-muted">{p.hero_metric}</span>}
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noreferrer" className="ml-2 text-xs text-brand underline">
                        {p.url}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </Section>

      {/* Compensation */}
      <Section icon={Wallet} title="Compensation">
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Target range" value={profile.compensation.target_range} />
            <Field label="Currency" value={profile.compensation.currency} />
            <Field label="Walk-away minimum" value={profile.compensation.minimum} />
            <Field label="Location flexibility" value={profile.compensation.location_flexibility} />
          </div>
        </Card>
      </Section>

      {/* Location & visa */}
      <Section icon={MapPin} title="Location & visa">
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Country" value={profile.location.country} />
            <Field label="City" value={profile.location.city} />
            <Field label="Timezone" value={profile.location.timezone} />
            <Field label="Visa status" value={profile.location.visa_status} />
            {profile.location.onsite_availability && (
              <Field label="On-site availability" value={profile.location.onsite_availability} />
            )}
          </div>
        </Card>
      </Section>

      {/* Cover letter / notice / languages */}
      <Section icon={Languages} title="Cover letter & languages">
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Notice period"
              value={profile.cover_letter.notice_period_days != null ? `${profile.cover_letter.notice_period_days} days` : ""}
            />
            <Field label="Primary domain" value={profile.cover_letter.primary_domain} />
          </div>
          {profile.cover_letter.language_learning.length > 0 && (
            <div className="mt-4 space-y-2">
              {profile.cover_letter.language_learning.map((l, i) => (
                <div key={i} className="rounded-lg bg-surface/50 px-3 py-2 text-sm">
                  <p>
                    <span className="font-medium">{l.language}</span>{" "}
                    <span className="text-muted">{l.current_level} → {l.target_level} by {l.target_date}</span>
                  </p>
                  {l.countries.length > 0 && (
                    <p className="mt-0.5 text-xs text-faint">Trigger countries: {l.countries.join(", ")}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </Section>

      {/* Output / spend settings */}
      <Section icon={FileText} title="Output & model settings">
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Output language" value={profile.language.output} />
            <Field label="Modes dir override" value={profile.language.modes_dir} />
            <Field label="CV output format" value={profile.cv.output_format} />
            <Field label="Spend tier" value={profile.spend_tier} />
          </div>
        </Card>
      </Section>

      {/* Prose sections from modes/_profile.md */}
      {sections.length > 0 && (
        <Section icon={ScrollText} title="Profile narrative (modes/_profile.md)">
          <p className="mb-3 text-xs text-muted">
            The richer prose content the AI reads when framing you for a role — archetypes, comp tiers, negotiation
            scripts, known gaps. Edit <code className="text-foreground">modes/_profile.md</code> directly to change it.
          </p>
          <div className="space-y-2">
            {sections.map((s, i) => (
              <details
                key={i}
                className="group rounded-xl border border-border bg-surface/50 p-3"
                open={i === 0 || /gap|negotiat|comp/i.test(s.title)}
              >
                <summary className="cursor-pointer list-none text-sm font-medium text-foreground">{s.title}</summary>
                <article className="report-prose mt-2 border-t border-border pt-2 text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.body}</ReactMarkdown>
                </article>
              </details>
            ))}
          </div>
        </Section>
      )}

      {sections.length === 0 && !sectionByTitle("") && (
        <Empty>No modes/_profile.md prose content found (or the file is missing).</Empty>
      )}
    </div>
  );
}

function Field({ label, value, block, className }: { label: string; value: string; block?: boolean; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[11px] uppercase tracking-wide text-faint">{label}</p>
      <p className={cn("mt-1 text-sm text-foreground", !value && "text-muted", block && "whitespace-pre-wrap")}>
        {value || "—"}
      </p>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        <Icon className="size-3.5" /> {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <p className="flex items-center gap-2 text-sm text-faint"><Loader2 className="size-4 animate-spin" /> {label}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border bg-surface/30 px-4 py-6 text-center text-sm text-muted">{children}</p>;
}
