// tests/providers/beesite.test.mjs — moved from test-all.mjs (test-layout migration).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\n26. Provider — beesite');

try {
  const beesite = (await import(pathToFileURL(join(ROOT, 'providers/beesite.mjs')).href)).default;
  const { resolveConfig, buildSearchUrl, parseBeesiteDate, parseSearchResult } = await import(pathToFileURL(join(ROOT, 'providers/beesite.mjs')).href);

  if (beesite.id === 'beesite') pass('beesite.id is "beesite"');
  else fail(`beesite.id is ${JSON.stringify(beesite.id)}`);

  const cfg = resolveConfig({
    name: 'MB',
    api: 'https://mercedes-benz-beesite-production-gjb.app.beesite.de',
    beesite: { languageCode: 'DE', searchCriteria: [{ CriterionName: 'PositionLocation.Country', CriterionValue: [329] }] },
  });
  if (cfg && cfg.searchApi === 'https://mercedes-benz-beesite-production-gjb.app.beesite.de/search' && cfg.languageCode === 'DE' && cfg.searchCriteria.length === 1) {
    pass('beesite.resolveConfig() parses host and passes the beesite config block through');
  } else {
    fail(`beesite.resolveConfig() wrong: ${JSON.stringify(cfg)}`);
  }

  if (beesite.detect({ careers_url: 'https://evil.com/x.beesite.de' }) === null && beesite.detect({ careers_url: 'https://beesite.de.evil.com/x' }) === null) {
    pass('beesite.detect() rejects path- and suffix-spoofed hosts');
  } else {
    fail('beesite.detect() should reject spoofed hosts');
  }

  // buildSearchUrl() itself just passes firstItem through verbatim — the 1-based
  // convention (page * PAGE_SIZE + 1) is the caller's responsibility (see fetch()).
  const url = buildSearchUrl({ searchApi: 'https://x.app.beesite.de/search', languageCode: 'EN', searchCriteria: [] }, 1);
  if (url.startsWith('https://x.app.beesite.de/search?data=') && decodeURIComponent(url.split('data=')[1]).includes('"FirstItem":1')) {
    pass('beesite.buildSearchUrl() encodes the given FirstItem');
  } else {
    fail(`beesite.buildSearchUrl() wrong: ${url.slice(0, 140)}`);
  }

  if (parseBeesiteDate('2026-07-04') === Date.UTC(2026, 6, 4) && parseBeesiteDate('junk') === undefined) {
    pass('beesite.parseBeesiteDate() reads YYYY-MM-DD, rejects junk');
  } else {
    fail('beesite.parseBeesiteDate() wrong');
  }

  const { total, rows } = parseSearchResult({
    SearchResult: {
      SearchResultCountAll: 2,
      SearchResultItems: [
        { MatchedObjectId: '1', MatchedObjectDescriptor: { PositionID: 'x1', PositionTitle: 'Engineer', PositionURI: 'https://jobs.mercedes-benz.com/1', PositionLocation: [{ CityName: 'Bremen' }], PublicationStartDate: '2026-07-01' } },
        { MatchedObjectId: '2', MatchedObjectDescriptor: { PositionID: 'x2', PositionTitle: 'No URL' } },
      ],
    },
  });
  if (total === 2 && rows.length === 1 && rows[0].location === 'Bremen') {
    pass('beesite.parseSearchResult() maps items, joins cities, drops non-absolute URIs');
  } else {
    fail(`beesite.parseSearchResult() wrong: total=${total} rows=${JSON.stringify(rows)}`);
  }

  const beeCtx = { fetchJson: async () => ({ SearchResult: { SearchResultCountAll: 1, SearchResultItems: [{ MatchedObjectId: '9', MatchedObjectDescriptor: { PositionID: '9', PositionTitle: 'Dev', PositionURI: 'https://jobs.mercedes-benz.com/9', PublicationStartDate: '2026-07-01' } }] } }), sleep: async () => {} };
  const beeJobs = await beesite.fetch({ name: 'MB', api: 'https://x.app.beesite.de' }, beeCtx);
  if (beeJobs.length === 1 && beeJobs[0].company === 'MB') pass('beesite.fetch() stops after a short page and tags company from entry.name');
  else fail(`beesite.fetch() returned ${JSON.stringify(beeJobs)}`);
} catch (e) {
  fail(`beesite provider tests crashed: ${e.message}`);
}

