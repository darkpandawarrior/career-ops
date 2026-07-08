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

  if (resolveWidgetUrl({ api: 'https://evil.com/x.softgarden.io' }) === null && resolveWidgetUrl({ api: 'https://softgarden.io.evil.com/x' }) === null) {
    pass('softgarden.resolveWidgetUrl() rejects path- and suffix-spoofed hosts');
  } else {
    fail('softgarden.resolveWidgetUrl() should reject spoofed hosts');
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
} catch (e) {
  fail(`softgarden provider tests crashed: ${e.message}`);
}

