// A tiny client-side ring buffer of recent ERRORS (not arbitrary logs → far less
// PII surface) for the in-app bug reporter. Installed once on first import.
const MAX = 20;
const BUF: string[] = [];

function push(s: string) {
  BUF.push(s.replace(/\s+/g, " ").slice(0, 300));
  if (BUF.length > MAX) BUF.shift();
}

declare global {
  interface Window {
    __coLogBufInstalled?: boolean;
  }
}

if (typeof window !== "undefined" && !window.__coLogBufInstalled) {
  window.__coLogBufInstalled = true;
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      push("[error] " + args.map((a) => (a instanceof Error ? `${a.message}` : String(a))).join(" "));
    } catch {
      /* never break logging */
    }
    orig(...args);
  };
  window.addEventListener("error", (e) => push(`[onerror] ${e.message || ""} @ ${e.filename || ""}:${e.lineno || ""}`));
  window.addEventListener("unhandledrejection", (e) => push(`[rejection] ${String((e as PromiseRejectionEvent).reason)}`));

  // A failed /api/* call (4xx/5xx) doesn't throw a JS exception, so it would
  // otherwise be invisible to the bug reporter — wrap fetch to log it too.
  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await origFetch(...args);
    try {
      const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
      if (!res.ok && url.includes("/api/")) push(`[api] ${res.status} ${res.statusText} @ ${url}`);
    } catch {
      /* never break the response */
    }
    return res;
  };
}

export function recentLogs(): string[] {
  return BUF.slice();
}
