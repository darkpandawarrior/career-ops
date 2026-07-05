import { cn } from "@/lib/cn";

const DOT_TONE = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  info: "bg-sky-400",
  muted: "bg-zinc-400",
} as const;

export type DotTone = keyof typeof DOT_TONE;

// The `<span className="size-1.5 rounded-full bg-{color}-500" />` dot hand-copied
// across portals-view.tsx, pipeline-view.tsx, explorer-view.tsx, and cv-ingest.tsx.
// Pass `children` when the label sits immediately next to the dot (the common
// case) so the pairing can't silently regress to a color-only signal; omit it
// when the accompanying text lives elsewhere in the row (e.g. a chip at the far
// end) — the dot alone is still the same shared token in that case.
//
// `tone` picks from the shared 5-tone palette; `dotClassName` is an escape
// hatch for callers with their own domain-specific color mapping (e.g.
// format.ts's statusDot(), which has its own tested pipeline-status shades)
// that still want the shared dot markup instead of duplicating the span.
export function StatusDot({
  tone,
  className,
  dotClassName,
  children,
}: {
  tone?: DotTone;
  className?: string;
  dotClassName?: string;
  children?: React.ReactNode;
}) {
  const dot = <span className={cn("size-1.5 shrink-0 rounded-full", tone && DOT_TONE[tone], dotClassName)} />;
  if (children == null) return dot;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {dot}
      {children}
    </span>
  );
}
