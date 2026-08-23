// The README must name the fork's own differentiators, and they must still exist.
//
// A sync absorbs upstream's capability but not this fork's, so after a 250-file window it is
// genuinely hard to remember which is which — and the README drifted far enough that it named none
// of them. This asserts BOTH directions, because either half alone rots:
//
//   1. the identifier is still named in the README   (docs did not drift from the code)
//   2. the thing it names still exists on disk       (the code did not drift from the docs)
//
// Deliberately a handful of load-bearing identifiers, not a generated inventory. A generated list
// of everything would dilute the few things worth defending, and the exhaustive machine-readable
// answer already exists as `node fork-adaptations.mjs`.
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nREADME ↔ fork differentiators');

const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');

// [identifier named in the README, a path that must exist, or a file+needle pair]
const DELTA = [
  ['providers/careerjet.mjs', 'providers/careerjet.mjs'],
  ['owed-actions.mjs', 'owed-actions.mjs'],
  ['fork-adaptations.mjs', 'fork-adaptations.mjs'],
  ['min_by_currency', 'scan.mjs', 'min_by_currency'],
  ['salaryRange', 'providers/cutshort.mjs', 'salaryRange'],
];

for (const [needleInReadme, file, needleInFile] of DELTA) {
  if (readme.includes(needleInReadme)) pass(`README names ${needleInReadme}`);
  else fail(`README no longer mentions ${needleInReadme} — a fork differentiator went undocumented`);

  const abs = join(ROOT, file);
  if (!existsSync(abs)) {
    fail(`${file} is gone but the README still advertises it`);
    continue;
  }
  if (needleInFile) {
    if (readFileSync(abs, 'utf-8').includes(needleInFile)) pass(`${file} still implements ${needleInFile}`);
    else fail(`${file} lost ${needleInFile} — the README advertises a feature the code no longer has`);
  } else {
    pass(`${file} exists`);
  }
}
