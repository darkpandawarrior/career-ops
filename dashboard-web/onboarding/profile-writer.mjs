import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import yaml from 'js-yaml';

import { validateJobSearchConfig } from '../search/config-schema.mjs';

const DRAFT_ID_RE = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;

export async function previewProfileActivation(root, draftId) {
  const context = await loadActivationContext(root, draftId);
  const generated = generateUserFiles(context.review, context.extraction);
  const validation = validateGeneratedFiles(generated);
  return {
    valid: validation.valid,
    errors: validation.errors,
    files: Object.entries(generated).map(([relativePath, content]) => ({
      path: relativePath,
      bytes: Buffer.byteLength(content),
      action: 'replace',
    })),
  };
}

export async function confirmProfile(root, draftId) {
  const context = await loadActivationContext(root, draftId);
  const generated = generateUserFiles(context.review, context.extraction);
  const validation = validateGeneratedFiles(generated);
  if (!validation.valid) throw activationError('generated_profile_invalid', validation.errors.join('; '), 422);

  const transactionRoot = path.join(root, 'data', 'onboarding-drafts', context.id, 'activation-transaction');
  const stageRoot = path.join(transactionRoot, 'stage');
  const rollbackRoot = path.join(transactionRoot, 'rollback');
  await rm(transactionRoot, { recursive: true, force: true });
  await mkdir(stageRoot, { recursive: true });

  for (const [relativePath, content] of Object.entries(generated)) {
    const staged = path.join(stageRoot, ...relativePath.split('/'));
    await mkdir(path.dirname(staged), { recursive: true });
    await writeFile(staged, content, { encoding: 'utf8', flag: 'wx' });
  }

  await validateStagedFiles(stageRoot, generated);
  const replaced = [];
  try {
    for (const relativePath of Object.keys(generated)) {
      const active = path.join(root, ...relativePath.split('/'));
      const staged = path.join(stageRoot, ...relativePath.split('/'));
      const rollback = path.join(rollbackRoot, ...relativePath.split('/'));
      replaced.push(relativePath);
      await mkdir(path.dirname(active), { recursive: true });
      if (await exists(active)) {
        await mkdir(path.dirname(rollback), { recursive: true });
        await rename(active, rollback);
      }
      await rename(staged, active);
    }
    await rm(path.join(root, 'data', 'job-dashboard.json'), { force: true });
    await rm(path.join(root, 'data', 'cache'), { recursive: true, force: true });
    const activatedAt = new Date().toISOString();
    await writeFile(path.join(transactionRoot, 'pending.json'), JSON.stringify({
      version: 1,
      activatedAt,
      replacedFiles: replaced,
    }, null, 2), 'utf8');
    await writeFile(path.join(root, 'data', 'onboarding-drafts', context.id, 'activation.json'), JSON.stringify({
      version: 1,
      status: 'pending-search',
      activatedAt,
      files: replaced,
    }, null, 2), 'utf8');
    await updateDraftMetadata(root, context.id, activatedAt);
    return {
      ok: true,
      activatedAt,
      files: replaced,
      cacheCleared: true,
      cleanupPending: true,
    };
  } catch (error) {
    await rollbackReplacement(root, rollbackRoot, replaced);
    throw activationError('activation_failed', `Profile activation was rolled back: ${error.message}`, 500);
  }
}

export async function finalizeProfileReplacement(root, draftId) {
  validateDraftId(draftId);
  await rm(path.join(root, 'data', 'profile-archives'), { recursive: true, force: true });
  const draftsRoot = path.join(root, 'data', 'onboarding-drafts');
  if (await exists(draftsRoot)) {
    for (const entry of await readdir(draftsRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        await rm(path.join(draftsRoot, entry.name), { recursive: true, force: true });
      }
    }
  }
  return { ok: true, previousProfilesRemoved: true };
}

export async function rollbackProfileReplacement(root, draftId) {
  const id = validateDraftId(draftId);
  const transactionRoot = path.join(root, 'data', 'onboarding-drafts', id, 'activation-transaction');
  try {
    const pending = await readJson(path.join(transactionRoot, 'pending.json'));
    await rollbackReplacement(root, path.join(transactionRoot, 'rollback'), pending.replacedFiles || []);
  } finally {
    await rm(path.join(root, 'data', 'job-dashboard.json'), { force: true });
    await rm(path.join(root, 'data', 'cache'), { recursive: true, force: true });
    await rm(transactionRoot, { recursive: true, force: true });
  }
}

export function generateUserFiles(review, extraction) {
  const minimumYears = review.experience_years == null ? null : Math.max(0, Math.floor(review.experience_years));
  const maximumYears = review.experience_years == null ? null : Math.max(minimumYears, Math.ceil(review.experience_years + 3));
  const education = extractEducationEvidence(extraction);
  const profile = {
    candidate: {
      full_name: review.candidate.full_name,
      email: review.candidate.email || '',
      phone: review.candidate.phone || '',
      location: review.candidate.location || '',
      linkedin: review.candidate.linkedin || '',
      portfolio_url: review.candidate.portfolio_url || '',
      github: review.candidate.github || '',
    },
    target_roles: {
      primary: review.target_roles,
      archetypes: [
        ...review.target_roles.map((name) => ({ name, level: review.seniority || '', fit: 'primary' })),
        ...review.adjacent_roles.map((name) => ({ name, level: review.seniority || '', fit: 'adjacent' })),
      ],
    },
    narrative: {
      headline: review.summary || `${review.seniority || ''} ${review.target_roles[0] || 'professional'}`.trim(),
      exit_story: '',
      superpowers: review.skills.demonstrated.slice(0, 5),
      proof_points: [],
    },
    compensation: {
      target_range: formatCompensation(review.compensation.currency, review.compensation.minimum_annual, review.compensation.target_annual),
      currency: review.compensation.currency || '',
      minimum: review.compensation.minimum_annual == null ? '' : String(review.compensation.minimum_annual),
      location_flexibility: locationFlexibility(review.location),
    },
    location: {
      country: review.location.home_country,
      city: review.candidate.location || '',
      timezone: '',
      visa_status: review.location.visa_sponsorship_required ? 'Sponsorship required' : 'Not specified',
      relocation: review.location.relocation,
      remote_regions: review.location.remote_regions,
      search_scopes: review.location.search_scopes,
      international_locations: review.location.international_locations,
    },
    availability: {
      notice_period: review.availability.notice_period,
    },
    cv: { output_format: 'html' },
  };
  const jobSearch = {
    titles: {
      strong: review.target_roles,
      adjacent: review.adjacent_roles,
      exclude: review.excluded_titles,
    },
    skills: {
      demonstrated: review.skills.demonstrated,
      confirmed_unlisted: review.skills.confirmed_unlisted,
      supporting: review.skills.supporting,
      learning: review.skills.learning,
      recommended_gaps: [],
      excluded: review.skills.excluded,
    },
    seniority: {
      minimum_years: minimumYears,
      maximum_years: maximumYears,
      preferred_levels: review.seniority ? [review.seniority] : [],
    },
    availability: {
      notice_period: review.availability.notice_period,
    },
    education,
    location: review.location,
    compensation: {
      home_country: {
        currency: review.compensation.currency || null,
        minimum_annual: review.compensation.minimum_annual,
      },
      remote: { currency: review.compensation.currency || null, minimum_annual: review.compensation.minimum_annual },
      international: { currency: review.compensation.currency || null, minimum_annual: review.compensation.minimum_annual },
    },
    preferences: {
      domains: review.preferences?.domains || [],
      company_types: [],
      negative_keywords: [],
    },
    weights: {
      skills: 45,
      experience: 25,
      eligibility: 15,
      notice_education: 10,
      other: 5,
    },
  };
  return {
    'cv.md': renderCanonicalCv(extraction),
    'config/profile.yml': dumpYaml(profile),
    'config/job-search.yml': dumpYaml(jobSearch),
    'modes/_profile.md': renderProfileNarrative(review),
    'portals.yml': dumpYaml(renderPortals(review)),
    'data/applications.md': '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n',
    'data/pipeline.md': '# Job Pipeline\n\nAdd one job URL per line below.\n',
    'data/scan-history.tsv': 'url\tfirst_seen\tlast_checked\tstatus\n',
  };
}

export function validateGeneratedFiles(files) {
  const errors = [];
  for (const required of ['cv.md', 'config/profile.yml', 'config/job-search.yml', 'modes/_profile.md', 'portals.yml']) {
    if (!files[required]?.trim()) errors.push(`${required} is empty`);
  }
  try {
    const profile = yaml.load(files['config/profile.yml']);
    if (!profile?.candidate?.full_name) errors.push('config/profile.yml requires candidate.full_name');
    if (!profile?.target_roles?.primary?.length) errors.push('config/profile.yml requires target_roles.primary');
  } catch (error) {
    errors.push(`config/profile.yml is invalid YAML: ${error.message}`);
  }
  try {
    const search = yaml.load(files['config/job-search.yml']);
    const validation = validateJobSearchConfig(search);
    errors.push(...validation.errors.map((error) => `config/job-search.yml: ${error}`));
  } catch (error) {
    errors.push(`config/job-search.yml is invalid YAML: ${error.message}`);
  }
  try {
    const portals = yaml.load(files['portals.yml']);
    if (!portals?.content_filter?.positive?.length) errors.push('portals.yml requires content_filter.positive');
    if (!Array.isArray(portals?.search_queries) || portals.search_queries.length === 0) errors.push('portals.yml requires search_queries');
  } catch (error) {
    errors.push(`portals.yml is invalid YAML: ${error.message}`);
  }
  if (!/^# /m.test(files['cv.md'] || '')) errors.push('cv.md requires a Markdown heading');
  return { valid: errors.length === 0, errors };
}

async function loadActivationContext(root, draftId) {
  const id = validateDraftId(draftId);
  const draftPath = path.join(root, 'data', 'onboarding-drafts', id);
  try {
    const [review, extraction] = await Promise.all([
      readJson(path.join(draftPath, 'review.json')),
      readJson(path.join(draftPath, 'extraction.json')),
    ]);
    if (review.status !== 'reviewed') throw new Error('Review is not complete');
    return { id, review, extraction };
  } catch (error) {
    throw activationError('review_required', `A valid reviewed draft is required: ${error.message}`, 409);
  }
}

async function validateStagedFiles(stageRoot, generated) {
  const staged = {};
  for (const relativePath of Object.keys(generated)) {
    staged[relativePath] = await readFile(path.join(stageRoot, ...relativePath.split('/')), 'utf8');
  }
  const validation = validateGeneratedFiles({
    ...generateValidationDefaults(),
    ...staged,
  });
  if (!validation.valid) throw activationError('staged_profile_invalid', validation.errors.join('; '), 422);
}

async function rollbackReplacement(root, rollbackRoot, replaced) {
  for (const relativePath of [...replaced].reverse()) {
    const active = path.join(root, ...relativePath.split('/'));
    const rollback = path.join(rollbackRoot, ...relativePath.split('/'));
    await rm(active, { force: true });
    if (await exists(rollback)) {
      await mkdir(path.dirname(active), { recursive: true });
      await rename(rollback, active);
    }
  }
}

async function updateDraftMetadata(root, id, activatedAt) {
  const metadataPath = path.join(root, 'data', 'onboarding-drafts', id, 'metadata.json');
  const metadata = await readJson(metadataPath);
  await writeFile(metadataPath, JSON.stringify({
    ...metadata,
    status: 'activated',
    nextStep: 'search',
    activatedAt,
  }, null, 2), 'utf8');
}

function renderCanonicalCv(extraction) {
  return (extraction.sections || [])
    .filter((section) => section.text)
    .map((section) => {
      if (section.key === 'header') return `# ${section.text.split('\n')[0]}\n\n${section.text.split('\n').slice(1).join('\n')}`.trim();
      return `## ${section.title}\n\n${section.text}`;
    })
    .join('\n\n')
    .trim() + '\n';
}

function extractEducationEvidence(extraction) {
  const sections = extraction?.sections || [];
  const educationText = sections
    .filter((section) => section.key === 'education')
    .map((section) => section.text || '')
    .join('\n');
  const certificationLines = sections
    .filter((section) => section.key === 'certifications')
    .flatMap((section) => String(section.text || '').split('\n'))
    .map((line) => line.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);
  const levels = [];
  if (/\b(?:bachelor(?:'s)?|b\.?\s?tech|b\.?\s?e\.?|b\.?\s?sc)\b/i.test(educationText)) levels.push("Bachelor's degree");
  if (/\b(?:master(?:'s)?|m\.?\s?tech|m\.?\s?e\.?|m\.?\s?sc|mba)\b/i.test(educationText)) levels.push("Master's degree");
  if (/\b(?:ph\.?d|doctorate)\b/i.test(educationText)) levels.push('Doctorate');
  if (/\bdiploma\b/i.test(educationText)) levels.push('Diploma');
  return {
    levels,
    certifications: [...new Set(certificationLines)],
  };
}

function renderProfileNarrative(review) {
  const roles = [...review.target_roles, ...review.adjacent_roles];
  return [
    '# User Profile Context -- career-ops',
    '',
    '## Target Roles',
    '',
    ...roles.map((role) => `- ${role}`),
    '',
    '## Professional Narrative',
    '',
    review.summary || 'Use the canonical CV and reviewed profile for role-specific framing.',
    '',
    '## Target Industries',
    '',
    ...(review.preferences?.domains?.length
      ? review.preferences.domains.map((domain) => `- ${domain}`)
      : ['- Any relevant industry']),
    '',
    '## Demonstrated Strengths',
    '',
    ...review.skills.demonstrated.map((skill) => `- ${skill}`),
    '',
    '## Location Policy',
    '',
    `- Home country: ${review.location.home_country}`,
    `- Preferred locations: ${review.location.preferred_locations.join(', ') || 'Not specified'}`,
    `- Remote regions: ${review.location.remote_regions.join(', ') || 'Not specified'}`,
    `- Relocation: ${review.location.relocation}`,
    `- Search scopes: ${review.location.search_scopes.join(', ')}`,
    `- International targets: ${review.location.international_locations.join(', ') || 'None'}`,
    `- Visa sponsorship required: ${review.location.visa_sponsorship_required ? 'yes' : 'no'}`,
    `- Notice period: ${review.availability.notice_period}`,
    '',
    '## Compensation',
    '',
    `- Currency: ${review.compensation.currency || 'Not specified'}`,
    `- Minimum annual: ${review.compensation.minimum_annual ?? 'Not specified'}`,
    `- Target annual: ${review.compensation.target_annual ?? 'Not specified'}`,
    '',
  ].join('\n');
}

function renderPortals(review) {
  const skillQuery = [
    ...review.skills.demonstrated,
    ...review.skills.confirmed_unlisted,
    ...review.skills.supporting,
  ].slice(0, 12)
    .map((skill) => `"${skill}"`)
    .join(' OR ');
  const locationQuery = searchLocationTerms(review.location).join(' OR ') || review.location.home_country;
  return {
    title_filter: {
      positive: [],
      negative: [],
      seniority_boost: review.seniority ? [review.seniority] : [],
    },
    content_filter: {
      positive: [
        ...review.skills.demonstrated,
        ...review.skills.confirmed_unlisted,
        ...review.skills.supporting,
      ],
      negative: review.skills.excluded,
    },
    location_filter: {
      always_allow: [review.location.home_country].filter(Boolean),
      allow: review.location.preferred_locations,
      block: [],
    },
    search_queries: [
      { name: 'Greenhouse core skills', query: `site:job-boards.greenhouse.io (${skillQuery}) ${locationQuery}`, enabled: true },
      { name: 'Ashby core skills', query: `site:jobs.ashbyhq.com (${skillQuery}) ${locationQuery}`, enabled: true },
      { name: 'Lever core skills', query: `site:jobs.lever.co (${skillQuery}) ${locationQuery}`, enabled: true },
      { name: 'Workday core skills', query: `site:myworkdayjobs.com (${skillQuery}) ${locationQuery}`, enabled: true },
      { name: 'SmartRecruiters core skills', query: `site:jobs.smartrecruiters.com (${skillQuery}) ${locationQuery}`, enabled: true },
      { name: 'Workable core skills', query: `site:apply.workable.com (${skillQuery}) ${locationQuery}`, enabled: true },
      { name: 'LinkedIn core skills', query: `site:linkedin.com/jobs (${skillQuery}) ${locationQuery}`, enabled: true },
      { name: 'Startup core skills', query: `(site:wellfound.com/jobs OR site:workatastartup.com) (${skillQuery}) ${locationQuery}`, enabled: true },
    ],
    job_boards: buildJobBoards(review),
    tracked_companies: defaultTrackedCompanies(),
  };
}

function defaultTrackedCompanies() {
  return [
    ['Reddit', 'greenhouse', 'https://job-boards.greenhouse.io/reddit'],
    ['Stripe', 'greenhouse', 'https://job-boards.greenhouse.io/stripe'],
    ['Databricks', 'greenhouse', 'https://job-boards.greenhouse.io/databricks'],
    ['MongoDB', 'greenhouse', 'https://job-boards.greenhouse.io/mongodb'],
    ['Cloudflare', 'greenhouse', 'https://job-boards.greenhouse.io/cloudflare'],
    ['GitLab', 'greenhouse', 'https://job-boards.greenhouse.io/gitlab'],
    ['Coinbase', 'greenhouse', 'https://job-boards.greenhouse.io/coinbase'],
    ['Postman', 'greenhouse', 'https://job-boards.greenhouse.io/postman'],
    ['PhonePe', 'greenhouse', 'https://job-boards.greenhouse.io/phonepe'],
    ['Razorpay', 'greenhouse', 'https://job-boards.greenhouse.io/razorpaysoftwareprivatelimited'],
    ['Airbnb', 'greenhouse', 'https://job-boards.greenhouse.io/airbnb'],
    ['Okta', 'greenhouse', 'https://job-boards.greenhouse.io/okta'],
    ['Elastic', 'greenhouse', 'https://job-boards.greenhouse.io/elastic'],
    ['DoorDash', 'greenhouse', 'https://job-boards.greenhouse.io/doordashusa'],
    ['Twilio', 'greenhouse', 'https://job-boards.greenhouse.io/twilio'],
    ['Lyft', 'greenhouse', 'https://job-boards.greenhouse.io/lyft'],
    ['Pinterest', 'greenhouse', 'https://job-boards.greenhouse.io/pinterest'],
  ].map(([name, , careers_url]) => ({
    name,
    careers_url,
    enabled: true,
  }));
}

function buildJobBoards(review) {
  const searchScopes = review.location.search_scopes;
  const boards = [];
  if (searchScopes.includes('remote')) {
    boards.push(
      { name: 'RemoteOK', provider: 'remoteok', enabled: true },
      { name: 'Remotive', provider: 'remotive', enabled: true },
      { name: 'Working Nomads', provider: 'workingnomads', enabled: true },
    );
  }
  if ((searchScopes.includes('local') || searchScopes.includes('international'))
    && looksTechnicalProfile(review)) {
    boards.push({
      name: 'SolidJobs IT',
      provider: 'solidjobs',
      careers_url: 'https://solid.jobs/public-api/offers/it',
      enabled: true,
    });
  }
  return boards;
}

function looksTechnicalProfile(review) {
  const value = [
    ...review.target_roles,
    ...review.adjacent_roles,
    ...review.skills.demonstrated,
  ].join(' ').toLowerCase();
  return /\b(engineer|developer|software|data|android|ios|cloud|devops|security|qa|test|analyst|sql|python|java|javascript|kotlin)\b/.test(value);
}

function searchLocationTerms(location) {
  const terms = [];
  if (location.search_scopes.includes('remote')) terms.push('remote');
  if (location.search_scopes.includes('local')) {
    terms.push(location.home_country, ...location.preferred_locations.slice(0, 3));
  }
  if (location.search_scopes.includes('international')) {
    terms.push(...location.international_locations.slice(0, 5));
  }
  return [...new Set(terms.filter(Boolean))];
}

function generateValidationDefaults() {
  return {
    'cv.md': '# Placeholder\n',
    'config/profile.yml': 'candidate:\n  full_name: Placeholder\ntarget_roles:\n  primary: [Placeholder]\n',
    'config/job-search.yml': 'titles:\n  strong: [Placeholder]\nskills:\n  demonstrated: [Placeholder]\n',
    'modes/_profile.md': '# Placeholder\n',
    'portals.yml': 'title_filter:\n  positive: [Placeholder]\nsearch_queries:\n  - name: Placeholder\n    query: Placeholder\n    enabled: true\n',
  };
}

function dumpYaml(value) {
  return yaml.dump(value, { noRefs: true, lineWidth: 100, sortKeys: false });
}

function formatCompensation(currency, minimum, target) {
  if (minimum == null && target == null) return '';
  const prefix = currency ? `${currency} ` : '';
  if (minimum != null && target != null) return `${prefix}${minimum}-${target}`;
  return `${prefix}${minimum ?? target}`;
}

function locationFlexibility(location) {
  const parts = [`Scopes: ${location.search_scopes.join(', ')}`];
  if (location.remote_regions.length) parts.push(`Remote: ${location.remote_regions.join(', ')}`);
  if (location.international_locations.length) {
    parts.push(`International: ${location.international_locations.join(', ')}`);
  }
  parts.push(`Relocation: ${location.relocation}`);
  return parts.join('; ');
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function activationError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function validateDraftId(value) {
  const id = String(value || '');
  if (!DRAFT_ID_RE.test(id)) throw activationError('invalid_draft', 'Draft id is invalid', 400);
  return id;
}
