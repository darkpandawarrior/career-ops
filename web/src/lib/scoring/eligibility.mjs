const GLOBAL_REMOTE_TERMS = [
  'worldwide',
  'global',
  'work from anywhere',
  'any country',
  'any location',
  'international remote',
];

const RESTRICTION_PATTERNS = [
  /remote\s*(?:-|—|–|within|from)?\s*([a-z][a-z .'-]+?)\s+only\b/i,
  /\b([a-z][a-z .'-]+)\s+only\b/i,
  /must be based in\s+([a-z][a-z .'-]+)/i,
  /remote (?:within|from)\s+([a-z][a-z .'-]+)/i,
  /authorized to work in\s+([a-z][a-z .'-]+)/i,
];

export function classifyEligibility(job, config) {
  const locationText = `${job.location || ''} ${job.snippet || ''}`.trim();
  const text = normalize(locationText);
  const home = normalize(config.location.home_country);
  const preferred = config.location.preferred_locations.map(normalize);
  const remoteRegions = config.location.remote_regions.map(normalize);
  const internationalLocations = config.location.international_locations.map(normalize);
  const scopes = new Set(config.location.search_scopes);
  const remote = /\bremote\b|work from home|distributed|work from anywhere/i.test(locationText);
  const globalRemote = GLOBAL_REMOTE_TERMS.some((term) => text.includes(term));
  const homeMentioned = Boolean(home && text.includes(home));
  const preferredMentioned = preferred.some((term) => term && text.includes(term));
  const regionMentioned = remoteRegions.some((term) => term && text.includes(term));
  const restriction = findRestriction(locationText);
  const visaMentioned = /visa sponsorship|sponsorship available|work permit|relocation support|visa support/i.test(locationText);
  const internationalMentioned = internationalLocations.some((term) => term && text.includes(term));
  const workAuthorizationBlocked = /no (?:visa )?sponsorship|unable to sponsor|must (?:already )?have (?:valid )?work authorization|must be authorized to work/i.test(locationText);

  if (remote && !scopes.has('remote')) {
    return {
      ratio: 0,
      status: 'blocked',
      label: 'Remote role excluded',
      reason: 'Remote roles were not selected in the profile search scope',
      remote,
    };
  }
  if (!remote && homeMentioned && !scopes.has('local')) {
    return {
      ratio: 0,
      status: 'blocked',
      label: 'Local role excluded',
      reason: 'Local roles were not selected in the profile search scope',
      remote,
    };
  }
  if (!remote && internationalMentioned && !scopes.has('international')) {
    return {
      ratio: 0,
      status: 'blocked',
      label: 'International role excluded',
      reason: 'International roles were not selected in the profile search scope',
      remote,
    };
  }

  if (restriction && home && !normalize(restriction).includes(home)) {
    return {
      ratio: 0,
      status: 'blocked',
      label: `Restricted to ${restriction}`,
      reason: `Remote eligibility excludes ${config.location.home_country || 'the home country'}`,
      remote,
    };
  }
  if (homeMentioned || preferredMentioned) {
    return {
      ratio: 1,
      status: 'open',
      label: remote ? 'Remote and location-aligned' : 'Location-aligned',
      reason: 'Posting explicitly matches a preferred location',
      remote,
    };
  }
  if (internationalMentioned) {
    if (config.location.visa_sponsorship_required && workAuthorizationBlocked) {
      return {
        ratio: 0,
        status: 'blocked',
        label: 'International work authorization unavailable',
        reason: 'The posting requires existing work authorization and does not support sponsorship',
        remote,
      };
    }
    if (remote && (globalRemote || regionMentioned || !restriction)) {
      return {
        ratio: 1,
        status: 'open',
        label: 'International remote eligibility',
        reason: visaMentioned
          ? 'The role is remote in a target country and mentions visa or relocation support'
          : 'The role is remote in a selected international location; work authorization should be confirmed',
        remote,
      };
    }
    return {
      ratio: visaMentioned ? 0.9 : config.location.visa_sponsorship_required ? 0.25 : 0.6,
      status: visaMentioned ? 'relocation' : 'verify',
      label: 'International target location',
      reason: visaMentioned
        ? 'Posting matches an international target and mentions visa or relocation support; onsite work ranks below eligible remote work'
        : 'Posting matches an international target, but remote work and sponsorship are not confirmed',
      remote,
    };
  }
  if (remote && (globalRemote || regionMentioned)) {
    return {
      ratio: 1,
      status: 'open',
      label: 'Remote eligibility appears open',
      reason: globalRemote ? 'Posting is globally remote' : 'Posting matches an accepted remote region',
      remote,
    };
  }
  if (remote && config.location.remote_eligibility_required) {
    return {
      ratio: 0.45,
      status: 'verify',
      label: 'Remote eligibility unclear',
      reason: 'Remote does not automatically mean the candidate can work from their home country',
      remote,
    };
  }
  if (visaMentioned && config.location.relocation !== 'closed') {
    return {
      ratio: 0.75,
      status: 'relocation',
      label: 'Relocation or visa support mentioned',
      reason: 'International eligibility needs confirmation',
      remote,
    };
  }
  return {
    ratio: preferred.length === 0 ? 0.6 : 0.35,
    status: 'verify',
    label: locationText || 'Location not listed',
    reason: 'Location fit requires review',
    remote,
  };
}

function findRestriction(value) {
  for (const pattern of RESTRICTION_PATTERNS) {
    const match = String(value).match(pattern);
    if (match?.[1]) return match[1].trim().replace(/[.,;:].*$/, '');
  }
  return '';
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
