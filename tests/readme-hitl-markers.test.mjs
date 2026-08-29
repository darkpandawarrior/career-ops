// tests/readme-hitl-markers.test.mjs — the README keeps the HITL guarantee row.
//
// Ported from upstream (career-ops c9cae10) and DELIBERATELY DIVERGED. Upstream
// ships 17 READMEs and asserts `>= 17`, because its failure mode is translation
// drift: an audit there found 10 of 16 translated files hedging the guarantee
// with a manner adverb ("automatically"), an emphatic reflexive ("by itself"),
// or a conditional ("without your permission") that turns an absolute
// prohibition into an implied opt-in. This fork carries ONE README, so the
// upstream count assertion would fail here for a reason that says nothing about
// the guarantee. The count check is kept — inverted to the fork's real shape —
// rather than dropped, so a vacuous glob still fails loudly.
//
// The gap this closes is not hypothetical. Until 2026-08-25 the fork's README
// never stated the guarantee at all, even though `AGENTS.md:325` has always
// forbidden clicking Submit. The one rule a user most needs to know before
// letting an agent near their job search was enforced in code and absent from
// the document people actually read.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nREADME HITL marker — the guarantee row keeps its anchor');

const MARKER = '<!-- hitl: absolute guarantee.';
const readmes = readdirSync(ROOT).filter((f) => /^README[\w.-]*\.md$/.test(f)).sort();

// A marker check over an empty or mis-globbed list passes vacuously — exactly
// the blind-check class this suite exists to avoid. Assert the list is real.
if (readmes.length >= 1) pass(`found ${readmes.length} README file(s)`);
else fail('no README*.md found — glob broken or the file was removed');

for (const file of readmes) {
  const content = readFileSync(join(ROOT, file), 'utf8');
  const count = content.split(MARKER).length - 1;
  if (count !== 1) {
    fail(`${file}: expected exactly 1 HITL marker, found ${count}`);
    continue;
  }

  const line = content.split('\n').find((l) => l.includes(MARKER)) ?? '';
  // Inside the row means inside a table line. A marker on its own line renders
  // as a paragraph and splits the table around it.
  if (!line.trimStart().startsWith('|') || (line.match(/\|/g) || []).length < 2) {
    fail(`${file}: HITL marker sits outside a table row (own line splits the table)`);
  } else {
    pass(`${file}: marker present, inside its table row`);
  }

  // The row has to actually say the thing. Upstream can only check the marker
  // because its row is translated into 17 languages; this fork is English-only,
  // so the substantive claim is checkable directly — and that is the half that
  // matters. A marker guarding a hedged sentence guards nothing.
  // Check the PROSE, not the whole line: the marker comment QUOTES the hedges it
  // forbids, so a scan of the raw line matches the anchor's own warning text and
  // fails a correctly-worded row.
  //
  // Sliced at the marker's own bounds rather than stripped with
  // /<!--[\s\S]*?-->/g. CodeQL flags that pattern as incomplete multi-character
  // sanitization, and the objection holds: an unclosed comment leaves a bare
  // `<!--` in `prose`, so a row whose comment lost its `-->` would be scanned
  // with the anchor text still in it and the hedge check would fail for a reason
  // that has nothing to do with hedging. The marker's position is already known,
  // so exact bounds are available — and an unclosed comment becomes its own
  // named failure instead.
  const mStart = line.indexOf(MARKER);
  const mEnd = line.indexOf('-->', mStart);
  const prose = mEnd === -1 ? null : line.slice(0, mStart) + line.slice(mEnd + '-->'.length);
  if (prose === null) {
    fail(`${file}: the HITL marker comment is never closed with -->`);
  } else if (/never submits an application/i.test(prose)) {
    pass(`${file}: the row states the prohibition in absolute terms`);
  } else {
    fail(`${file}: the HITL row no longer says "never submits an application"`);
  }

  const HEDGES = /\b(usually|generally|normally|typically|by default|unless|without your permission|automatically|by itself)\b/i;
  const hedge = prose === null ? null : prose.match(HEDGES);
  if (prose === null) {
    // Already reported above; do not also tick "hedge-free" on a line that was
    // never successfully read.
  } else if (hedge) {
    fail(`${file}: the HITL row hedges with "${hedge[0]}" — the guarantee is absolute, not a default`);
  } else {
    pass(`${file}: no hedge in the guarantee row`);
  }
}
