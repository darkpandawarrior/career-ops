import { instrumentSerif } from "@/lib/fonts";

/**
 * HireSignal brand mark — ascending "signal-strength" bars on the brand tile.
 * The bars read as a hiring signal getting stronger (the product's promise:
 * surface the strongest-fit roles first). Matches the favicon (app/icon.svg)
 * one-for-one so the app, tab, and home-screen icon are the same mark.
 */
export function HireSignalMark({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-md bg-brand"
      style={{ width: size, height: size }}
    >
      <svg
        width={Math.round(size * 0.62)}
        height={Math.round(size * 0.62)}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* three ascending bars — signal strength */}
        <rect x="3" y="14" width="4" height="7" rx="1.2" fill="#fff" opacity="0.55" />
        <rect x="10" y="9" width="4" height="12" rx="1.2" fill="#fff" opacity="0.8" />
        <rect x="17" y="3" width="4" height="18" rx="1.2" fill="#fff" />
      </svg>
    </span>
  );
}

/** The full lockup: mark + "HireSignal" wordmark. Used in the sidebar + mobile nav. */
export function BrandLockup({ size = 32 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <HireSignalMark size={size} />
      <span className={`${instrumentSerif.className} relative -top-px text-2xl font-normal tracking-tight text-landing`}>
        Hire<span className="text-brand">Signal</span>
      </span>
    </span>
  );
}
