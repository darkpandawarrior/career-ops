// scan-runs.tsv header drift — the class of bug that hid a broken scanner for 44 days.
//
// The header is written only when the file is created, so when a sync appends or inserts a column
// the on-disk header silently stops describing the rows beneath it. Every header-name consumer then
// reads one column to the left of the truth. Measured 2026-08-24: 218 of 226 rows were wider than
// their header, and stats.mjs reported "avg 30.2 new per run" — the dupes column — when the real
// figure was 0.17. Confident, precise, and pointing the opposite direction.
//
// Two invariants, both about refusing to report a number we cannot justify.
import { computeRunStats } from '../stats.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nscan-runs.tsv header drift');

const HEADER = 'timestamp\tstatus\tcompanies\tfound\tnew_added\n';
const wide = 'timestamp\tstatus\tcompanies\tfound\tnew_added\tERRORS_EXTRA\n';

// 1. A row WIDER than the header must be excluded, not misread.
{
  const tsv = HEADER
    + '2026-08-01T00:00:00Z\tcompleted\t5\t100\t7\n'                 // matches header
    + '2026-08-02T00:00:00Z\tcompleted\t5\t100\t7\t99\n';            // one column too wide
  const r = computeRunStats(tsv);
  if (r && r.driftedRows === 1) pass('a wider-than-header row is counted as drifted');
  else fail(`driftedRows = ${r && r.driftedRows}`);
  if (r && r.totalRuns === 1) pass('the drifted row is excluded from the averages, not misread');
  else fail(`totalRuns = ${r && r.totalRuns}`);
}

// 2. When nothing has drifted, driftedRows must be 0 — no false alarm.
{
  const tsv = HEADER + '2026-08-01T00:00:00Z\tcompleted\t5\t100\t7\n';
  const r = computeRunStats(tsv);
  if (r && r.driftedRows === 0) pass('an aligned file reports zero drift');
  else fail(`driftedRows = ${r && r.driftedRows} on an aligned file`);
  if (r && r.avgNewPerRun === 7) pass('an aligned file still computes its averages normally');
  else fail(`avgNewPerRun = ${r && r.avgNewPerRun}`);
}

// 3. The real-world shape: MOST rows drifted. The averages must describe the survivors only,
//    and the caller must be able to see that they are a minority.
{
  const tsv = HEADER
    + '2026-08-01T00:00:00Z\tcompleted\t5\t100\t7\n'
    + Array.from({ length: 9 }, (_, i) => `2026-08-1${i}T00:00:00Z\tcompleted\t5\t100\t7\t99\n`).join('');
  const r = computeRunStats(tsv);
  if (r.driftedRows === 9 && r.totalRuns === 1) pass('9-of-10 drift is reported, not silently averaged away');
  else fail(`driftedRows=${r.driftedRows} totalRuns=${r.totalRuns}`);
}
