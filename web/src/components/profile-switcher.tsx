"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronsUpDown, UserRound, Plus } from "lucide-react";
import { cn } from "@/lib/cn";

type Profile = {
  name: string;
  display_name: string;
  color: string | null;
  exists: boolean;
  active: boolean;
  url: string;
};

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

  if (!profiles) return null;

  const switchTo = (slug: string | null) => {
    const q = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    q.set("profile", slug ?? "");
    const qs = q.toString();
    setProfiles((prev) => prev?.map((p) => ({ ...p, active: p.name === slug })) ?? prev);
    router.push(qs ? `${pathname}?${qs}` : pathname);
    router.refresh();
    setOpen(false);
  };

  const insertCreatedProfile = (slug: string, displayName: string) => {
    setProfiles((prev) => {
      if (!prev) return prev;
      const next: Profile[] = [
        ...prev.filter((p) => p.name !== slug),
        { name: slug, display_name: displayName, color: "#0284c7", exists: true, active: true, url: `/?profile=${slug}` },
      ];
      return next.map((p) => ({ ...p, active: p.name === slug }));
    });
  };

  if (profiles.length === 0) {
    return (
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-sm transition-colors hover:bg-surface-hover"
        >
          <UserRound className="size-4 text-muted" />
          <span className="min-w-0 flex-1 truncate text-left text-muted">Default profile</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-faint" />
        </button>
        {open && (
          <div className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-md border border-border bg-surface shadow-lg">
            <CreateProfile
              onCreated={(slug, displayName) => {
                insertCreatedProfile(slug, displayName);
                switchTo(slug);
              }}
            />
          </div>
        )}
      </div>
    );
  }

  const active = profiles.find((p) => p.active) ?? null;
  const activeSlug = active?.name ?? null;

  const dot = (color: string | null) => (
    <span className="size-2.5 shrink-0 rounded-full" style={{ background: color || "var(--color-brand)" }} />
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn("flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-sm transition-colors hover:bg-surface-hover")}
      >
        {active ? dot(active.color) : <UserRound className="size-4 text-muted" />}
        <span className="min-w-0 flex-1 truncate text-left">{active ? active.display_name : "Default profile"}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-faint" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-md border border-border bg-surface shadow-lg">
          <Option label="Default profile" sub="single-profile root" selected={!activeSlug} onClick={() => switchTo(null)} />
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
          <div className="my-1 border-t border-border" />
          <CreateProfile
            onCreated={(slug, displayName) => {
              insertCreatedProfile(slug, displayName);
              switchTo(slug);
            }}
          />
        </div>
      )}
    </div>
  );
}

function CreateProfile({ onCreated }: { onCreated: (slug: string, displayName: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const create = async () => {
    if (!slug) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/profiles/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, display_name: name.trim() }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErr(d.error || "Could not create profile");
        return;
      }
      onCreated(slug, name.trim());
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-sm text-muted transition-colors hover:bg-surface-hover"
      >
        <Plus className="size-4" /> New profile
      </button>
    );
  }
  return (
    <div className="px-2.5 py-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && create()}
        placeholder="Candidate name…"
        className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand/50"
      />
      {slug && <p className="mt-1 text-[11px] text-faint">slug: {slug}</p>}
      {err && <p className="mt-1 text-[11px] text-red-500">{err}</p>}
      <div className="mt-1.5 flex gap-1.5">
        <button
          onClick={create}
          disabled={busy || !slug}
          className="flex-1 rounded-md bg-brand px-2 py-1 text-xs font-medium text-brand-foreground hover:bg-brand-200 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create"}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-surface-hover">
          Cancel
        </button>
      </div>
    </div>
  );
}

function Option({ label, sub, dot, selected, dimmed, onClick }: { label: string; sub?: string; dot?: string | null; selected: boolean; dimmed?: boolean; onClick: () => void; }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-hover", dimmed && "opacity-60")}
    >
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: dot || "var(--color-brand)" }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {sub && <span className="block truncate text-xs text-faint">{sub}</span>}
      </span>
      {selected && <Check className="size-4 shrink-0 text-brand" />}
    </button>
  );
}
