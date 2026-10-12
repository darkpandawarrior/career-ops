import fs from "node:fs";
import path from "node:path";
import { cliSubstitutionNotice, cliUnavailableError, resolveCliOrFallback } from "@/lib/clis";
import { careerOpsRoot, readMemory } from "@/lib/career-ops";
import { requestRoot } from "@/lib/profile-registry";
import { getSession } from "@/lib/apply/session";
import { resolveSessionCv } from "@/lib/apply/cv";
import { applyCvSource } from "@/lib/apply/cv-source.mjs";
import { buildAnswerPrompt } from "@/lib/apply/answer-prompt.mjs";
import { runPlanner } from "@/lib/apply/planner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 320;

/**
 * Pull a JSON object out of an LLM's text answer, tolerating code fences,
 * trailing prose, and — crucially — TRUNCATION (the planner getting killed
 * mid-output on a big form). When the object is incomplete we salvage the
 * largest valid prefix so the fields that DID finish still come through.
 */
function extractJsonObject(text: string): { obj: Record<string, unknown> | null; truncated: boolean } {
  const s = text.replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  if (start === -1) return { obj: null, truncated: false };

  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end !== -1) {
    try {
      return { obj: JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>, truncated: false };
    } catch {
      /* malformed even though balanced — fall through to salvage */
    }
  }

  // Truncated / unbalanced: walk back from successive commas, close the JSON,
  // and parse the largest prefix that is valid.
  const frag = s.slice(start);
  const open = (frag.match(/{/g) || []).length;
  const close = (frag.match(/}/g) || []).length;
  const pad = "}".repeat(Math.max(0, open - close));
  for (let tryEnd = frag.length; tryEnd > 1; ) {
    const cand = frag.slice(0, tryEnd).replace(/,\s*$/, "") + pad;
    try {
      return { obj: JSON.parse(cand) as Record<string, unknown>, truncated: true };
    } catch {
      const prevComma = frag.lastIndexOf(",", tryEnd - 1);
      if (prevComma <= start) break;
      tryEnd = prevComma;
    }
  }
  return { obj: null, truncated: true };
}

// AI pre-fill (STREAMING NDJSON). The user's BYO CLI (read-only PLANNER — no
// browser access) drafts an answer per field from cv.md / profile / the job's
// report. We stream a live diagnostic log of every step (spawn, heartbeats,
// exit code/signal, parse outcome) so a stuck/empty prefill is observable on the
// page AND written to <root>/.career-ops-web/apply-prefill.log for debugging.
export async function POST(req: Request) {
  let body: { sessionId?: string; cliId?: string; company?: string; application?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const { sessionId, cliId: requestedCliId, company, application } = body;
  // Same two identifiers the fill route takes, validated the same way: they
  // reach a filesystem resolver, so a non-string is refused before it gets there.
  if (company !== undefined && typeof company !== "string") {
    return Response.json({ error: "company must be a string" }, { status: 400 });
  }
  if (application !== undefined && typeof application !== "string") {
    return Response.json({ error: "application must be a string" }, { status: 400 });
  }
  const t0 = Date.now();
  const encoder = new TextEncoder();
  const dataRoot = await requestRoot();
  const logPath = path.join(dataRoot, ".career-ops-web", "apply-prefill.log");
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
  } catch {
    /* ignore */
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* client gone */
        }
      };
      const log = (m: string) => {
        const el = Date.now() - t0;
        emit({ t: "log", m, el });
        try {
          fs.appendFileSync(logPath, `${new Date(t0 + el).toISOString()} [+${(el / 1000).toFixed(1)}s] ${m}\n`);
        } catch {
          /* ignore */
        }
      };
      // Idempotent, like the `closed` guard the sibling routes carry. fail() closes
      // the controller, and there is more than one path to it: a fencing refusal
      // reports through fail() and then resolves with an empty buffer, which the
      // empty-output branch below reports through fail() a second time. Closing an
      // already-closed controller throws "Invalid state", and that throw escapes
      // the async start() as an unhandled rejection — a worse failure than the one
      // being reported.
      let failed = false;
      const fail = (m: string, raw?: string) => {
        if (failed) return;
        failed = true;
        log(`ERROR: ${m}`);
        emit({ t: "error", m, raw });
        controller.close();
      };
      try {
        fs.appendFileSync(logPath, `\n===== prefill ${new Date(t0).toISOString()} session=${sessionId} cli=${requestedCliId} =====\n`);
      } catch {
        /* ignore */
      }

      const s = sessionId ? getSession(sessionId) : undefined;
      if (!s) return fail("apply session not found (it may have expired)");
      const resolved = requestedCliId ? resolveCliOrFallback(requestedCliId) : null;
      if (!resolved) return fail(cliUnavailableError(requestedCliId ?? "").error);
      const { spec, binPath } = resolved;
      // The CLI actually running: the planner's fencing and argv are keyed on it.
      const cliId = spec.id;
      const substitution = cliSubstitutionNotice(resolved);
      if (substitution) log(substitution);

      const mem = readMemory(dataRoot).trim();
      // Draft from the SAME tailored CV the fill route uploads to this form,
      // resolved through the one shared call so the answers and the resume
      // stapled to them cannot describe different documents.
      const cvPath = await resolveSessionCv(dataRoot, { company, application, title: s.title });
      const cvSource = cvPath ? applyCvSource(dataRoot, cvPath) : null;
      const prompt = buildAnswerPrompt({ title: s.title, fields: s.fields, memory: mem, cvSource });

      log(`Form: "${s.title}" · ${s.fields.length} fields · prompt ${prompt.length} chars · memory ${mem.length} chars`);
      log(`CV source: ${cvSource ?? "none found — answers will come from cv.md"}`);
      log(`Planner: ${cliId} (${binPath})`);

      // Consent/sensitive detector — used BOTH while streaming (so a policy "Yes"
      // never even flashes into the UI) and in the final post-filter. Scoped to
      // Yes/No controls so a free-text essay mentioning "guidelines" isn't nuked.
      const CONSENT_RX = /\b(policy|policies|guideline|terms|consent|acknowledg|i agree|i have read|i understand|i certify|code of conduct|privacy|gdpr|self.?identif|gender|veteran|disab|ethnic|\brace\b|hispanic|latino|sexual orientation|pronoun|transgender)\b/i;
      const byId = new Map(s.fields.map((f) => [f.id, f]));
      const isConsent = (id: string) => {
        const f = byId.get(id);
        return !!f && CONSENT_RX.test(f.label || "") && ["radio", "select", "checkbox"].includes(f.type);
      };

      // Stream each ANSWER the instant its JSON entry `"coN":{…}` closes → the UI
      // fills fields top-to-bottom (the shimmer recedes like a wave) instead of
      // all-at-once at the end. The value-object is flat (no nested braces except
      // inside strings), so this brace/string-aware regex only matches a COMPLETE
      // entry. Consent fields are guarded here too (a policy "Yes" never flashes).
      let draftBuf = "";
      const emittedKeys = new Set<string>();
      let fieldsDone = 0;
      const FIELD_RX = /"(co\d+)"\s*:\s*(\{(?:[^{}"]|"(?:[^"\\]|\\.)*")*\})/g;
      const flushFields = () => {
        FIELD_RX.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = FIELD_RX.exec(draftBuf)) !== null) {
          const id = m[1];
          if (emittedKeys.has(id)) continue;
          let v: { value?: unknown; needs_confirmation?: boolean };
          try {
            v = JSON.parse(m[2]);
          } catch {
            continue; // value not fully closed yet → wait for more deltas
          }
          emittedKeys.add(id);
          const consent = isConsent(id);
          const value = consent ? "" : typeof v?.value === "string" ? v.value : v?.value != null ? String(v.value) : "";
          const needs = consent || !!v?.needs_confirmation;
          fieldsDone++;
          emit({ t: "field", id, value, needs });
          log(`drafted ${(byId.get(id)?.label || id).slice(0, 36)} (${fieldsDone}/${s.fields.length})`);
        }
      };

      const result = await runPlanner({
        cliId,
        spec,
        binPath,
        prompt,
        fieldCount: s.fields.length,
        cwd: careerOpsRoot(),
        env: { ...process.env, CAREER_OPS_ROOT: dataRoot },
        t0,
        log,
        onText: (text) => {
          draftBuf += text;
          flushFields();
        },
      });

      // Fencing refused to start the planner (#2507): runPlanner already logged
      // the reason; report it as THE error, before the empty-output branch below
      // turns it into an unrelated "produced no output".
      if (result.refused) return fail(result.refused);

      log(`Planner exited code=${result.code} signal=${result.signal} · ${result.buf.length} chars total`);
      log(`output head: ${result.buf.slice(0, 100).replace(/\s+/g, " ") || "(empty)"}`);
      log(`output tail: ${result.buf.slice(-100).replace(/\s+/g, " ") || "(empty)"}`);

      if (!result.buf.trim()) {
        return fail(result.signal ? "planner was killed before producing any output (try again / smaller form)" : "planner produced no output (check the CLI works in this folder)");
      }

      const { obj, truncated } = extractJsonObject(result.buf);
      if (!obj) {
        return fail(
          result.signal ? "planner was killed mid-answer (form too large/slow) — couldn't recover any fields" : "couldn't parse the planner's answer as JSON",
          result.buf.slice(-300),
        );
      }
      // CONSENT GUARD (belt-and-suspenders): even if a policy / "I agree" value
      // slipped through (or wasn't streamed), force it blank + needs_confirmation so
      // the HUMAN agrees themselves. (isConsent is defined above — reused here.)
      let guarded = 0;
      for (const [id, v] of Object.entries(obj)) {
        if (!isConsent(id)) continue;
        const val = v && typeof v === "object" ? (v as { value?: unknown }).value : undefined;
        if (val != null && String(val).trim()) {
          obj[id] = { value: "", needs_confirmation: true };
          guarded++;
        }
      }
      if (guarded) log(`Consent guard: left ${guarded} policy/consent field${guarded === 1 ? "" : "s"} blank for you to confirm`);
      const count = Object.keys(obj).length;
      log(`Parsed ${count} answers${truncated ? " (RECOVERED from truncated output — some fields may be missing)" : ""}`);
      emit({ t: "done", answers: obj, truncated, count });
      controller.close();
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}



