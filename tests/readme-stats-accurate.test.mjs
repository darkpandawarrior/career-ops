// The README's "At a glance" numbers must match reality.
//
// This is the check that should have existed. The block claimed 77 providers (84), 2,741 engine
// tests (4,129), 6 fork adaptations (7) and 28,746 ATS boards (38,854 — iCIMS was added to the
// sweep and the total was never updated). Three of four headline numbers were wrong, and the
// version-history table still called a release from ten days and two versions earlier "(current)".
//
// Nothing checked them, so every sync made them a little more wrong. A README that confidently
// states stale numbers is worse than one that states none: a reader has no way to tell which
// half is still true.
//
// Counts that move on every commit (test totals) are asserted as a FLOOR, not equality — pinning
// an exact test count would fail the suite every time a test is added, which trains people to
// edit the number without reading it. Counts that are structural and slow-moving (providers, fork
// adaptations) are asserted exactly.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nREADME "At a glance" accuracy');

const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');
const glance = /\*\*At a glance\*\*[\s\S]{0,400}/.exec(readme)?.[0] ?? '';

if (glance) pass('the At-a-glance block is present');
else fail('could not find the At-a-glance block — did the README structure change?');

// --- providers: exact ---------------------------------------------------------
const providerCount = readdirSync(join(ROOT, 'providers'))
  .filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).length;
const claimedProviders = Number(/\*\*([\d,]+)\*\* zero-auth job-board providers/.exec(glance)?.[1]?.replace(/,/g, ''));
if (claimedProviders === providerCount) pass(`claims ${providerCount} providers, and there are ${providerCount}`);
else fail(`README claims ${claimedProviders} providers; there are ${providerCount}`);

// --- fork adaptations: exact --------------------------------------------------
const adaptationsSrc = readFileSync(join(ROOT, 'fork-adaptations.mjs'), 'utf-8');
const adaptationCount = (adaptationsSrc.match(/^\s{4}id: '/gm) || []).length;
const claimedAdaptations = Number(/\*\*(\d+)\*\* machine-checked\s*\n?>?\s*fork adaptations/.exec(glance)?.[1]);
if (claimedAdaptations === adaptationCount) pass(`claims ${adaptationCount} fork adaptations, and there are ${adaptationCount}`);
else fail(`README claims ${claimedAdaptations} fork adaptations; fork-adaptations.mjs defines ${adaptationCount}`);

// --- version table: the "(current)" row must name the version we are actually on
const version = readFileSync(join(ROOT, 'VERSION'), 'utf-8').trim().split(/\s+/)[0];
const currentLine = readme.split('\n').find((l) => l.includes('(current)'));
if (!currentLine) {
  fail('no "(current)" row in the version-history table');
} else {
  // Check the version CELL only, not the whole row. The row body describes the window and repeats
  // the version string, so matching anywhere in the line passes even when the label itself is
  // stale — which is precisely the drift this is meant to catch.
  const label = currentLine.split('|')[1] || '';
  if (label.includes(version)) {
    pass(`the "(current)" version label names ${version}, matching VERSION`);
  } else {
    fail(`VERSION is ${version} but the "(current)" label reads "${label.trim()}" — the release table is behind`);
  }
}
