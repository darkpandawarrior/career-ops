"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

// "All clear" strip (client — needs the live follow-up count). Renders only when
// nothing is due AND nothing is awaiting a decision. `decisionsAwaiting` comes
// from the server (canonical tracker); the due count is fetched the same way the
// hero KPI is, so the two never disagree.
export function AllClearStrip({ decisionsAwaiting }: { decisionsAwaiting: number }) {
  const [due, setDue] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/followups")
      .then((r) => r.json())
      .then((d) => setDue(Array.isArray(d.entries) ? d.entries.length : 0))
      .catch(() => setDue(0));
  }, []);

  // Wait for the due count before deciding — avoids a flash of "all clear".
  if (due == null) return null;
  if (due > 0 || decisionsAwaiting > 0) return null;

  return (
    <section className="mt-8 rounded-2xl border border-border bg-surface/30 px-6 py-10 text-center">
      <Sparkles className="mx-auto size-6 text-brand" />
      <p className="mx-auto mt-3 max-w-md text-sm text-muted">
        You&apos;re all caught up — nothing needs you right now. Run a{" "}
        <Link href="/explore" className="text-brand hover:underline">free scan</Link> to surface this week&apos;s roles, or
        review your <Link href="/board" className="text-brand hover:underline">board</Link>.
      </p>
    </section>
  );
}
