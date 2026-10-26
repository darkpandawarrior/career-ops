"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Bell } from "lucide-react";
import { useNotify } from "@/lib/use-notify";
import { cn } from "@/lib/cn";
import { BrandLockup } from "@/components/brand";
import { ProfileSwitcher } from "@/components/profile-switcher";
import { CommandPalette } from "@/components/command-palette";
import { AssistantConsole } from "@/components/assistant-console";
import { MobileNav } from "@/components/mobile-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { BackToTop } from "@/components/back-to-top";
import { JobsProvider } from "@/components/jobs/job-store";
import { PipelineProvider } from "@/components/pipeline/pipeline-provider";
import { ApplyProvider } from "@/components/apply/apply-provider";
import { ExploreProvider } from "@/components/explore/explore-provider";
import { FirstScoreView } from "@/components/explore/first-score-view";
import { BetaBanner } from "@/components/beta/beta-banner";
import { WorkerPills } from "@/components/jobs/worker-pills";
import { UsageMeter } from "@/components/usage-meter";
import { instrumentSerif } from "@/lib/fonts";
import { visibleNavItems, isActivePath } from "@/lib/nav-items";

export function AppShell({ children, followupsEnabled }: { children: React.ReactNode; followupsEnabled: boolean }) {
  const pathname = usePathname();
  const { count, permission, requestPermission } = useNotify();
  return (
    <JobsProvider>
      <PipelineProvider>
      <ApplyProvider>
      <ExploreProvider>
      <MobileNav followupsEnabled={followupsEnabled} />
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface/30 p-4 md:flex">
          <div className="mb-5 flex items-center justify-between px-1">
            <Link href="/" className="flex items-center">
              <BrandLockup size={32} />
            </Link>
            {permission === "granted" || permission === "denied" ? (
              <Link href="/" className="relative rounded-md p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-foreground" aria-label={`${count} updates`} title={`${count} new matches + follow-ups due`}>
                <Bell className="size-4" />
                {count > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-brand text-[9px] font-bold text-brand-foreground">
                    {count > 9 ? "9+" : count}
                  </span>
                )}
              </Link>
            ) : permission !== "unsupported" ? (
              <button
                type="button"
                onClick={requestPermission}
                className="rounded-md p-1.5 text-faint transition-colors hover:bg-surface-hover hover:text-foreground"
                aria-label="Enable desktop notifications"
                title="Get notified about new matches & follow-ups when this tab is in the background"
              >
                <Bell className="size-4" />
              </button>
            ) : null}
          </div>
          <ProfileSwitcher />
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("co:command-palette"))}
            className="mt-3 flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-muted transition-colors hover:bg-surface-hover"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">Search & run…</span>
            <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-faint">⌘K</kbd>
          </button>
          <nav className="mt-4 flex flex-col gap-1">
            {visibleNavItems(followupsEnabled).map(({ href, label, icon: Icon, chip }) => {
              const active = isActivePath(href, pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-brand-soft text-brand"
                      : "text-muted hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                  {chip && (
                    <span className="ml-auto rounded-full border border-brand/30 bg-brand-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand">
                      {chip}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <WorkerPills />

          <div className="mt-auto space-y-3 pb-16 pt-4">
            <UsageMeter />
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">Appearance</span>
                <span className="font-mono text-[10px] text-faint">THEME</span>
              </div>
              <ThemeToggle showLabel />
              <div className="px-1">
                <span className={`${instrumentSerif.className} text-sm text-faint`}>HireSignal · local-first</span>
              </div>
            </div>
          </div>
        </aside>
        <main className="flex-1 overflow-x-hidden">{children}</main>
        <CommandPalette />
        <AssistantConsole />
        <BackToTop />
        <FirstScoreView />
        <BetaBanner />
      </div>
      </ExploreProvider>
      </ApplyProvider>
      </PipelineProvider>
    </JobsProvider>
  );
}
