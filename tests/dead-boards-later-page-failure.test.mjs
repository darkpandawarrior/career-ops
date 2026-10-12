// tests/dead-boards-later-page-failure.test.mjs — a failure on a later page of a
// board that had just answered is not a miss.
//
// scan-ats-full.mjs retires a board after three 404s in a row and skips it for
// 30 days (dead-boards.mjs, #2840). The iCIMS provider walks a board page by
// page and already draws the line itself: only a FIRST-page 404 means "no board
// here" (providers/icims.mjs, and tests/providers/icims-host-fallback.test.mjs
// pins that a later-page 404 does not switch hosts). The sweep did not draw it.
// It passed `err?.status` to isDeadBoardError(), so a 404 on page 2 of a board
// that had answered page 1 with postings counted exactly like a missing board.
//
// The provider now marks every page failure (`firstPage` true or false), and
// the sweep asks isDeadBoardError(), which reads the mark.
//
// The provider and the cache below are the real ones; only the HTTP layer is a
// stub. The last section reads scan-ats-full.mjs's source, because the two
// catch blocks that feed the cache are only reachable through a whole sweep.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nDead-board memory — a later-page failure is not a miss');

const load = (file) => import(pathToFileURL(join(ROOT, file)).href);
const { isDeadBoardError } = await load('dead-boards.mjs');
const icims = (await load('providers/icims.mjs')).default;

const ORIGIN = 'https://careers-acmefreight.icims.com';
const entry = { name: 'acmefreight', careers_url: `${ORIGIN}/jobs/search?ss=1&in_iframe=1` };
const now = Date.parse('2026-10-11T00:00:00Z');
const card = (id) => `<li class="iCIMS_JobCardItem"><div class="col-xs-12 title">
<a href="${ORIGIN}/jobs/${id}/role-${id}/job?in_iframe=1" class="iCIMS_Anchor"><h3>Role ${id}</h3></a></div></li>`;
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

// A board whose page `failOn` answers `status`; every earlier page has one posting.
const ctxFailingOn = (failOn, status) => ({
  transport: 'http',
  sleep: async () => {},
  fetchJson: async () => { throw new Error('fetchJson should not be called'); },
  fetchText: async (url) => {
    const pr = Number(new URL(url).searchParams.get('pr'));
    if (pr === failOn) throw httpError(status);
    return `<ul class="iCIMS_JobsTable">${card(pr + 1)}</ul>`;
  },
});

async function failureFrom(failOn, status) {
  try {
    await icims.fetch(entry, ctxFailingOn(failOn, status));
  } catch (err) {
    return err;
  }
  throw new Error(`icims.fetch resolved although page ${failOn} answers ${status}`);
}

try {
  const firstPage404 = await failureFrom(0, 404);
  const laterPage404 = await failureFrom(1, 404);
  const laterPage429 = await failureFrom(2, 429);

  if (firstPage404.firstPage === true && isDeadBoardError(firstPage404)) pass('a first-page 404 retires (control)');
  else fail('a first-page 404 no longer counts as a dead board');
  if (laterPage404.status === 404 && laterPage404.firstPage === false && !isDeadBoardError(laterPage404)) pass('a later-page 404 is not a dead-board miss');
  else fail(`later-page 404 read as dead: firstPage=${laterPage404.firstPage}`);
  if (!isDeadBoardError(laterPage429)) pass('a later-page 429 is not a dead-board miss');
  else fail('a 429 read as dead');
  if (isDeadBoardError(httpError(404))) pass('an unmarked 404 still counts');
  else fail('an unmarked 404 stopped counting');
} catch (err) {
  fail(`dead-boards later-page test threw: ${err.message}`);
}
