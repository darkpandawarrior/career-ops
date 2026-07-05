#!/usr/bin/env node
// onboarding-cli.mjs — headless bridge the web onboarding flow spawns (like the
// /api/run pattern). It runs the REAL resume-inference + profile-generation
// engine from web/src/lib/onboarding so the web and CLI share one source of
// truth (no reimplementation). Text-in / JSON-out, two steps:
//
//   node onboarding-cli.mjs infer            < {"text": "...resume text..."}
//       → { ok, diagnostics, warnings, prefill }   (inferred, flattened for a form)
//   node onboarding-cli.mjs activate <root>  < {"text": "...","review": {...}}
//       → { ok, written:[...], archived:[...] }     (writes the user files into <root>)
//
// `activate` is the only write path. It is transactional-ish: any pre-existing
// user file is moved to data/profile-archives/<ts>/ before the new one lands, so
// a botched onboarding is fully recoverable. This is a sanctioned profile write
// per DATA_CONTRACT.md (cv.md + config + modes/_profile.md + portals.yml).

import { mkdir, readFile, rename, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { structureResume } from "./web/src/lib/onboarding/resume-normalizer.mjs";
import { inferProfile, validateReviewDraft } from "./web/src/lib/onboarding/profile-inference.mjs";
import { generateUserFiles, validateGeneratedFiles } from "./web/src/lib/onboarding/profile-writer.mjs";
import { extractFile } from "./web/src/lib/onboarding/resume-extractor.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readStdin() {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (buf += d));
    process.stdin.on("end", () => resolve(buf));
    if (process.stdin.isTTY) resolve(""); // no piped input
  });
}

function fieldValue(f) {
  return f && typeof f === "object" && "value" in f ? f.value : f;
}

/** Flatten inferProfile's confidence-wrapped output into a plain form prefill. */
function toPrefill(inferred) {
  const c = inferred.candidate || {};
  const roles = inferred.target_roles || [];
  const skills = inferred.skills || [];
  return {
    candidate: {
      full_name: fieldValue(c.full_name) || "",
      email: fieldValue(c.email) || "",
      phone: fieldValue(c.phone) || "",
      location: fieldValue(c.location) || "",
      linkedin: fieldValue(c.linkedin) || "",
      github: fieldValue(c.github) || "",
      portfolio_url: fieldValue(c.portfolio_url) || "",
    },
    summary: fieldValue(inferred.summary) || "",
    experience_years: fieldValue(inferred.experience?.total_years),
    seniority: fieldValue(inferred.seniority) || "",
    target_roles: roles.filter((r) => r.suggested_fit === "primary").map((r) => r.name),
    adjacent_roles: roles.filter((r) => r.suggested_fit !== "primary").map((r) => r.name),
    excluded_titles: [],
    preferences: { domains: [] },
    skills: {
      demonstrated: skills.filter((s) => s.suggested_state === "demonstrated").map((s) => s.name),
      confirmed_unlisted: [],
      supporting: skills.filter((s) => s.suggested_state !== "demonstrated").map((s) => s.name),
      learning: [],
      excluded: [],
    },
    // Required fields the engine cannot infer — surfaced for the user to complete.
    location: {
      home_country: "",
      preferred_locations: [],
      remote_regions: [],
      relocation: "unknown",
      search_scopes: ["remote"],
      international_locations: [],
      visa_sponsorship_required: false,
    },
    availability: { notice_period: "" },
    compensation: { currency: "", minimum_annual: null, target_annual: null },
  };
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function inferFromText(text, extraWarnings = []) {
  const extraction = structureResume(text);
  if (!extraction.text || extraction.text.length < 40) {
    return { ok: false, error: "Too little text to infer a profile — paste more, or upload a text-based PDF." };
  }
  const inferred = inferProfile({ ...extraction, draftId: "web-preview" });
  return {
    ok: true,
    diagnostics: extraction.diagnostics,
    warnings: [...extraWarnings, ...(extraction.warnings || [])],
    prefill: toPrefill(inferred),
    text: extraction.text || text || "",
  };
}

async function runInfer(input) {
  return inferFromText(String(input.text || ""));
}

/** Extract a resume FILE (pdf) → text → the same inferred prefill as paste. */
async function runExtract(filePath, extension) {
  if (!filePath) return { ok: false, error: "no file provided" };
  let extracted;
  try {
    extracted = await extractFile(filePath, extension || ".pdf");
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
  const text = String(extracted?.text || "");
  if (!text.trim()) {
    return { ok: false, error: "No selectable text found — this PDF may be a scan/image (needs OCR). Paste the text instead." };
  }
  return inferFromText(text, extracted?.warnings || []);
}

/**
 * Extract raw text from a PDF without running inference — used by the web's
 * /api/cv/ingest route when a non-Claude CLI is active (those CLIs can't read
 * files directly; the web extracts the text locally via pdfjs, then passes it
 * to the CLI as plain text just like the paste flow).
 */
async function runExtractText(filePath, extension) {
  if (!filePath) return { ok: false, error: "no file provided" };
  try {
    const extracted = await extractFile(filePath, extension || ".pdf");
    const text = String(extracted?.text || "");
    if (!text.trim()) {
      return { ok: false, error: "No selectable text found — this PDF may be a scanned image. Paste your CV text instead." };
    }
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

async function runActivate(root, input) {
  if (!root) return { ok: false, error: "activate requires a target root" };
  const text = String(input.text || input.review?.sourceText || "");
  const extraction = structureResume(text);
  const validation = validateReviewDraft(input.review || {});
  if (!validation.valid) return { ok: false, error: "review_invalid", errors: validation.errors };

  const generated = generateUserFiles(validation.review, extraction);
  const fileCheck = validateGeneratedFiles(generated);
  if (!fileCheck.valid) return { ok: false, error: "generated_invalid", errors: fileCheck.errors };

  // Archive any existing user file first (recoverable), then write the new one.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveRoot = path.join(root, "data", "profile-archives", stamp);
  const written = [];
  const archived = [];
  for (const [rel, content] of Object.entries(generated)) {
    const target = path.join(root, ...rel.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    if (await exists(target)) {
      const backup = path.join(archiveRoot, ...rel.split("/"));
      await mkdir(path.dirname(backup), { recursive: true });
      await rename(target, backup);
      archived.push(rel);
    }
    await writeFile(target, content, "utf8");
    written.push(rel);
  }
  // Stale scored cache no longer matches the new profile.
  await writeFile(path.join(root, "data", "job-dashboard.json"), JSON.stringify({ jobs: [], scored: false }), "utf8").catch(() => {});
  return { ok: true, written, archived: archived.length ? archived : [], archiveDir: archived.length ? path.relative(root, archiveRoot) : null };
}

async function main() {
  const step = process.argv[2];
  const root = process.argv[3];
  let input = {};
  const raw = await readStdin();
  if (raw.trim()) {
    try {
      input = JSON.parse(raw);
    } catch {
      process.stdout.write(JSON.stringify({ ok: false, error: "bad json on stdin" }));
      process.exit(1);
    }
  }
  try {
    let out;
    if (step === "infer") out = await runInfer(input);
    else if (step === "extract") out = await runExtract(process.argv[3], process.argv[4]);
    else if (step === "extract-text") out = await runExtractText(process.argv[3], process.argv[4]);
    else if (step === "activate") out = await runActivate(root, input);
    else out = { ok: false, error: `unknown step: ${step}` };
    process.stdout.write(JSON.stringify(out));
    process.exit(out.ok ? 0 : 1);
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: String(err?.message || err) }));
    process.exit(1);
  }
}

main();
