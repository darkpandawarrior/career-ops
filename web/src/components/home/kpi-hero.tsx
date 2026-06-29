import Link from "next/link";
import { Briefcase, ClipboardCheck, AlarmClock } from "lucide-react";
import { instrumentSerif } from "@/lib/fonts";
import { HeroGlow } from "@/components/hero-glow";

// Command-center masthead (server, lightweight props): candidate identity +
// three live KPI tiles. The numbers are derived once on the server from the
// canonical files (no client fetch for the hero) so the page paints the
// headline state immediately. Each tile deep-links into the matching surface.
export function KpiHero({
  name,
  headline,
  dateLabel,
  activeInterviews,
  activeLoops,
  decisionsAwaiting,
  actionItemsDue,
}: {
  name: string;
  headline: string;
  dateLabel: string;
  activeInterviews: number;
  activeLoops: number;
  decisionsAwaiting: number;
  actionItemsDue: number | null;
}) {
  const greeting = name ? `Welcome back, ${name.split(" ")[0]}.` : "Your command center.";
  return (
    <section className="dot-bg relative overflow-hidden rounded-2xl border border-border bg-surface/40 px-7 py-9 md:px-10 md:py-10">
      <HeroGlow />
      <div className="relative z-10">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand">
          <span className="text-faint">//</span> today · <span className="tabular-nums">{dateLabel}</span>
        </p>
        <h1 className={`${instrumentSerif.className} mt-3 text-4xl leading-[1.05] tracking-tight text-landing md:text-5xl`}>
          {greeting}
        </h1>
        {headline && <p className="mt-3 max-w-2xl text-sm text-muted">{headline}</p>}

        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <KpiTile
            href="/pipeline"
            icon={Briefcase}
            value={activeInterviews}
            label="Active interviews"
            hint={activeLoops > 0 ? `${activeLoops} live loop${activeLoops === 1 ? "" : "s"} coaching` : "in your pipeline"}
          />
          <KpiTile
            href="/pipeline"
            icon={AlarmClock}
            value={actionItemsDue == null ? "—" : actionItemsDue}
            label="Action items due"
            hint="follow-ups to send"
            urgent={(actionItemsDue ?? 0) > 0}
          />
          <KpiTile
            href="/pipeline"
            icon={ClipboardCheck}
            value={decisionsAwaiting}
            label="Decisions awaiting"
            hint="scored — apply or skip"
            urgent={decisionsAwaiting > 0}
          />
        </div>
      </div>
    </section>
  );
}

function KpiTile({
  href,
  icon: Icon,
  value,
  label,
  hint,
  urgent = false,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  value: number | string;
  label: string;
  hint: string;
  urgent?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3.5 rounded-xl border border-border bg-surface/60 px-4 py-3.5 transition hover:border-brand/40 hover:bg-surface-hover"
    >
      <Icon className={urgent ? "size-5 shrink-0 text-brand" : "size-5 shrink-0 text-faint"} />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold leading-none tabular-nums text-foreground">{value}</span>
          <span className="truncate text-[13px] font-medium text-foreground">{label}</span>
        </div>
        <div className="truncate text-xs text-faint">{hint}</div>
      </div>
    </Link>
  );
}
