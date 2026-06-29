const DEFAULT_WEIGHTS = Object.freeze({
  skills: 45,
  experience: 25,
  eligibility: 15,
  notice_education: 10,
  other: 5,
});

const SKILL_KEYS = [
  'demonstrated',
  'confirmed_unlisted',
  'supporting',
  'learning',
  'recommended_gaps',
  'excluded',
];

export function normalizeJobSearchConfig(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const legacyCore = cleanStrings(source.skills?.core);
  const unifiedSkills = cleanStrings(source.skills?.all);
  const skills = Object.fromEntries(
    SKILL_KEYS.map((key) => [key, cleanStrings(source.skills?.evidence?.[key] ?? source.skills?.[key])]),
  );
  skills.demonstrated = unique([...skills.demonstrated, ...legacyCore]);
  const classifiedSkills = unique(SKILL_KEYS.flatMap((key) => skills[key]));
  skills.confirmed_unlisted = unique([
    ...skills.confirmed_unlisted,
    ...unifiedSkills.filter((skill) => !includesIgnoreCase(classifiedSkills, skill)),
  ]);
  skills.all = unique([
    ...unifiedSkills,
    ...skills.demonstrated,
    ...skills.confirmed_unlisted,
    ...skills.supporting,
    ...skills.learning,
  ].filter((skill) => !includesIgnoreCase(skills.excluded, skill)));

  const legacyStrong = cleanStrings(source.titles?.strong);
  const legacyAdjacent = cleanStrings(source.titles?.adjacent);
  const interestedRoles = unique([
    ...cleanStrings(source.interested_roles),
    ...cleanStrings(source.titles?.interested),
    ...legacyStrong,
    ...legacyAdjacent,
  ]);

  const weights = normalizeWeights(source.weights);
  return {
    current_role: cleanString(source.current_role),
    titles: {
      interested: interestedRoles,
      strong: legacyStrong.length ? legacyStrong : interestedRoles,
      adjacent: legacyAdjacent,
      exclude: cleanStrings(source.titles?.exclude),
    },
    interested_roles: interestedRoles,
    skills,
    seniority: {
      minimum_years: finiteOrNull(source.seniority?.minimum_years),
      maximum_years: finiteOrNull(source.seniority?.maximum_years),
      preferred_levels: cleanStrings(source.seniority?.preferred_levels),
    },
    availability: {
      notice_period: cleanString(source.availability?.notice_period),
    },
    education: {
      levels: cleanStrings(source.education?.levels),
      certifications: cleanStrings(source.education?.certifications),
    },
    employment_types: cleanStrings(source.employment_types || source.employment_type),
    location: {
      home_country: cleanString(source.location?.home_country),
      preferred_locations: cleanStrings(source.location?.preferred_locations),
      remote_eligibility_required: source.location?.remote_eligibility_required !== false,
      remote_regions: cleanStrings(source.location?.remote_regions),
      search_scopes: normalizeSearchScopes(source.location),
      international_locations: cleanStrings(source.location?.international_locations),
      relocation: cleanString(source.location?.relocation || 'unknown'),
      work_mode: cleanString(source.location?.work_mode || 'remote_and_local'),
      visa_sponsorship_required: source.location?.visa_sponsorship_required === true,
    },
    compensation: {
      home_country: normalizeCompensation(source.compensation?.home_country),
      remote: normalizeCompensation(source.compensation?.remote),
      international: normalizeCompensation(source.compensation?.international),
    },
    preferences: {
      domains: cleanStrings(source.preferences?.domains),
      company_types: cleanStrings(source.preferences?.company_types),
      negative_keywords: cleanStrings(source.preferences?.negative_keywords),
    },
    weights,
  };
}

export function validateJobSearchConfig(input) {
  const config = normalizeJobSearchConfig(input);
  const errors = [];
  const warnings = [];
  if (config.skills.all.length === 0) {
    errors.push('skills must contain at least one skill');
  }
  if (!config.location.home_country) warnings.push('location.home_country is empty');
  if (config.location.search_scopes.length === 0) {
    errors.push('location.search_scopes must include local, remote, or international');
  }
  if (config.location.search_scopes.includes('international')
    && config.location.international_locations.length === 0) {
    errors.push('location.international_locations is required when international search is selected');
  }
  if (config.seniority.minimum_years !== null
    && config.seniority.maximum_years !== null
    && config.seniority.minimum_years > config.seniority.maximum_years) {
    errors.push('seniority.minimum_years cannot exceed seniority.maximum_years');
  }
  if (Object.values(config.weights).some((weight) => weight < 0)) {
    errors.push('weights cannot be negative');
  }
  return { valid: errors.length === 0, errors, warnings, config };
}

function normalizeSearchScopes(location = {}) {
  const explicit = cleanStrings(location?.search_scopes)
    .filter((scope) => ['local', 'remote', 'international'].includes(scope.toLowerCase()))
    .map((scope) => scope.toLowerCase());
  if (explicit.length) return unique(explicit);
  const legacy = cleanString(location?.work_mode);
  if (legacy === 'remote_only') return ['remote'];
  if (legacy === 'local_only' || legacy === 'hybrid_only') return ['local'];
  return ['local', 'remote'];
}

function normalizeWeights(value = {}) {
  const keys = Object.keys(DEFAULT_WEIGHTS);
  if (!keys.every((key) => Number.isFinite(Number(value?.[key])))) return { ...DEFAULT_WEIGHTS };
  const candidate = Object.fromEntries(
    Object.entries(DEFAULT_WEIGHTS).map(([key, fallback]) => [
      key,
      Number.isFinite(Number(value?.[key])) ? Number(value[key]) : fallback,
    ]),
  );
  const total = Object.values(candidate).reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  return Object.fromEntries(
    Object.entries(candidate).map(([key, weight]) => [key, Math.round((Math.max(0, weight) / total) * 10000) / 100]),
  );
}

function normalizeCompensation(value = {}) {
  return {
    currency: cleanString(value?.currency).toUpperCase() || null,
    minimum_annual: finiteOrNull(value?.minimum_annual),
  };
}

function cleanStrings(value) {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  return unique(list.map(cleanString).filter(Boolean));
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function includesIgnoreCase(values, candidate) {
  const key = String(candidate).toLowerCase();
  return values.some((value) => String(value).toLowerCase() === key);
}
