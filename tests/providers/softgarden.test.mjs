// tests/providers/softgarden.test.mjs — moved from test-all.mjs (test-layout migration).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\n27. Provider — softgarden');

try {
  const softgarden = (await import(pathToFileURL(join(ROOT, 'providers/softgarden.mjs')).href)).default;
  const { resolveWidgetUrl, parseSoftgardenDate, parseWidget } = await import(pathToFileURL(join(ROOT, 'providers/softgarden.mjs')).href);

  if (softgarden.id === 'softgarden') pass('softgarden.id is "softgarden"');
  else fail(`softgarden.id is ${JSON.stringify(softgarden.id)}`);

  if (resolveWidgetUrl({ api: 'https://renk-group.softgarden.io/de/widgets/jobs' }) === 'https://renk-group.softgarden.io/de/widgets/jobs') {
    pass('softgarden.resolveWidgetUrl() passes through an explicit widget URL');
  } else {
    fail('softgarden.resolveWidgetUrl() should pass through an explicit /widgets/jobs URL');
  }

  if (resolveWidgetUrl({ api: 'https://renk-group.softgarden.io/careers' }) === 'https://renk-group.softgarden.io/de/widgets/jobs') {
    pass('softgarden.resolveWidgetUrl() defaults to the German widget for a bare tenant URL');
  } else {
    fail('softgarden.resolveWidgetUrl() should default to /de/widgets/jobs');
  }

  if (resolveWidgetUrl({ careers_url: 'https://acme.softgarden.io/en/vacancies' }) === 'https://acme.softgarden.io/en/widgets/jobs') {
    pass('softgarden.resolveWidgetUrl() defaults other tenant URLs to the URL\'s own lang widget');
  } else {
    fail(`softgarden.resolveWidgetUrl() lang-prefixed default wrong: ${resolveWidgetUrl({ careers_url: 'https://acme.softgarden.io/en/vacancies' })}`);
  }

  if (resolveWidgetUrl({ api: 'https://evil.com/x.softgarden.io' }) === null && resolveWidgetUrl({ api: 'https://softgarden.io.evil.com/x' }) === null) {
    pass('softgarden.resolveWidgetUrl() rejects path- and suffix-spoofed hosts');
  } else {
    fail('softgarden.resolveWidgetUrl() should reject spoofed hosts');
  }

  if (softgarden.detect({ careers_url: 'https://evil.com/x.softgarden.io' }) === null && softgarden.detect({ careers_url: 'https://softgarden.io.evil.com/x' }) === null) {
    pass('softgarden.detect() rejects path- and suffix-spoofed hosts');
  } else {
    fail('softgarden.detect() should reject spoofed hosts');
  }

  if (parseSoftgardenDate('04.07.26') === Date.UTC(2026, 6, 4) && parseSoftgardenDate('7/4/26') === Date.UTC(2026, 6, 4) && parseSoftgardenDate('junk') === undefined) {
    pass('softgarden.parseSoftgardenDate() reads dotted (D.M.Y) and slashed (M/D/Y) locales, rejects junk');
  } else {
    fail('softgarden.parseSoftgardenDate() wrong');
  }

  const html = `<div class="matchElement" id="job_id_123"><div class="matchValue date">04.07.26</div><div class="matchValue title"><a href="../../job/123/senior-dev?l=de">Senior Dev &amp; Lead</a></div><div class="matchValue ProjectGeoLocationCity"><span class="location-view-item">Munich</span></div></div>`;
  const rows = parseWidget(html, 'https://renk-group.softgarden.io/de/widgets/jobs');
  if (rows.length === 1 && rows[0].title === 'Senior Dev & Lead' && rows[0].url === 'https://renk-group.softgarden.io/job/123/senior-dev?l=de' && rows[0].location === 'Munich') {
    pass('softgarden.parseWidget() extracts title (entity-decoded), resolves relative href, and reads location');
  } else {
    fail(`softgarden.parseWidget() wrong: ${JSON.stringify(rows)}`);
  }

  const sgCtx = { fetchText: async () => html };
  const sgJobs = await softgarden.fetch({ name: 'RENK', api: 'https://renk-group.softgarden.io/de/widgets/jobs' }, sgCtx);
  if (sgJobs.length === 1 && sgJobs[0].company === 'RENK') pass('softgarden.fetch() parses the widget page and tags company from entry.name');
  else fail(`softgarden.fetch() returned ${JSON.stringify(sgJobs)}`);

  // parseWidget — multi-card, multi-city, entity-heavy fragment (upstream #1499 union).
  const sgCard = (id, title, cities) =>
    `<div class="matchElement" id="job_id_${id}">` +
    `<div class="matchValue date">04.07.26</div>` +
    `<div target="_blank" class="matchValue title"><a href="../../job/${id}/slug-${id}?jobDbPVId=9${id}&amp;l=de" target="_blank">${title}</a></div>` +
    `<div class="matchValue audience">Berufserfahrene</div>` +
    `<div class="matchValue ProjectGeoLocationCity"><div><div class="location-container">${cities.map((c) => `<span class="location-view-item">${c}</span>`).join('')}</div></div></div>` +
    `</div>`;
  const sgHtml = '<html>' + sgCard('111', 'Fachkraft (m/w/d) f&#252;r Export &amp; Zoll', ['Hannover']) + sgCard('222', 'SAP Consultant', ['Augsburg', 'M&#252;nchen']) + '</html>';
  const sgRows = parseWidget(sgHtml, 'https://renk-group.softgarden.io/de/widgets/jobs');
  if (sgRows.length === 2) pass('softgarden.parseWidget() yields one row per matchElement');
  else fail(`softgarden.parseWidget() returned ${sgRows.length}, expected 2`);
  if (sgRows[0]?.title === 'Fachkraft (m/w/d) für Export & Zoll') pass('softgarden.parseWidget() decodes entities in titles');
  else fail(`softgarden.parseWidget() title wrong: ${JSON.stringify(sgRows[0]?.title)}`);
  if (sgRows[0]?.url === 'https://renk-group.softgarden.io/job/111/slug-111?jobDbPVId=9111&l=de') pass('softgarden.parseWidget() resolves ../../job/ hrefs against the widget path');
  else fail(`softgarden.parseWidget() url wrong: ${JSON.stringify(sgRows[0]?.url)}`);
  if (sgRows[1]?.location === 'Augsburg / München' && sgRows[0]?.postedAt === Date.UTC(2026, 6, 4)) pass('softgarden.parseWidget() joins cities and parses the date');
  else fail(`softgarden.parseWidget() fields wrong: ${JSON.stringify(sgRows[1])}`);
  if (parseWidget('<html>none</html>', 'https://x.softgarden.io/de/widgets/jobs').length === 0 && parseWidget(undefined, 'https://x').length === 0) {
    pass('softgarden.parseWidget() returns [] for card-less / non-string input');
  } else {
    fail('softgarden.parseWidget() should return [] without cards');
  }

  // fetch() — single widget request, jobs normalized from a multi-card page.
  const sgCtx2 = { fetchText: async () => sgHtml };
  const sgJobs2 = await softgarden.fetch({ name: 'Renk', api: 'https://renk-group.softgarden.io/de/widgets/jobs' }, sgCtx2);
  if (sgJobs2.length === 2 && sgJobs2[0].company === 'Renk' && sgJobs2.every((j) => j.url.startsWith('https://renk-group.softgarden.io/job/'))) {
    pass('softgarden.fetch() returns normalized jobs from one widget request');
  } else {
    fail(`softgarden.fetch() wrong: ${JSON.stringify(sgJobs2)}`);
  }
} catch (e) {
  fail(`softgarden provider tests crashed: ${e.message}`);
}

