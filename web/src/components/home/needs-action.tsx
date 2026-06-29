"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlarmClock, ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { CompanyLogo } from "@/components/company-logo";

type FollowupEntry = {
  num?: number;
  company: string;
  role?: string;
  status?: string;
  urgency?: string;
  nextFollowupDate?: string;
  daysUntilNext?: number;
};

// The DEMAND loop, prioritized (client, /api/followups — profile-aware route).
// Overdue/urgent first (the route already sorts), each row a compact company ·
// role · urgency · next-date delta. Empty → renders nothing (the section hides).
export function NeedsAction() {
  const [entries, setEntries] = useState<FollowupEntry[]>([]);
  const router = useRouter();

  useEffect(() => {
    const load = () => {
      fetch("/api/followups")
        .then((r) => r.json())
        .then((d) => setEntries(Array.isArray(d.entries) ? d.entries : []))
        .catch(() => {});
    };
    load();
    const onDone = () => {
      router.refresh();
      load();
    };
    window.addEventListener("co-job-done", onDone);
    return () => window.removeEventListener("co-job-done", onDone);
  }, [router]);

  if (entries.length === 0) return null;

  return (
    <Section title="Needs action today" hint="Follow-ups due · keep applications alive" cta={{ href: "/pipeline", label: "Open pipeline" }}>
      <div className="grid gap-2">
        {entries.map((e, i) => (
          <Link
            key={`${e.num ?? "x"}-${e.company}-${i}`}
            href="/pipeline"
            className="group flex min-w-0 items-center gap-3 rounded-xl border border-border bg-surface/40 px-3.5 py-3 transition hover:border-brand/30"
          >
            <CompanyLogo name={e.company} size={22} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <span className="font-medium text-foreground">{e.company}</span>
                {e.role && <span className="text-muted"> · {e.role}</span>}
              </p>
              {e.status && <p className="truncate text-[11px] text-faint">{e.status}</p>}
            </div>
            <UrgencyPill urgency={e.urgency} days={e.daysUntilNext} date={e.nextFollowupDate} />
            <ArrowRight className="size-4 shrink-0 text-faint transition group-hover:text-brand" />
          </Link>
        ))}
      </div>
    </Section>
  );
}

function UrgencyPill({ urgency, days, date }: { urgency?: string; days?: number; date?: string }) {
  const overdue = (typeof days === "number" && days < 0) || /overdue/i.test(urgency ?? "");
  const urgent = overdue || /urgent|today|due/i.test(urgency ?? "");
  const label =
    typeof days === "number"
      ? days < 0
        ? `${Math.abs(days)}d overdue`
        : days === 0
          ? "due today"
          : `in ${days}d`
      : (urgency || date || "due");
  return (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums",
        overdue
          ? "bg-red-500/10 text-red-600 dark:text-red-400"
          : urgent
            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
            : "bg-surface-hover text-muted",
      )}
    >
      {label}
    </span>
  );
}

function Section({
  title,
  hint,
  cta,
  children,
}: {
  title: string;
  hint: string;
  cta?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <AlarmClock className="size-4 text-brand" />
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">{title}</h2>
        <span className="text-xs text-faint">· {hint}</span>
        {cta && (
          <Link href={cta.href} className="ml-auto text-xs text-muted transition hover:text-brand">
            {cta.label} →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
