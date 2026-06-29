"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Sparkles, Check, AlertTriangle, Loader2, ArrowRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/cn";

// Mirrors onboarding-cli.mjs `prefill` shape (the review form's working state).
type Review = {
  candidate: {
    full_name: string; email: string; phone: string; location: string;
    linkedin: string; github: string; portfolio_url: string;
  };
  summary: string;
  experience_years: number | null;
  seniority: string;
  target_roles: string[];
  adjacent_roles: string[];
  excluded_titles: string[];
  preferences: { domains: string[] };
  skills: {
    demonstrated: string[]; confirmed_unlisted: string[];
    supporting: string[]; learning: string[]; excluded: string[];
  };
  location: {
    home_country: string; preferred_locations: string[]; remote_regions: string[];
    relocation: string; search_scopes: string[]; international_locations: string[];
    visa_sponsorship_required: boolean;
  };
  availability: { notice_period: string };
  compensation: { currency: string; minimum_annual: number | null; target_annual: number | null };
};

type Step = "paste" | "review" | "done";
const SCOPES = ["local", "remote", "international"] as const;
const RELOCATIONS = ["unknown", "open", "no", "relocating"] as const;

export function OnboardingFlow() {
  const [step, setStep] = useState<Step>("paste");
  const [text, setText] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [result, setResult] = useState<{ written: string[]; archived: string[] } | null>(null);

  const infer = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/onboarding/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const d = await r.json();
      if (!d.ok) {
        setError(d.error || "Could not infer a profile from that text.");
        return;
      }
      setReview(d.prefill as Review);
      setWarnings(Array.isArray(d.warnings) ? d.warnings : []);
      setStep("review");
    } catch {
      setError("Network error talking to the inference engine.");
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/onboarding/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, review }),
      });
      const d = await r.json();
      if (!d.ok) {
        setError(d.errors?.length ? d.errors.join(" · ") : d.error || "Activation failed.");
        return;
      }
      setResult({ written: d.written ?? [], archived: d.archived ?? [] });
      setStep("done");
    } catch {
      setError("Network error during activation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Steps step={step} />

      {step === "paste" && (
        <section className="mt-8">
          <h1 className="font-display text-2xl tracking-tight text-landing">Set up your profile</h1>
          <p className="mt-1 text-sm text-muted">
            Paste your resume text. HireSignal&rsquo;s inference engine drafts your targets, skills and
            seniority — you review before anything is written.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            placeholder="Paste your full resume here…"
            className="mt-4 w-full resize-y rounded-xl border border-border bg-surface p-4 text-sm outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
          />
          {error && <ErrorNote msg={error} />}
          <div className="mt-4 flex justify-end">
            <button
              onClick={infer}
              disabled={busy || text.trim().length < 40}
              className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Infer profile
            </button>
          </div>
        </section>
      )}

      {step === "review" && review && (
        <section className="mt-8">
          <h1 className="font-display text-2xl tracking-tight text-landing">Review your profile</h1>
          <p className="mt-1 text-sm text-muted">
            Pre-filled from your resume. Complete the required fields (marked
            <span className="text-brand"> *</span>), then activate.
          </p>

          {warnings.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-muted">
              {warnings.map((w) => (
                <p key={w} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" /> {w}
                </p>
              ))}
            </div>
          )}

          <ReviewForm review={review} setReview={setReview} />

          {error && <ErrorNote msg={error} />}

          <div className="mt-6 flex items-center justify-between">
            <button
              onClick={() => setStep("paste")}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted hover:bg-surface-hover"
            >
              <ArrowLeft className="size-4" /> Back
            </button>
            <button
              onClick={activate}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Activate profile
            </button>
          </div>
        </section>
      )}

      {step === "done" && result && (
        <section className="mt-10 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/15">
            <Check className="size-6 text-emerald-500" />
          </div>
          <h1 className="mt-4 font-display text-2xl tracking-tight text-landing">Profile activated</h1>
          <p className="mt-1 text-sm text-muted">
            Wrote {result.written.length} files. Your scoring config is live.
            {result.archived.length > 0 && ` ${result.archived.length} previous file(s) archived to data/profile-archives/.`}
          </p>
          <ul className="mx-auto mt-4 max-w-xs space-y-1 text-left text-xs text-faint">
            {result.written.map((f) => (
              <li key={f} className="flex items-center gap-1.5">
                <Check className="size-3 text-emerald-500" /> {f}
              </li>
            ))}
          </ul>
          <div className="mt-6 flex items-center justify-center gap-2">
            <Link
              href="/board"
              className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:bg-brand-200"
            >
              See your job board <ArrowRight className="size-4" />
            </Link>
            <Link href="/" className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-muted hover:bg-surface-hover">
              Home
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const items: { key: Step; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: "paste", label: "Paste resume", icon: FileText },
    { key: "review", label: "Review", icon: Sparkles },
    { key: "done", label: "Activate", icon: Check },
  ];
  const idx = items.findIndex((i) => i.key === step);
  return (
    <ol className="flex items-center gap-2 text-xs">
      {items.map((it, i) => {
        const Icon = it.icon;
        const active = i === idx;
        const done = i < idx;
        return (
          <li key={it.key} className="flex items-center gap-2">
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1",
                active ? "bg-brand-soft text-brand" : done ? "text-emerald-500" : "text-faint",
              )}
            >
              <Icon className="size-3.5" /> {it.label}
            </span>
            {i < items.length - 1 && <span className="h-px w-5 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}

function ErrorNote({ msg }: { msg: string }) {
  return (
    <p className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {msg}
    </p>
  );
}

/* ── Review form ─────────────────────────────────────────────────────────── */

function ReviewForm({ review, setReview }: { review: Review; setReview: (r: Review) => void }) {
  const set = (patch: Partial<Review>) => setReview({ ...review, ...patch });
  const setC = (patch: Partial<Review["candidate"]>) => set({ candidate: { ...review.candidate, ...patch } });
  const setLoc = (patch: Partial<Review["location"]>) => set({ location: { ...review.location, ...patch } });
  const setSkills = (patch: Partial<Review["skills"]>) => set({ skills: { ...review.skills, ...patch } });

  const toggleScope = (scope: string) => {
    const has = review.location.search_scopes.includes(scope);
    setLoc({
      search_scopes: has
        ? review.location.search_scopes.filter((s) => s !== scope)
        : [...review.location.search_scopes, scope],
    });
  };

  return (
    <div className="mt-5 space-y-6">
      <Group title="Candidate">
        <Field label="Full name" req>
          <Text value={review.candidate.full_name} onChange={(v) => setC({ full_name: v })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email"><Text value={review.candidate.email} onChange={(v) => setC({ email: v })} /></Field>
          <Field label="Location"><Text value={review.candidate.location} onChange={(v) => setC({ location: v })} /></Field>
        </div>
        <Field label="Summary"><Text value={review.summary} onChange={(v) => set({ summary: v })} /></Field>
      </Group>

      <Group title="Targeting">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Years of experience" req>
            <Text
              type="number"
              value={review.experience_years ?? ""}
              onChange={(v) => set({ experience_years: v === "" ? null : Number(v) })}
            />
          </Field>
          <Field label="Seniority" req>
            <Text value={review.seniority} onChange={(v) => set({ seniority: v })} placeholder="senior / mid / entry-level" />
          </Field>
        </div>
        <Field label="Target roles" req hint="comma-separated; at least one">
          <ListInput value={review.target_roles} onChange={(v) => set({ target_roles: v })} />
        </Field>
        <Field label="Adjacent roles">
          <ListInput value={review.adjacent_roles} onChange={(v) => set({ adjacent_roles: v })} />
        </Field>
      </Group>

      <Group title="Skills">
        <Field label="Demonstrated" req hint="at least five — these drive scoring">
          <ListInput value={review.skills.demonstrated} onChange={(v) => setSkills({ demonstrated: v })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Supporting"><ListInput value={review.skills.supporting} onChange={(v) => setSkills({ supporting: v })} /></Field>
          <Field label="Excluded (deal-breakers)"><ListInput value={review.skills.excluded} onChange={(v) => setSkills({ excluded: v })} /></Field>
        </div>
      </Group>

      <Group title="Location & availability">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Home country" req><Text value={review.location.home_country} onChange={(v) => setLoc({ home_country: v })} /></Field>
          <Field label="Notice period" req><Text value={review.availability.notice_period} onChange={(v) => set({ availability: { notice_period: v } })} placeholder="2 weeks / 30 days" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Relocation" req>
            <Select value={review.location.relocation} onChange={(v) => setLoc({ relocation: v })} options={RELOCATIONS as readonly string[]} />
          </Field>
          <Field label="Search scopes" req hint="pick at least one">
            <div className="flex gap-1.5 pt-1.5">
              {SCOPES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleScope(s)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs capitalize transition-colors",
                    review.location.search_scopes.includes(s)
                      ? "border-brand/40 bg-brand-soft text-brand"
                      : "border-border text-muted hover:bg-surface-hover",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </Field>
        </div>
        {review.location.search_scopes.includes("international") && (
          <Field label="International locations" req hint="required for international scope">
            <ListInput value={review.location.international_locations} onChange={(v) => setLoc({ international_locations: v })} />
          </Field>
        )}
      </Group>

      <Group title="Compensation (optional)">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Currency"><Text value={review.compensation.currency} onChange={(v) => set({ compensation: { ...review.compensation, currency: v } })} placeholder="USD" /></Field>
          <Field label="Minimum / yr">
            <Text type="number" value={review.compensation.minimum_annual ?? ""} onChange={(v) => set({ compensation: { ...review.compensation, minimum_annual: v === "" ? null : Number(v) } })} />
          </Field>
          <Field label="Target / yr">
            <Text type="number" value={review.compensation.target_annual ?? ""} onChange={(v) => set({ compensation: { ...review.compensation, target_annual: v === "" ? null : Number(v) } })} />
          </Field>
        </div>
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-2xl border border-border bg-surface/40 p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted">{title}</legend>
      <div className="mt-2 space-y-3">{children}</div>
    </fieldset>
  );
}

function Field({ label, req, hint, children }: { label: string; req?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-muted">
        {label}
        {req && <span className="text-brand"> *</span>}
        {hint && <span className="text-faint"> — {hint}</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Text({
  value, onChange, type = "text", placeholder,
}: {
  value: string | number; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
    />
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm capitalize outline-none focus:border-brand/50"
    >
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

/** Comma-separated list editor (kept as text while editing; split on read). */
function ListInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [raw, setRaw] = useState(value.join(", "));
  return (
    <input
      value={raw}
      onChange={(e) => {
        setRaw(e.target.value);
        onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean));
      }}
      className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
    />
  );
}
