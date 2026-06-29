"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronsUpDown, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";

type Profile = {
  name: string;
  display_name: string;
  color: string | null;
  exists: boolean;
  active: boolean;
  url: string;
};

/**
 * Multi-profile switcher (Phase 0 UX). Lists the registered candidate profiles
 * from /api/profiles and switches by setting `?profile=slug` on the CURRENT
 * path (so you stay on the same screen, just rescoped). Renders nothing in
 * single-profile mode (no profiles.yml) — zero footprint for solo installs.
 */
export function ProfileSwitcher() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/profiles")
      .then((r) => r.json())
      .then((d) => alive && setProfiles(Array.isArray(d.profiles) ? d.profiles : []))
      .catch(() => alive && setProfiles([]));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Single-profile mode → render nothing.
  if (!profiles || profiles.length === 0) return null;

  // The server (via the x-co-profile header) is the source of truth for "active".
  const active = profiles.find((p) => p.active) ?? null;
  const activeSlug = active?.name ?? null;

  const switchTo = (slug: string | null) => {
    const q = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    // Explicit empty `profile=` tells middleware to clear the sticky cookie.
    q.set("profile", slug ?? "");
    const qs = q.toString();
    setProfiles((prev) => prev?.map((p) => ({ ...p, active: p.name === slug })) ?? prev);
    router.push(qs ? `${pathname}?${qs}` : pathname);
    router.refresh(); // force the dynamic server components to re-read the new root
    setOpen(false);
  };

  const dot = (color: string | null) => (
    <span
      className="size-2.5 shrink-0 rounded-full"
      style={{ background: color || "var(--color-brand)" }}
    />
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-sm transition-colors hover:bg-surface-hover",
        )}
      >
        {active ? dot(active.color) : <UserRound className="size-4 text-muted" />}
        <span className="min-w-0 flex-1 truncate text-left">
          {active ? active.display_name : "Default profile"}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-faint" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-md border border-border bg-surface shadow-lg">
          <Option
            label="Default profile"
            sub="single-profile root"
            selected={!activeSlug}
            onClick={() => switchTo(null)}
          />
          <div className="my-1 border-t border-border" />
          {profiles.map((p) => (
            <Option
              key={p.name}
              label={p.display_name}
              sub={p.exists ? p.name : `${p.name} · offline`}
              dot={p.color}
              dimmed={!p.exists}
              selected={p.name === activeSlug}
              onClick={() => switchTo(p.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Option({
  label,
  sub,
  dot,
  selected,
  dimmed,
  onClick,
}: {
  label: string;
  sub?: string;
  dot?: string | null;
  selected: boolean;
  dimmed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-hover",
        dimmed && "opacity-60",
      )}
    >
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ background: dot || "var(--color-brand)" }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {sub && <span className="block truncate text-xs text-faint">{sub}</span>}
      </span>
      {selected && <Check className="size-4 shrink-0 text-brand" />}
    </button>
  );
}
