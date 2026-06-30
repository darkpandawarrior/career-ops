import { normalizeJobSearchConfig } from './config-schema.mjs';
import { enabledSources } from './source-registry.mjs';

export function buildSearchPlan(rawConfig, options = {}) {
  const config = normalizeJobSearchConfig(rawConfig);
  const sources = enabledSources(options.sources, config);
  const verifiedSkills = [
    ...config.skills.demonstrated,
    ...config.skills.confirmed_unlisted,
  ];
  const searchSkills = unique([
    ...verifiedSkills,
    ...config.skills.supporting,
  ]);
  const skillGroups = chunks(searchSkills.slice(0, 15), 3);
  const roleGroups = config.interested_roles.slice(0, 8).map((role) => unique(expandRole(role)).slice(0, 4));
  const industries = config.preferences.domains.slice(0, 4);
  const stageClause = buildStageClause(config.seniority);
  const negativeTerms = [...config.skills.excluded];
  const negativeClause = negativeTerms.slice(0, 8).map((term) => `-${quote(term)}`).join(' ');
  const queries = [];

  for (const source of sources) {
    const locationClause = buildLocationClause(config.location, source);
    for (const [index, roles] of roleGroups.entries()) {
      const role = config.interested_roles[index];
      queries.push({
        id: `${source.id}-role-${index + 1}`,
        name: `${source.name} - ${role}`,
        category: source.category,
        strategy: 'role',
        signals: { interestedRole: role, synonyms: roles.slice(1), industries, scope: config.location.search_scopes },
        query: joinQuery(source.site, orClause(roles), orClause(searchSkills.slice(0, 3)), orClause(industries), stageClause, locationClause, negativeClause),
      });
    }
    for (const [index, skills] of skillGroups.entries()) {
      queries.push({
        id: `${source.id}-skills-${index + 1}`,
        name: `${source.name} - core skills ${index + 1}`,
        category: source.category,
        strategy: 'skills',
        signals: { skills, industries, scope: config.location.search_scopes },
        query: joinQuery(source.site, orClause(skills), stageClause, locationClause, negativeClause),
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      verifiedSkills: verifiedSkills.length,
      supportingSkills: config.skills.supporting.length,
      interestedRoles: config.interested_roles.length,
      industries: industries.length,
      sources: sources.length,
      queries: queries.length,
    },
    queries,
    portalConfig: buildPortalFilters(config, queries),
  };
}

export function buildPortalFilters(rawConfig, queries = []) {
  const config = normalizeJobSearchConfig(rawConfig);
  return {
    title_filter: {
      positive: config.interested_roles,
      negative: [],
      seniority_boost: config.seniority.preferred_levels,
    },
    content_filter: {
      positive: [...config.skills.demonstrated, ...config.skills.confirmed_unlisted, ...config.skills.supporting],
      negative: config.skills.excluded,
    },
    location_filter: {
      always_allow: config.location.search_scopes.includes('local')
        ? [config.location.home_country].filter(Boolean)
        : [],
      allow: unique([
        ...config.location.preferred_locations,
        ...config.location.international_locations,
        ...(config.location.search_scopes.includes('remote')
          ? [...config.location.remote_regions, 'Remote']
          : []),
      ].filter(Boolean)),
      block: [],
      search_scopes: config.location.search_scopes,
    },
    search_queries: queries.map(({ name, query }) => ({ name, query, enabled: true })),
  };
}

function expandRole(role) {
  const value = String(role).trim();
  const variants = [value];
  const replacements = [
    [/\bEngineer\b/i, 'Developer'], [/\bDeveloper\b/i, 'Engineer'],
    [/\bManager\b/i, 'Lead'], [/\bSpecialist\b/i, 'Analyst'],
    [/\bRepresentative\b/i, 'Associate'], [/\bAssistant\b/i, 'Coordinator'],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(value)) variants.push(value.replace(pattern, replacement));
  }
  return variants;
}

function buildLocationClause(location, source) {
  const scopes = new Set(location.search_scopes);
  if (source.category === 'remote') {
    return orClause(unique(['Remote', ...location.remote_regions]));
  }
  const terms = [];
  if (scopes.has('local')) terms.push(location.home_country, ...location.preferred_locations);
  if (scopes.has('international')) terms.push(...location.international_locations);
  if (scopes.has('remote') && ['ats', 'company', 'aggregator', 'startup', 'early-career'].includes(source.category)) {
    terms.push('Remote', ...location.remote_regions);
  }
  return orClause(terms);
}

function buildStageClause(seniority) {
  const levels = unique(seniority.preferred_levels.map((level) => String(level).toLowerCase()));
  const early = levels.some((level) => /intern|entry|fresher|graduate|junior/.test(level))
    || (seniority.maximum_years !== null && seniority.maximum_years <= 3);
  if (early) return '(intern OR internship OR trainee OR graduate OR fresher OR "entry level" OR junior)';
  const terms = [];
  if (levels.some((level) => level.includes('senior'))) terms.push('senior');
  if (levels.some((level) => /staff|lead|principal/.test(level))) terms.push('staff', 'lead', 'principal');
  if (levels.some((level) => level.includes('executive'))) terms.push('director', 'head', 'vp');
  return orClause(terms);
}

function orClause(terms) {
  const values = unique(terms.filter(Boolean));
  if (values.length === 0) return '';
  return `(${values.map(quote).join(' OR ')})`;
}

function quote(value) {
  const escaped = String(value).replaceAll('"', '\\"');
  return `"${escaped}"`;
}

function joinQuery(...parts) {
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = String(value).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function chunks(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}
