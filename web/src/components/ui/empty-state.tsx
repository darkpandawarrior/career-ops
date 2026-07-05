import { cn } from "@/lib/cn";

// Consolidates the "nothing here yet" box hand-copied across ~8 call sites.
// `plain` = the common dashed-border box (centered stack, or an inline icon +
// message row when there's no title — see report-view.tsx's usage).
// `terminal` = the dot-bg/terminal-chrome empty state (pipeline inbox), which
// carries its own `command` line instead of a title/description pair.
export function EmptyState({
  variant = "plain",
  layout = "center",
  size = "lg",
  icon: Icon,
  title,
  description,
  command,
  actions,
  className,
}: {
  variant?: "plain" | "terminal";
  layout?: "center" | "inline";
  /** "sm" = the compact one-liner used to fill an already-padded section (no title). */
  size?: "sm" | "lg";
  icon?: React.ComponentType<{ className?: string }>;
  title?: React.ReactNode;
  description?: React.ReactNode;
  command?: string;
  /** terminal variant only: a primary in-web action, rendered above the (demoted) command line. */
  actions?: React.ReactNode;
  className?: string;
}) {
  if (size === "sm") {
    return (
      <p className={cn("rounded-xl border border-dashed border-border bg-surface/30 px-4 py-6 text-center text-sm text-muted", className)}>
        {description}
      </p>
    );
  }

  if (variant === "terminal") {
    return (
      <div
        className={cn(
          "dot-bg overflow-hidden rounded-2xl border border-border bg-surface/50 bg-origin-border bg-gradient-to-tr from-brand/10 via-transparent to-transparent shadow-lg",
          className,
        )}
      >
        <div className="flex items-center gap-2 border-b border-foreground/10 px-5 py-3">
          <span className="size-2.5 rounded-full bg-foreground/15" aria-hidden="true" />
          <span className="size-2.5 rounded-full bg-foreground/15" aria-hidden="true" />
          <span className="size-2.5 rounded-full bg-foreground/15" aria-hidden="true" />
          {command && (
            <span className="ml-3 font-mono text-xs tracking-wide text-muted">
              <span className="text-foreground/40">&gt;_</span> {command}
            </span>
          )}
        </div>
        <div className="px-6 py-12 text-center">
          {title && <p className="font-display text-lg">{title}</p>}
          {description && <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{description}</p>}
          {actions && <div className="mt-5">{actions}</div>}
          {command && (
            <p className="mt-4 font-mono text-xs text-faint">
              $ {command}
              <span aria-hidden="true" className="cli-cursor ml-0.5 inline-block h-[1em] w-[0.35em] bg-current align-middle" />
            </p>
          )}
        </div>
      </div>
    );
  }

  if (layout === "inline") {
    return (
      <div className={cn("flex items-center gap-3 rounded-2xl border border-dashed border-border bg-surface/30 p-5 text-sm text-muted", className)}>
        {Icon && <Icon className="size-5 shrink-0 text-faint" />}
        <span>{description}</span>
      </div>
    );
  }

  return (
    <div className={cn("rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-12 text-center", className)}>
      {Icon && <Icon className="mx-auto mb-2 size-5 text-faint" />}
      {title && <p className="font-display text-lg">{title}</p>}
      {description && <div className={cn("text-sm text-muted", title ? "mx-auto mt-1 max-w-sm" : "")}>{description}</div>}
    </div>
  );
}
