import { cn } from "@/lib/cn";

const WIDTHS = {
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
} as const;

const VERTICAL = { "8": "py-8", "9": "py-9", "10": "py-10" } as const;

// The `mx-auto max-w-Xxl px-6 py-Y` container hand-copied across every top-level
// page — one place to change the shell instead of 19. `className` is applied
// last (cn() → tailwind-merge), so a page needing something extra (e.g. a
// responsive `md:py-16`) can still override cleanly.
export function PageShell({
  maxWidth = "5xl",
  py = "8",
  className,
  children,
}: {
  maxWidth?: keyof typeof WIDTHS;
  py?: keyof typeof VERTICAL;
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("mx-auto px-6", WIDTHS[maxWidth], VERTICAL[py], className)}>{children}</div>;
}

// The `<h1 className="font-display text-2xl tracking-tight text-landing">` +
// subtitle `<p>` pair hand-copied alongside PageShell. `actions` covers the
// header-row-with-a-button shape (Save, etc.) instead of forcing those pages
// to build their own flex row.
export function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 font-display text-2xl tracking-tight text-landing">
          {Icon && <Icon className="size-5 shrink-0 text-brand" />}
          {title}
        </h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}
