"use client";

import { useState } from "react";
import Link from "next/link";
import { useRef } from "react";
import { FileText, Sparkles, Check, AlertTriangle, Loader2, ArrowRight, ArrowLeft, UploadCloud, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { BASE_OPTION_CATALOG, COUNTRY_CATALOG, INDUSTRY_CATALOG, REGION_CATALOG, SKILL_CATALOG, rolesForIndustries, skillsForRoles } from "@/lib/onboarding/catalog";

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
const SENIORITY_OPTIONS = ["entry-level", "mid", "senior", "lead", "staff", "principal", "director", "vp", "c-level"] as const;
const CURRENCY_OPTIONS = ["USD", "EUR", "GBP", "INR", "CAD", "AUD", "SGD", "AED", "Other"] as const;
const RELOCATIONS = ["unknown", "open", "no", "relocating"] as const;

export function OnboardingFlow() {
  const [step, setStep] = useState<Step>("paste");
  const [text, setText] = useState("");
  const [sourceText, setSourceText] = useState("");
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
      setSourceText(text);
      setReview(d.prefill as Review);
      setWarnings(Array.isArray(d.warnings) ? d.warnings : []);
      setStep("review");
    } catch {
      setError("Network error talking to the inference engine.");
    } finally {
      setBusy(false);
    }
  };

  const extractFromFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/onboarding/extract", { method: "POST", body: fd });
      const d = await r.json();
      if (!d.ok) {
        setError(d.error || "Could not read that PDF.");
        return;
      }
      setSourceText(d.text || "");
      setReview(d.prefill as Review);
      setWarnings(Array.isArray(d.warnings) ? d.warnings : []);
      setStep("review");
    } catch {
      setError("Network error reading the file.");
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
        body: JSON.stringify({ text: sourceText || text, review }),
      });
      const d = await r.json();
      if (!d.ok) {
        setError(d.errors?.length ? d.errors.join(" Â· ") : d.error || "Activation failed.");
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
            Upload your resume PDF (or paste the text). HireSignal&rsquo;s inference engine drafts your
            targets, skills and seniority â€” you review before anything is written.
          </p>

          <ResumeDropZone busy={busy} onFile={extractFromFile} />

          <div className="my-4 flex items-center gap-3 text-xs text-faint">
            <span className="h-px flex-1 bg-border" /> or paste text <span className="h-px flex-1 bg-border" />
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            placeholder="Paste your full resume hereâ€¦"
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

          <ReviewForm
            review={review}
            setReview={setReview}
            onActivate={activate}
            onBack={() => setStep("paste")}
            busy={busy}
            error={error}
          />
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

function ResumeDropZone({ busy, onFile }: { busy: boolean; onFile: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onFile(f);
  };
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
      className={cn(
        "mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors",
        drag ? "border-brand bg-brand-soft" : "border-border bg-surface/40 hover:border-brand/40 hover:bg-surface-hover",
        busy && "pointer-events-none opacity-60",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => pick(e.target.files)}
      />
      {busy ? <Loader2 className="size-6 animate-spin text-brand" /> : <UploadCloud className="size-6 text-brand" />}
      <span className="text-sm font-medium text-foreground">
        {busy ? "Reading your resumeâ€¦" : "Drop your resume PDF here, or click to browse"}
      </span>
      <span className="text-xs text-faint">PDF, up to 10MB Â· parsed locally, nothing is uploaded anywhere</span>
    </label>
  );
}

function ErrorNote({ msg }: { msg: string }) {
  return (
    <p className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {msg}
    </p>
  );
}

/* â”€â”€ Review form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const WIZ_STEPS = ["Candidate", "Targeting", "Skills", "Location", "Compensation", "Confirm"] as const;

function ReviewForm({
  review, setReview, onActivate, onBack, busy, error,
}: {
  review: Review;
  setReview: (r: Review) => void;
  onActivate: () => void;
  onBack: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [wiz, setWiz] = useState(0);
  const last = WIZ_STEPS.length - 1;
  const set = (patch: Partial<Review>) => setReview({ ...review, ...patch });
  const setC = (patch: Partial<Review["candidate"]>) => set({ candidate: { ...review.candidate, ...patch } });
  const setLoc = (patch: Partial<Review["location"]>) => set({ location: { ...review.location, ...patch } });
  const setSkills = (patch: Partial<Review["skills"]>) => set({ skills: { ...review.skills, ...patch } });
  const setDomains = (domains: string[]) => set({ preferences: { ...review.preferences, domains } });
  const roleOptions = rolesForIndustries(review.preferences.domains);
  const skillOptions = skillsForRoles(review.target_roles, review.preferences.domains);

  const toggleScope = (scope: string) => {
    const has = review.location.search_scopes.includes(scope);
    setLoc({
      search_scopes: has
        ? review.location.search_scopes.filter((s) => s !== scope)
        : [...review.location.search_scopes, scope],
    });
  };

  return (
    <div className="mt-5">
      {/* wizard progress */}
      <div className="flex items-center gap-1.5">
        {WIZ_STEPS.map((t, i) => (
          <button
            key={t}
            onClick={() => setWiz(i)}
            className="group flex flex-1 flex-col gap-1"
            title={t}
          >
            <span className={cn("h-1 rounded-full transition-colors", i <= wiz ? "bg-brand" : "bg-border")} />
            <span className={cn("hidden text-[10px] sm:block", i === wiz ? "text-brand" : "text-faint")}>{t}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-faint">Step {wiz + 1} of {WIZ_STEPS.length} Â· {WIZ_STEPS[wiz]}</p>

      <div className="mt-4 space-y-6">
      {wiz === 0 && (
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
      )}

      {wiz === 1 && (
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
            <Select value={review.seniority} onChange={(v) => set({ seniority: v })} options={["", ...SENIORITY_OPTIONS] as readonly string[]} />
          </Field>
        </div>
        <Field label="Target roles" req hint="comma-separated; at least one">
          <CatalogMultiSelect value={review.target_roles} onChange={(v) => set({ target_roles: v })} options={roleOptions} placeholder="Search roles" />
        </Field>
        <Field label="Adjacent roles">
          <CatalogMultiSelect value={review.adjacent_roles} onChange={(v) => set({ adjacent_roles: v })} options={roleOptions} placeholder="Search adjacent roles" />
        </Field>
        <Field label="Preferred industries">
          <CatalogMultiSelect value={review.preferences.domains} onChange={setDomains} options={INDUSTRY_CATALOG} placeholder="Search industries" />
        </Field>
      </Group>
      )}

      {wiz === 2 && (
      <Group title="Skills">
        <Field label="Demonstrated" req hint="at least five â€” these drive scoring">
          <CatalogMultiSelect value={review.skills.demonstrated} onChange={(v) => setSkills({ demonstrated: v })} options={skillOptions} placeholder="Search skills" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Supporting"><CatalogMultiSelect value={review.skills.supporting} onChange={(v) => setSkills({ supporting: v })} options={skillOptions} placeholder="Search skills" /></Field>
          <Field label="Excluded (deal-breakers)"><CatalogMultiSelect value={review.skills.excluded} onChange={(v) => setSkills({ excluded: v })} options={skillOptions} placeholder="Search skills" /></Field>
        </div>
      </Group>
      )}

      {wiz === 3 && (
      <Group title="Location & availability">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Home country" req><CatalogSingleSelect value={review.location.home_country} onChange={(v) => setLoc({ home_country: v })} options={COUNTRY_CATALOG} placeholder="Search country" /></Field>
          <Field label="Notice period" req><Select value={review.availability.notice_period} onChange={(v) => set({ availability: { notice_period: v } })} options={["", ...BASE_OPTION_CATALOG.noticePeriods] as readonly string[]} /></Field>
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
            <CatalogMultiSelect value={review.location.international_locations} onChange={(v) => setLoc({ international_locations: v })} options={[...COUNTRY_CATALOG, ...REGION_CATALOG]} placeholder="Search locations" />
          </Field>
        )}
      </Group>
      )}

      {wiz === 4 && (
      <Group title="Compensation (optional)">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Currency"><Select value={review.compensation.currency} onChange={(v) => set({ compensation: { ...review.compensation, currency: v } })} options={["", ...CURRENCY_OPTIONS] as readonly string[]} /></Field>
          <Field label="Minimum / yr">
            <Text type="number" value={review.compensation.minimum_annual ?? ""} onChange={(v) => set({ compensation: { ...review.compensation, minimum_annual: v === "" ? null : Number(v) } })} />
          </Field>
          <Field label="Target / yr">
            <Text type="number" value={review.compensation.target_annual ?? ""} onChange={(v) => set({ compensation: { ...review.compensation, target_annual: v === "" ? null : Number(v) } })} />
          </Field>
        </div>
      </Group>
      )}

      {wiz === last && (
        <Group title="Confirm & activate">
          <dl className="space-y-2 text-sm">
            <SummaryRow label="Name" value={review.candidate.full_name} />
            <SummaryRow label="Seniority" value={`${review.seniority || "â€”"} Â· ${review.experience_years ?? "?"} yrs`} />
            <SummaryRow label="Target roles" value={review.target_roles.join(", ") || "â€”"} />
            <SummaryRow label="Demonstrated skills" value={`${review.skills.demonstrated.length} (${review.skills.demonstrated.slice(0, 5).join(", ")}${review.skills.demonstrated.length > 5 ? "â€¦" : ""})`} />
            <SummaryRow label="Location" value={`${review.location.home_country || "â€”"} Â· ${review.location.search_scopes.join("/") || "â€”"} Â· notice ${review.availability.notice_period || "â€”"}`} />
          </dl>
          <p className="mt-3 text-xs text-faint">
            Activating writes cv.md, config/profile.yml, config/job-search.yml, modes/_profile.md and
            portals.yml into the active profile (any existing files are archived first).
          </p>
        </Group>
      )}
      </div>

      {error && <ErrorNote msg={error} />}

      {/* wizard nav */}
      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={() => (wiz === 0 ? onBack() : setWiz(wiz - 1))}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted hover:bg-surface-hover"
        >
          <ArrowLeft className="size-4" /> {wiz === 0 ? "Back" : "Previous"}
        </button>
        {wiz < last ? (
          <button
            onClick={() => setWiz(wiz + 1)}
            className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200"
          >
            Next <ArrowRight className="size-4" />
          </button>
        ) : (
          <button
            onClick={onActivate}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Activate profile
          </button>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-32 shrink-0 text-xs uppercase tracking-wide text-faint">{label}</dt>
      <dd className="flex-1 text-foreground">{value}</dd>
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
        {hint && <span className="text-faint"> â€” {hint}</span>}
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

function CatalogSingleSelect({
  value, onChange, options, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState(value);
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
        <input
          value={query}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            onChange(next);
          }}
          placeholder={placeholder}
          list={`${placeholder ?? "catalog"}-options`}
          className="w-full rounded-md border border-border bg-surface py-1.5 pl-9 pr-8 text-sm outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              onChange("");
            }}
            className="absolute right-2 top-2 rounded p-0.5 text-faint hover:text-foreground"
            aria-label="Clear selection"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <datalist id={`${placeholder ?? "catalog"}-options`}>
        {options.map((option) => <option key={option} value={option} />)}
      </datalist>
    </div>
  );
}

function CatalogMultiSelect({
  value, onChange, options, placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  options: readonly string[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const add = (item: string) => {
    const next = item.trim();
    if (!next) return;
    const exists = value.some((v) => v.toLowerCase() === next.toLowerCase());
    if (!exists) onChange([...value, next]);
    setQuery("");
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onChange(value.filter((v) => v !== item))}
            className="inline-flex items-center gap-1 rounded-full border border-brand/25 bg-brand-soft px-2.5 py-1 text-xs text-brand hover:border-brand/40"
            title="Click to remove"
          >
            {item} <X className="size-3" />
          </button>
        ))}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(query);
            }
          }}
          placeholder={placeholder}
          list={`${placeholder ?? "catalog"}-multi-options`}
          className="w-full rounded-md border border-border bg-surface py-1.5 pl-9 pr-3 text-sm outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
        />
      </div>
      <div className="max-h-36 overflow-auto rounded-md border border-border bg-surface/60 p-1">
        <div className="flex flex-wrap gap-1.5">
          {options
            .filter((option) => !value.some((v) => v.toLowerCase() === option.toLowerCase()))
            .filter((option) => option.toLowerCase().includes(query.trim().toLowerCase()))
            .slice(0, 12)
            .map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => add(option)}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-muted hover:border-brand/40 hover:text-foreground"
              >
                {option}
              </button>
            ))}
        </div>
      </div>
      <datalist id={`${placeholder ?? "catalog"}-multi-options`}>
        {options.map((option) => <option key={option} value={option} />)}
      </datalist>
    </div>
  );
}







