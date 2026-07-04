"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Proactive notifications, the lazy version: no push service, no service worker,
// no VAPID keys — just a same-tab poll of the two counters the home page already
// computes server-side (/api/whats-new, /api/followups), a badge count for the
// nav, and the browser's own same-tab Notification API when the tab is
// backgrounded. Opt-in only (never auto-requests permission) and deduped against
// the last-notified count in localStorage so an unchanged "5 new matches" doesn't
// re-fire every poll.
// ponytail: Web Push (real background push while the tab/browser is closed) needs
// VAPID keys + a service worker + a subscription store — upgrade path if the user
// asks for notifications while the dashboard isn't open at all.

const SEEN_KEY = "career-ops:notify-seen";
const POLL_MS = 5 * 60_000;

type Seen = { matches: number; followups: number };

function readSeen(): Seen {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw) return JSON.parse(raw) as Seen;
  } catch {
    /* ignore */
  }
  return { matches: 0, followups: 0 };
}

function writeSeen(s: Seen) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function useNotify() {
  const [count, setCount] = useState(0);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const seenRef = useRef<Seen>({ matches: 0, followups: 0 });

  useEffect(() => {
    seenRef.current = readSeen();
    setPermission(typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported");
  }, []);

  const poll = useCallback(async () => {
    const [matchesRes, followupsRes] = await Promise.all([
      fetch("/api/whats-new").then((r) => r.json()).catch(() => null),
      fetch("/api/followups").then((r) => r.json()).catch(() => null),
    ]);
    const matches = Array.isArray(matchesRes?.offers) ? matchesRes.offers.length : 0;
    const overdue = followupsRes?.metadata?.overdue ?? (Array.isArray(followupsRes?.entries) ? followupsRes.entries.length : 0);

    setCount(matches + overdue);

    const prev = seenRef.current;
    const grew = matches > prev.matches || overdue > prev.followups;
    if (grew && document.hidden && "Notification" in window && Notification.permission === "granted") {
      const bits = [];
      if (matches > prev.matches) bits.push(`${matches} new match${matches === 1 ? "" : "es"}`);
      if (overdue > prev.followups) bits.push(`${overdue} follow-up${overdue === 1 ? "" : "s"} due`);
      new Notification("career-ops", { body: bits.join(" · "), tag: "career-ops-whats-new" });
    }
    seenRef.current = { matches, followups: overdue };
    writeSeen(seenRef.current);
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const requestPermission = useCallback(async () => {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setPermission(p);
  }, []);

  return { count, permission, requestPermission };
}
