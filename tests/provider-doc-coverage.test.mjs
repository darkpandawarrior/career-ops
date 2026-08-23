// Every provider must be named in docs/SUPPORTED_JOB_BOARDS.md.
//
// The doc goes stale on every upstream sync — a window adds providers, the prose does not follow,
// and nobody notices because nothing checks. Measured 2026-08-24: 84 providers, 24 named nowhere in
// the doc, including an SSRF-relevant one and three added by the v1.28.0 window.
//
// This asserts SET MEMBERSHIP only — that each provider id appears somewhere in the doc. It does
// NOT generate the doc. The rows are operational essays (which board blocks non-browser requests,
// which one throws rather than returning empty so a markup change surfaces as broken, which one
// was retired and why), and no generator produces that from source. Generating the table would
// replace the single best document in this repo with a plausible-looking summary — the failure
// mode being avoided is a doc that always LOOKS current and is quietly wrong, which is strictly
// worse than one that is visibly stale.
//
// Provider ids come from importing each module and reading `default.id`, not from a regex: a
// regex over `id:` picked up an id inside a doc-comment example in jobstreet.mjs and reported a
// phantom provider. A check that cries wolf gets ignored, which is worse than no check.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nProvider ↔ docs/SUPPORTED_JOB_BOARDS.md coverage');

const providersDir = join(ROOT, 'providers');
const docPath = join(ROOT, 'docs/SUPPORTED_JOB_BOARDS.md');

const files = readdirSync(providersDir)
  .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
  .sort();

const ids = [];
const unloadable = [];
for (const f of files) {
  try {
    const mod = await import(pathToFileURL(join(providersDir, f)).href);
    const id = mod.default?.id;
    if (typeof id === 'string' && id) ids.push({ id, file: f });
    else unloadable.push(`${f} (no default.id)`);
  } catch (err) {
    unloadable.push(`${f} (${err.message.slice(0, 60)})`);
  }
}

if (unloadable.length === 0) pass(`all ${ids.length} provider modules load and declare an id`);
else fail(`${unloadable.length} provider module(s) unloadable or id-less: ${unloadable.join(', ')}`);

const doc = readFileSync(docPath, 'utf-8').toLowerCase();
const missing = ids.filter(({ id }) => !doc.includes(id.toLowerCase()));

if (missing.length === 0) {
  pass(`every one of ${ids.length} providers is named in SUPPORTED_JOB_BOARDS.md`);
} else {
  fail(
    `${missing.length} provider(s) missing from docs/SUPPORTED_JOB_BOARDS.md — `
    + `add a row for each: ${missing.map((m) => m.id).join(', ')}`,
  );
}
