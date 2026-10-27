import { LayoutDashboard, Compass, Target, ListChecks, Radar, Wrench, Brain, BarChart3, FileText, Files, Settings, UserPlus, Globe, UserRound, Send, CalendarClock } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

// Single source of truth for the app's primary destinations — shared by the
// desktop sidebar and the mobile nav so they can never drift.
export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  chip?: string;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Today", icon: LayoutDashboard },
  { href: "/board", label: "Job board", icon: Target },
  { href: "/explore", label: "Explore", icon: Compass, chip: "New" },
  { href: "/scheduled-scans", label: "Scheduled scans", icon: CalendarClock },
  { href: "/pipeline", label: "Pipeline", icon: ListChecks },
  { href: "/followups", label: "Follow-ups", icon: CalendarClock },
  { href: "/apply-queue", label: "Apply queue", icon: Send },
  { href: "/ops", label: "Ops", icon: Wrench },
  { href: "/intel", label: "Intel", icon: Brain },
  { href: "/portals", label: "Portals", icon: Radar },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/cv", label: "CV", icon: FileText },
  { href: "/documents", label: "Documents", icon: Files },
  { href: "/profile", label: "Profile", icon: UserRound, chip: "New" },
  { href: "/portfolio", label: "Portfolio", icon: Globe, chip: "New" },
  { href: "/onboarding", label: "Onboarding", icon: UserPlus },
  { href: "/config", label: "Config", icon: Settings },
];

export function visibleNavItems(followupsEnabled: boolean): NavItem[] {
  return followupsEnabled ? NAV_ITEMS : NAV_ITEMS.filter((item) => item.href !== "/followups");
}

export function isActivePath(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
