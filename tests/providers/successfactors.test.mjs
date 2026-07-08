// tests/providers/successfactors.test.mjs — moved from test-all.mjs (test-layout migration).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\n29. Provider — successfactors (RMK tile scraper + CSB fallback)');

try {
  const successfactors = (await import(pathToFileURL(join(ROOT, 'providers/successfactors.mjs')).href)).default;
  const { parseTiles, cityFromSlug, extractLocales, parseCsbDate, cleanCsbLocation, parseCsbJobs } =
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

  // parseTiles — a compact fragment covering title-entity decoding, &amp; in
  // data-url, slug-fallback city, desktop/tablet/mobile collapse, and a
  // title-less tile that must be dropped (upstream #1499 union).
  const jobBase2 = 'https://jobs.example.com';
  const fragment = `
    <ul>
      <li class="job-tile job-id-111 job-row-index-1" data-url="/job/Schweinfurt-Ferienarbeiter-97421/111/">
        <a class="jobTitle-link fontcolorx" href="/job/Schweinfurt-Ferienarbeiter-97421/111/">Ferienarbeiter (m&#47;w&#47;d)</a>
        <div id="job-111-desktop-section-city" class="section-field city">
          <span id="job-111-desktop-section-city-label" aria-describedby="job-111-desktop-section-city-value" class="section-label sr-only">City</span>
          <div id="job-111-desktop-section-city-value">Schweinfurt                 </div>
        </div>
      </li>
      <li class="job-tile job-id-222 job-row-index-2" data-url="/job/Palo-Alto-Program-&amp;-Release-Manager-CA-94304/222/">
        <a class="jobTitle-link fontcolorx" href="/x">Program &amp; Release Manager</a>
      </li>
      <li class="job-tile job-id-333 job-row-index-3" data-url="/job/no-title/333/">
      </li>
    </ul>`;
  const parsedFrag = parseTiles(fragment, jobBase2);
  if (parsedFrag.length === 2) pass('parseTiles returns 2 jobs (title-less tile dropped)');
  else fail(`parseTiles returned ${parsedFrag.length} jobs, expected 2`);
  const f1 = parsedFrag.find((j) => j.url.includes('/111/'));
  if (f1 && f1.title === 'Ferienarbeiter (m/w/d)') pass('parseTiles decodes entity in title');
  else fail(`parseTiles title wrong: ${JSON.stringify(f1 && f1.title)}`);
  if (f1 && f1.location === 'Schweinfurt') pass('parseTiles reads the city-value div, not the "City" label');
  else fail(`parseTiles city wrong: ${JSON.stringify(f1 && f1.location)}`);
  if (f1 && f1.url === 'https://jobs.example.com/job/Schweinfurt-Ferienarbeiter-97421/111/') pass('parseTiles builds an absolute URL from data-url');
  else fail(`parseTiles url wrong: ${JSON.stringify(f1 && f1.url)}`);
  const f2 = parsedFrag.find((j) => j.url.includes('/222/'));
  if (f2 && f2.url === 'https://jobs.example.com/job/Palo-Alto-Program-&-Release-Manager-CA-94304/222/') {
    pass('parseTiles decodes &amp; in the data-url path');
  } else {
    fail(`parseTiles &amp; url wrong: ${JSON.stringify(f2 && f2.url)}`);
  }
  if (f2 && f2.location === 'Palo Alto') pass('parseTiles falls back to slug city when no city div is present');
  else fail(`parseTiles slug-fallback city wrong: ${JSON.stringify(f2 && f2.location)}`);
  if (parseTiles('<!DOCTYPE html>', jobBase2).length === 0) pass('parseTiles returns [] for an empty fragment');
  else fail('parseTiles should return [] for an empty fragment');

  // cityFromSlug — recover the city prefix from an RMK /job/{City}-{Title}-{code}/ slug.
  if (cityFromSlug('/job/Hyderabad-Specialist-Low-Level-Driver-Development-TG-500032/1399717233/', 'Specialist -Low Level Driver Development') === 'Hyderabad') {
    pass('cityFromSlug extracts a single-word city');
  } else {
    fail(`cityFromSlug single-word wrong: ${cityFromSlug('/job/Hyderabad-Specialist-Low-Level-Driver-Development-TG-500032/1399717233/', 'Specialist -Low Level Driver Development')}`);
  }
  if (cityFromSlug('/job/Levallois-Perret-Data-Management-Engagement-Architect-92300/1400945133/', 'Data Management Engagement Architect') === 'Levallois Perret') {
    pass('cityFromSlug extracts a multi-word city');
  } else {
    fail(`cityFromSlug multi-word wrong: ${cityFromSlug('/job/Levallois-Perret-Data-Management-Engagement-Architect-92300/1400945133/', 'Data Management Engagement Architect')}`);
  }
  if (cityFromSlug('/job/Massy-Ing%C3%A9nieur-Commercial-91743/1351400755/', 'Ingénieur Commercial') === 'Massy') {
    pass('cityFromSlug handles accented (unicode) titles');
  } else {
    fail(`cityFromSlug accented wrong: ${cityFromSlug('/job/Massy-Ing%C3%A9nieur-Commercial-91743/1351400755/', 'Ingénieur Commercial')}`);
  }

  // CSB helpers
  if (parseCsbDate('6/18/26') === Date.UTC(2026, 5, 18) && parseCsbDate('20.11.23') === Date.UTC(2023, 10, 20) && parseCsbDate('junk') === undefined) {
    pass('parseCsbDate reads US slash (M/D/Y) and EU dot (D.M.Y) formats, rejects junk');
  } else {
    fail('parseCsbDate wrong');
  }
  if (parseCsbDate('garbage') === undefined && parseCsbDate('13/40/99') === undefined && parseCsbDate('') === undefined) {
    pass('parseCsbDate returns undefined for junk / out-of-range / empty');
  } else {
    fail('parseCsbDate should reject junk, out-of-range, and empty input');
  }
  if (cleanCsbLocation(['Karlovy Vary, CZE, 36004<br/>', 'Karlovy Vary, CZE, 36004<br/>', 'Prague, CZE']) === 'Karlovy Vary, CZE, 36004 / Prague, CZE') {
    pass('cleanCsbLocation strips markup, dedupes, and joins multiple locations');
  } else {
    fail('cleanCsbLocation wrong');
  }
  if (cleanCsbLocation(undefined) === '' && cleanCsbLocation([]) === '') pass('cleanCsbLocation tolerates missing/empty location');
  else fail('cleanCsbLocation should return "" for missing/empty input');
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
  // parseCsbJobs — drops id/title-less records; sanitizes &amp;/URL-structural
  // chars out of a cosmetic slug (upstream #1499 union).
  const csbJson2 = {
    jobSearchResult: [
      { response: { id: '31099', unifiedStandardTitle: 'Analytical Lab Technician', unifiedUrlTitle: 'Analytical-Lab-Technician', jobLocationShort: ['Anyang, KOR, 14058<br/>'], unifiedStandardStart: '6/18/26' } },
      { response: { id: '1283', unifiedStandardTitle: 'Senior Expert Mergers & Acquisitions (m/f/d)', unifiedUrlTitle: 'Senior-Expert-Mergers-&amp;-Acquisitions-%28mfd%29', jobLocationShort: ['Munich<br/>'], unifiedStandardStart: '4/21/26' } },
      { response: { id: '', unifiedStandardTitle: 'No ID — dropped', unifiedUrlTitle: 'x' } },
      { response: { id: '999', unifiedStandardTitle: '', unifiedUrlTitle: 'no-title-dropped' } },
    ],
  };
  const csbRows2 = parseCsbJobs(csbJson2, { origin: 'https://jobs.example.com' }, 'en_US');
  if (csbRows2.length === 2) pass('parseCsbJobs drops records missing id or title');
  else fail(`parseCsbJobs returned ${csbRows2.length}, expected 2`);
  const cr2 = csbRows2[1];
  if (cr2 && !/[?#&]|&amp;/.test(new URL(cr2.url).pathname)) pass('parseCsbJobs sanitizes &amp; / URL-structural chars out of the slug');
  else fail(`parseCsbJobs slug not sanitized: ${JSON.stringify(cr2 && cr2.url)}`);

  const locales = extractLocales('<a href="/search/?q=&startrow=0&amp;locale=de_DE">DE</a><a href="/search/?locale=en_US">EN</a>');
  if (locales[0] === 'de_DE' && locales.includes('en_US')) pass('extractLocales discovers and priority-orders tenant locales');
  else fail(`extractLocales wrong: ${JSON.stringify(locales)}`);
  const switcherHtml =
    '<a href="/search/?q=&amp;startrow=0&amp;locale=fr_FR">FR</a>' +
    '<a href="/search/?q=&amp;startrow=0&amp;locale=en_US">EN</a>' +
    '<a href="/search/?q=&amp;startrow=0&amp;locale=de_DE">DE</a>' +
    '<a href="/search/?q=&amp;startrow=0&amp;locale=de_DE">DE dup</a>';
  const locs2 = extractLocales(switcherHtml);
  if (JSON.stringify(locs2) === JSON.stringify(['de_DE', 'en_US', 'fr_FR'])) {
    pass('extractLocales dedups and priority-orders (de_DE, en_US, then alpha)');
  } else {
    fail(`extractLocales wrong: ${JSON.stringify(locs2)}`);
  }
  if (extractLocales('<p>no locales here</p>').length === 0) pass('extractLocales returns [] when the page carries none');
  else fail('extractLocales should return [] for a page with no locale links');

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

