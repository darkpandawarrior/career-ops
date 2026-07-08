// tests/providers/successfactors.test.mjs — moved from test-all.mjs (test-layout migration).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\n29. Provider — successfactors (RMK tile scraper + CSB fallback)');

try {
  const successfactors = (await import(pathToFileURL(join(ROOT, 'providers/successfactors.mjs')).href)).default;
  const { parseTiles, extractLocales, parseCsbDate, cleanCsbLocation, parseCsbJobs } =
    await import(pathToFileURL(join(ROOT, 'providers/successfactors.mjs')).href);

  if (successfactors.id === 'successfactors') pass('successfactors.id is "successfactors"');
  else fail(`successfactors.id is ${JSON.stringify(successfactors.id)}`);

  if (successfactors.detect({ careers_url: 'https://career5.successfactors.eu/career' })) pass('successfactors.detect() claims a *.successfactors.eu URL');
  else fail('successfactors.detect() should claim successfactors.eu');
  if (successfactors.detect({ careers_url: 'https://jobs.zf.com/search/' }) === null) pass('successfactors.detect() does not auto-claim a branded RMK host with no successfactors/jobs2web string');
  else fail('successfactors.detect() must require an explicit provider: for branded RMK hosts');

  // RMK tile parsing
  const tileHtml = `<li class="job-tile job-id-1001"><a class="jobTitle-link" data-url="/job/Munich-Senior-Engineer-REQ1/1001/">Senior Engineer &amp; Lead</a></li>` +
    `<li class="job-tile job-id-1002"><a class="jobTitle-link" data-url="https://jobs.zf.com/job/Berlin-Analyst-2/1002/">Analyst</a><div id="x-section-city-value">Berlin</div></li>`;
  const tiles = parseTiles(tileHtml, 'https://jobs.zf.com');
  if (tiles.length === 2) pass('parseTiles returns 2 tiles');
  else fail(`parseTiles returned ${tiles.length}, expected 2`);
  const t1 = tiles.find((t) => t.id === '1001');
  if (t1 && t1.title === 'Senior Engineer & Lead' && t1.url === 'https://jobs.zf.com/job/Munich-Senior-Engineer-REQ1/1001/') {
    pass('parseTiles decodes the title entity and resolves a relative data-url');
  } else {
    fail(`parseTiles tile 1 wrong: ${JSON.stringify(t1)}`);
  }
  const t2 = tiles.find((t) => t.id === '1002');
  if (t2 && t2.location === 'Berlin') pass('parseTiles reads an explicit city field when rendered');
  else fail(`parseTiles tile 2 location wrong: ${JSON.stringify(t2)}`);

  // CSB helpers
  if (parseCsbDate('6/18/26') === Date.UTC(2026, 5, 18) && parseCsbDate('20.11.23') === Date.UTC(2023, 10, 20) && parseCsbDate('junk') === undefined) {
    pass('parseCsbDate reads US slash (M/D/Y) and EU dot (D.M.Y) formats, rejects junk');
  } else {
    fail('parseCsbDate wrong');
  }
  if (cleanCsbLocation(['Karlovy Vary, CZE, 36004<br/>', 'Karlovy Vary, CZE, 36004<br/>', 'Prague, CZE']) === 'Karlovy Vary, CZE, 36004 / Prague, CZE') {
    pass('cleanCsbLocation strips markup, dedupes, and joins multiple locations');
  } else {
    fail('cleanCsbLocation wrong');
  }
  const csbRows = parseCsbJobs(
    { jobSearchResult: [{ response: { id: 55, unifiedStandardTitle: 'Data Engineer', unifiedUrlTitle: 'data-engineer', jobLocationShort: ['Munich, DEU'], unifiedStandardStart: '6/18/26' } }] },
    { origin: 'https://careers.example.com' },
    'en_US',
  );
  if (csbRows.length === 1 && csbRows[0].url === 'https://careers.example.com/job/data-engineer/55-en_US' && csbRows[0].postedAt === Date.UTC(2026, 5, 18)) {
    pass('parseCsbJobs maps id/title/url/postedAt from the jobs API response');
  } else {
    fail(`parseCsbJobs wrong: ${JSON.stringify(csbRows)}`);
  }
  const locales = extractLocales('<a href="/search/?q=&startrow=0&amp;locale=de_DE">DE</a><a href="/search/?locale=en_US">EN</a>');
  if (locales[0] === 'de_DE' && locales.includes('en_US')) pass('extractLocales discovers and priority-orders tenant locales');
  else fail(`extractLocales wrong: ${JSON.stringify(locales)}`);

  // fetch() strategy selection
  const rmkCtx = { fetchText: async () => tileHtml };
  const rmkJobs = await successfactors.fetch({ name: 'ZF', api: 'https://jobs.zf.com' }, rmkCtx);
  if (rmkJobs.length === 2) pass('successfactors.fetch() uses RMK when the tile scraper returns postings');
  else fail(`successfactors.fetch() RMK path returned ${rmkJobs.length} jobs, expected 2`);

  // A blank RMK page (0 tiles) must fall through to CSB automatically.
  const fallbackCtx = {
    fetchText: async () => '',
    fetchJson: async () => ({ jobSearchResult: [{ response: { id: 9, unifiedStandardTitle: 'CSB Role', unifiedUrlTitle: 'csb-role', unifiedStandardStart: '1/1/26' } }], totalJobs: 1 }),
  };
  const fallbackJobs = await successfactors.fetch({ name: 'Tenant', api: 'https://careers.example.com' }, fallbackCtx);
  if (fallbackJobs.length === 1 && fallbackJobs[0].title === 'CSB Role') pass('successfactors.fetch() auto-falls back to CSB when RMK yields zero postings');
  else fail(`successfactors.fetch() RMK-empty fallback wrong: ${JSON.stringify(fallbackJobs)}`);

  let rmkCalled = false;
  const csbForcedCtx = {
    fetchText: async () => { rmkCalled = true; return ''; }, // only the /search/ locale-discovery call should hit fetchText
    fetchJson: async () => ({ jobSearchResult: [{ response: { id: 7, unifiedStandardTitle: 'Forced CSB', unifiedUrlTitle: 'x' } }], totalJobs: 1 }),
  };
  const forced = await successfactors.fetch({ name: 'Tenant', api: 'https://careers.example.com', sfVariant: 'csb' }, csbForcedCtx);
  if (forced.length === 1 && forced[0].title === 'Forced CSB') pass('successfactors.fetch() honors an explicit sfVariant: "csb" override, skipping the RMK tile probe');
  else fail(`successfactors.fetch() explicit CSB override wrong: ${JSON.stringify(forced)}`);

  // ctx.maxPages bounds pages-per-locale even when totalJobs implies more pages
  // exist. Pin locale discovery to a single locale so the count isolates the
  // per-locale page cap from the (separate) multi-locale loop.
  let csbCalls = 0;
  const boundedCtx = {
    fetchText: async () => '<a href="/search/?locale=de_DE">DE</a>',
    fetchJson: async () => { csbCalls++; return { jobSearchResult: [{ response: { id: String(csbCalls), unifiedStandardTitle: `Role ${csbCalls}`, unifiedUrlTitle: 'x' } }], totalJobs: 999 }; },
    maxPages: 1,
  };
  await successfactors.fetch({ name: 'Tenant', api: 'https://careers.example.com', sfVariant: 'csb' }, boundedCtx);
  if (csbCalls === 1) pass('successfactors.fetch() CSB path honors ctx.maxPages (bounded health-probe budget)');
  else fail(`successfactors.fetch() CSB path made ${csbCalls} calls under ctx.maxPages:1 with 1 locale, expected 1`);
} catch (e) {
  fail(`successfactors provider tests crashed: ${e.message}`);
}

