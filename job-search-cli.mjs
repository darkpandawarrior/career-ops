#!/usr/bin/env node
// job-search-cli.mjs — headless bridge the web "Refresh jobs" action spawns.
// Runs the REAL job-search engine (dashboard-web/search/job-search-runner.mjs
// refreshJobSearch): scans tracked portals, fetches ATS + remote feeds, runs the
// configured search queries, scores everything, and writes data/job-dashboard.json
// into the target root. Emits NDJSON progress on stdout so the web can stream it.
//
//   node job-search-cli.mjs <root>
//     → {"type":"log","message":"…"}            (progress)
//     → {"type":"done","stats":{…},"generatedAt":"…"}
//     → {"type":"error","message":"…"}
//
// Child scan/feed logs are redirected to stderr so stdout stays clean NDJSON.

import { refreshJobSearch } from "./dashboard-web/search/job-search-runner.mjs";

const root = process.argv[2] || process.env.CAREER_OPS_ROOT || process.cwd();
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");
// 4-phase progress (mirrors the legacy refresh animation).
const phase = (n, name) => emit({ type: "phase", phase: n, name });

// Keep the noisy engine logs off stdout (NDJSON only).
const origLog = console.log;
const origInfo = console.info;
console.log = (...a) => process.stderr.write(a.map(String).join(" ") + "\n");
console.info = console.log;

// Instrument fetch so we can flip to the "fetch feeds" phase the moment the
// runner starts pulling ATS / remote feeds + running queries.
let announcedFetch = false;
const fetchImpl = (...args) => {
  if (!announcedFetch) {
    announcedFetch = true;
    phase(3, "Fetching job feeds + queries");
  }
  return globalThis.fetch(...args);
};

phase(1, "Scanning company boards");
emit({ type: "log", message: "Starting job search…" });

try {
  // Heartbeat so the UI's elapsed timer + active phase keep feeling alive.
  const startedAt = Date.now();
  const beat = setInterval(() => emit({ type: "tick", elapsed: Math.round((Date.now() - startedAt) / 1000) }), 2000);
  // Phase 2 (ATS discovery) follows the initial board scan shortly after.
  const p2 = setTimeout(() => phase(2, "ATS discovery"), 1500);

  const payload = await refreshJobSearch(root, { fetchImpl });

  clearInterval(beat);
  clearTimeout(p2);
  phase(4, "Scoring & saving");
  const stats = payload?.stats ?? {};
  const errs = payload?.diagnostics?.feedErrors?.length ?? 0;
  emit({ type: "log", message: `Found ${stats.total ?? 0} roles (${stats.excellent ?? 0} excellent, ${stats.sources ?? 0} source leads)${errs ? `, ${errs} feed warning(s)` : ""}.` });
  emit({ type: "done", stats, generatedAt: payload?.generatedAt ?? null, note: payload?.diagnostics?.note ?? null });
} catch (err) {
  emit({ type: "error", message: String(err?.message || err) });
  console.log = origLog;
  console.info = origInfo;
  process.exit(1);
}
console.log = origLog;
console.info = origInfo;
