"use client";

// The cheap, established way to expose a CLI-only mode with no dedicated UI:
// dispatch a `co-assistant` CustomEvent that pre-seeds the assistant chat with
// a mode-run instruction, same as the onboarding banner's kickoff. Originated
// in intel-view.tsx for practice/email-sweep/contacto; shared here so any page
// can reuse it instead of re-declaring the same button.
export function RunModeButton({
  icon: Icon,
  label,
  message,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  message: string;
}) {
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent("co-assistant", { detail: { message } }))}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/60 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-brand"
    >
      <Icon className="size-3.5" /> {label}
    </button>
  );
}
