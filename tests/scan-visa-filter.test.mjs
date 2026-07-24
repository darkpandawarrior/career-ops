// tests/scan-visa-filter.test.mjs — visa_filter (US work-authorization
// sponsorship), ported from upstream (#1662). Same shape as content_filter:
// reads the job DESCRIPTION text, absent/disabled config passes everything.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nscan.mjs — visa_filter (#1662)');

const { buildVisaFilter } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

// Absent config (or enabled: false) → all jobs pass.
{
  const noVisaFilter = buildVisaFilter(null);
  const offVisaFilter = buildVisaFilter({ enabled: false, negative: ['no sponsorship'] });
  if (
    noVisaFilter('no visa sponsorship, must be authorized') === true &&
    noVisaFilter('') === true &&
    offVisaFilter('no sponsorship offered') === true
  ) {
    pass('visa_filter absent or disabled → all jobs pass');
  } else {
    fail('visa_filter absent/disabled should pass all jobs');
  }
}

// Default mode (require_mention: false): drop only explicit rejections,
// keep everything else — including jobs with no description.
{
  const visa = buildVisaFilter({ enabled: true });
  if (
    visa('We are unable to sponsor visas for this role') === false &&
    visa('This role does not offer visa sponsorship') === false &&
    visa('Applicants must be authorized to work with no sponsorship') === false
  ) {
    pass('visa_filter rejects postings that explicitly refuse sponsorship');
  } else {
    fail('visa_filter should reject explicit no-sponsorship postings');
  }
  if (
    visa('We happily provide visa sponsorship including H-1B') === true &&
    visa('A generic engineering role with a collaborative team') === true &&
    visa('') === true &&
    visa(undefined) === true
  ) {
    pass('visa_filter default keeps sponsoring and unstated postings');
  } else {
    fail('visa_filter default should keep sponsoring and unstated postings');
  }
}

// Strict mode (require_mention: true): keep only postings that advertise
// sponsorship; unstated / missing descriptions are rejected.
{
  const strictVisa = buildVisaFilter({ enabled: true, require_mention: true });
  if (
    strictVisa('We sponsor H1B1 and H-1B candidates') === true &&
    strictVisa('Relocation and visa sponsorship provided') === true
  ) {
    pass('visa_filter strict keeps postings that advertise sponsorship');
  } else {
    fail('visa_filter strict should keep sponsoring postings');
  }
  if (
    strictVisa('A generic engineering role with a collaborative team') === false &&
    strictVisa('') === false &&
    strictVisa(null) === false &&
    strictVisa('no visa sponsorship available') === false
  ) {
    pass('visa_filter strict drops unstated, empty, and no-sponsorship postings');
  } else {
    fail('visa_filter strict should drop unstated/empty/no-sponsorship postings');
  }
}

// Custom keyword lists override the built-in defaults.
{
  const customVisa = buildVisaFilter({ enabled: true, require_mention: true, positive: ['tier 2 sponsorship'] });
  if (
    customVisa('We hold a Tier 2 sponsorship licence') === true &&
    customVisa('We sponsor H-1B visas') === false
  ) {
    pass('visa_filter honors custom positive keyword lists over defaults');
  } else {
    fail('visa_filter should honor custom positive keyword lists');
  }
}
