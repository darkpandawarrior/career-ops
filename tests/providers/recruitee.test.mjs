// tests/providers/recruitee.test.mjs — moved from test-all.mjs (test-layout migration).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\n14. Provider — recruitee');

try {
  const recruitee = (await import(pathToFileURL(join(ROOT, 'providers/recruitee.mjs')).href)).default;
  const { parseRecruiteeResponse } = await import(pathToFileURL(join(ROOT, 'providers/recruitee.mjs')).href);

  if (recruitee.id === 'recruitee') pass('recruitee.id is "recruitee"');
  else fail(`recruitee.id is ${JSON.stringify(recruitee.id)}`);

  const hit = recruitee.detect({ name: 'Channable', careers_url: 'https://channable.recruitee.com' });
  if (hit && hit.url === 'https://channable.recruitee.com/api/offers/') {
    pass('recruitee.detect() resolves <slug>.recruitee.com → api offers');
  } else {
    fail(`recruitee.detect() returned ${JSON.stringify(hit)}`);
  }

  if (recruitee.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('recruitee.detect() returns null for non-recruitee URLs');
  } else {
    fail('recruitee.detect() should return null for non-recruitee URLs');
  }

  // parseRecruiteeResponse
  const sample = {
    offers: [
      { title: 'Senior PM', careers_url: 'https://channable.recruitee.com/o/senior-pm', city: 'Utrecht', country: 'Netherlands', remote: false },
      { title: 'Backend Eng', url: 'https://channable.recruitee.com/o/backend', city: 'Amsterdam', country: 'Netherlands', remote: true },
      { title: 'AI Lead', location: 'Remote, EMEA' },
    ],
  };
  const jobs = parseRecruiteeResponse(sample, 'Channable');
  if (jobs.length === 3) pass('parseRecruiteeResponse extracts 3 offers');
  else fail(`parseRecruiteeResponse returned ${jobs.length} offers`);

  if (jobs[0]?.title === 'Senior PM' && jobs[0]?.company === 'Channable' && jobs[0]?.url === 'https://channable.recruitee.com/o/senior-pm') {
    pass('parseRecruiteeResponse prefers careers_url field over url');
  } else {
    fail(`row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[1]?.location === 'Amsterdam, Netherlands, Remote') {
    pass('parseRecruiteeResponse assembles city/country/remote when no location field');
  } else {
    fail(`row 1 location = ${JSON.stringify(jobs[1]?.location)}, expected "Amsterdam, Netherlands, Remote"`);
  }

  if (jobs[2]?.location === 'Remote, EMEA') {
    pass('parseRecruiteeResponse uses explicit location field when present');
  } else {
    fail(`row 2 location = ${JSON.stringify(jobs[2]?.location)}`);
  }

  if (parseRecruiteeResponse({}, 'X').length === 0) pass('empty {} → empty result');
  else fail('empty {} should yield empty result');

  if (parseRecruiteeResponse({ offers: null }, 'X').length === 0) {
    pass('null offers → empty result (no crash)');
  } else {
    fail('null offers should yield empty result');
  }

  // careers_url with non-string value → detect() returns null without crashing
  if (recruitee.detect({ name: 'X', careers_url: null }) === null && recruitee.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('recruitee.detect() returns null for non-string careers_url (null and 7)');
  } else {
    fail('recruitee.detect() should treat non-string careers_url as missing');
  }

  // SSRF: malicious URL with recruitee.com in the PATH (not host) must not be detected.
  if (recruitee.detect({ name: 'Spoof', careers_url: 'https://evil.example/channable.recruitee.com/foo' }) === null) {
    pass('recruitee.detect() rejects path-spoofed URLs');
  } else {
    fail('recruitee.detect() must NOT misdetect path-spoofed URLs');
  }

  // URL validation: per #1116, offer URLs are display-only (never server-
  // fetched) and Recruitee tenants commonly publish on their own custom
  // domain, so only protocol (https-only) is validated — host is NOT
  // restricted to *.recruitee.com.
  const offDomainOffers = parseRecruiteeResponse(
    {
      offers: [
        { title: 'Good', careers_url: 'https://channable.recruitee.com/o/good' },
        { title: 'CustomDomain', careers_url: 'https://careers.hostaway.com/o/custom' },
        { title: 'Insecure', careers_url: 'http://channable.recruitee.com/o/insecure' },
        { title: 'No URL field' },
      ],
    },
    'Channable',
  );
  if (offDomainOffers[0]?.url === 'https://channable.recruitee.com/o/good' && offDomainOffers[1]?.url === 'https://careers.hostaway.com/o/custom' && offDomainOffers[2]?.url === '' && offDomainOffers[3]?.url === '') {
    pass('parseRecruiteeResponse keeps any https offer URL (incl. custom domains) and drops non-https/missing ones');
  } else {
    fail(`URL validation: row0=${JSON.stringify(offDomainOffers[0]?.url)}, row1=${JSON.stringify(offDomainOffers[1]?.url)}, row2=${JSON.stringify(offDomainOffers[2]?.url)}, row3=${JSON.stringify(offDomainOffers[3]?.url)}`);
  }

  // fetch() — derives the API URL, forwards the SSRF guard (redirect:'error'),
  // and returns parsed offers (upstream #1499 union).
  let fetchedUrl = null;
  let fetchedOpts = null;
  const fetchJobs = await recruitee.fetch(
    { name: 'Channable', careers_url: 'https://channable.recruitee.com/' },
    { fetchJson: async (url, opts) => { fetchedUrl = url; fetchedOpts = opts; return { offers: [{ title: 'Senior PM', careers_url: 'https://channable.recruitee.com/o/senior-pm' }] }; } },
  );
  if (fetchedUrl === 'https://channable.recruitee.com/api/offers/' && fetchedOpts?.redirect === 'error' && fetchJobs.length === 1) {
    pass('recruitee.fetch() hits /api/offers/ with redirect:"error" and returns parsed offers');
  } else {
    fail(`recruitee.fetch() url=${JSON.stringify(fetchedUrl)} opts=${JSON.stringify(fetchedOpts)} jobs=${fetchJobs.length}`);
  }

  // fetch() refuses entries whose careers_url can't derive a trusted
  // <slug>.recruitee.com API URL — the guard chain must run before any request.
  try {
    await recruitee.fetch(
      { name: 'Evil', careers_url: 'https://evil.example.com/careers' },
      { fetchJson: async () => { throw new Error('must not be called'); } },
    );
    fail('recruitee.fetch() should throw for an untrusted careers_url');
  } catch (e) {
    if (/cannot derive API URL for Evil/.test(e.message)) {
      pass('recruitee.fetch() throws before fetching when the host is untrusted');
    } else {
      fail(`recruitee.fetch() threw the wrong error: ${e.message}`);
    }
  }

  // ── Description (#3175 phase 2) ──
  // Recruitee's list payload embeds each offer's HTML body for free — same
  // request, no per-job fetch. It must arrive as plain text (tags stripped,
  // entities decoded), and offers without a body omit the key entirely.
  const descOffers = parseRecruiteeResponse(
    {
      offers: [
        {
          title: 'With body',
          careers_url: 'https://channable.recruitee.com/o/with-body',
          description: '&lt;p&gt;Build &lt;strong&gt;pipelines&lt;/strong&gt; at Hostaway&amp;rsquo;s HQ&lt;/p&gt;&lt;script&gt;evil()&lt;/script&gt;',
        },
        { title: 'Without body', careers_url: 'https://channable.recruitee.com/o/no-body' },
        { title: 'Empty body', description: '   ' },
      ],
    },
    'Channable',
  );
  if (descOffers[0]?.description === "Build pipelines at Hostaway’s HQ") {
    pass('parseRecruiteeResponse double-decodes the offer body to plain text (tags + script gone)');
  } else {
    fail(`row 0 description = ${JSON.stringify(descOffers[0]?.description)}`);
  }
  if (!('description' in descOffers[1]) && !('description' in descOffers[2])) {
    pass('parseRecruiteeResponse omits the description key when the offer has no usable body');
  } else {
    fail(`rows 1-2 = ${JSON.stringify(descOffers.slice(1))}`);
  }

} catch (e) {
  fail(`recruitee provider tests crashed: ${e.message}`);
}

// ── 12. TRACKER REPORT LINK NORMALIZATION (#760) ────────────────

