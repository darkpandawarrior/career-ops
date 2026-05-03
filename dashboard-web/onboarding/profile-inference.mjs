import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { readFullExtraction } from './resume-extractor.mjs';

const SKILL_TAXONOMY = [
  ['JavaScript', ['javascript', 'js']],
  ['TypeScript', ['typescript']],
  ['Python', ['python']],
  ['Java', ['java']],
  ['Kotlin', ['kotlin']],
  ['Go', ['golang', 'go language']],
  ['Rust', ['rust']],
  ['C#', ['c#', '.net']],
  ['C++', ['c++']],
  ['Ruby', ['ruby']],
  ['PHP', ['php']],
  ['Swift', ['swift']],
  ['React', ['react', 'react.js']],
  ['Angular', ['angular']],
  ['Vue.js', ['vue', 'vue.js']],
  ['Node.js', ['node.js', 'nodejs']],
  ['Spring Boot', ['spring boot']],
  ['Django', ['django']],
  ['FastAPI', ['fastapi']],
  ['Android', ['android']],
  ['Android Studio', ['android studio']],
  ['Jetpack Compose', ['jetpack compose', 'compose ui']],
  ['Coroutines', ['kotlin coroutines', 'coroutines']],
  ['Flow', ['kotlin flow', 'stateflow', 'sharedflow']],
  ['Room', ['room database', 'android room']],
  ['Hilt', ['hilt', 'dagger hilt']],
  ['Retrofit', ['retrofit']],
  ['ExoPlayer', ['exoplayer', 'media3']],
  ['Gradle', ['gradle']],
  ['Firebase', ['firebase']],
  ['Crashlytics', ['crashlytics']],
  ['Jira', ['jira']],
  ['MVVM', ['mvvm']],
  ['Modularization', ['modularization', 'multi-module', 'modular architecture']],
  ['Dependency Injection', ['dependency injection']],
  ['WebSockets', ['websocket', 'websockets']],
  ['Pagination', ['pagination', 'paging 3']],
  ['Caching', ['caching', 'cache strategy']],
  ['Unit Testing', ['unit testing', 'unit tests', 'junit', 'mockk']],
  ['iOS', ['ios']],
  ['PostgreSQL', ['postgresql', 'postgres']],
  ['MySQL', ['mysql']],
  ['SQL', ['sql', 'sql server']],
  ['Excel', ['excel', 'pivot tables', 'vlookup']],
  ['Tableau', ['tableau']],
  ['Power BI', ['power bi']],
  ['Pandas', ['pandas']],
  ['NumPy', ['numpy']],
  ['Scikit-learn', ['scikit-learn', 'sklearn']],
  ['Matplotlib', ['matplotlib']],
  ['Seaborn', ['seaborn']],
  ['Jupyter Notebook', ['jupyter notebook', 'jupyter']],
  ['MongoDB', ['mongodb']],
  ['Redis', ['redis']],
  ['Kafka', ['kafka']],
  ['Docker', ['docker']],
  ['Kubernetes', ['kubernetes', 'k8s']],
  ['Terraform', ['terraform']],
  ['AWS', ['aws', 'amazon web services']],
  ['Azure', ['azure']],
  ['Google Cloud', ['google cloud', 'gcp']],
  ['Git', ['git', 'github', 'gitlab']],
  ['CI/CD', ['ci/cd', 'continuous integration', 'continuous delivery']],
  ['REST APIs', ['rest api', 'restful']],
  ['GraphQL', ['graphql']],
  ['Machine Learning', ['machine learning', 'ml']],
  ['Deep Learning', ['deep learning']],
  ['LLMs', ['llm', 'large language model', 'generative ai', 'genai']],
  ['Data Engineering', ['data engineering', 'etl', 'data pipeline']],
  ['Data Analysis', ['data analysis', 'data analytics']],
  ['Product Management', ['product management', 'product manager']],
  ['Project Management', ['project management', 'project manager']],
  ['Digital Marketing', ['digital marketing', 'seo', 'sem', 'campaign management']],
  ['Content Marketing', ['content marketing', 'content strategy', 'copywriting']],
  ['Sales', ['sales', 'business development', 'lead generation', 'account executive']],
  ['Customer Success', ['customer success', 'client success', 'account management']],
  ['Financial Analysis', ['financial analysis', 'financial modeling', 'valuation']],
  ['Accounting', ['accounting', 'bookkeeping', 'general ledger']],
  ['Business Analysis', ['business analysis', 'requirements gathering', 'process mapping']],
  ['Human Resources', ['human resources', 'hr operations', 'talent management']],
  ['Recruiting', ['recruiting', 'recruitment', 'talent acquisition']],
  ['Operations', ['operations management', 'business operations', 'process improvement']],
  ['UX Design', ['ux design', 'ux designer']],
  ['Figma', ['figma']],
  ['Salesforce', ['salesforce']],
  ['SAP', ['sap']],
];

const ROLE_FAMILIES = [
  { role: 'Backend Engineer', terms: ['backend engineer', 'backend developer'], skills: ['Java', 'Spring Boot', 'Node.js', 'Python', 'PostgreSQL'] },
  { role: 'Frontend Engineer', terms: ['frontend engineer', 'front-end engineer', 'frontend developer'], skills: ['React', 'Angular', 'Vue.js', 'JavaScript', 'TypeScript'] },
  { role: 'Full Stack Engineer', terms: ['full stack engineer', 'full-stack engineer', 'full stack developer'], skills: ['JavaScript', 'TypeScript', 'React', 'Node.js'] },
  { role: 'Mobile Engineer', terms: ['mobile engineer', 'mobile developer'], skills: ['Android', 'iOS', 'Kotlin', 'Swift'] },
  { role: 'Android Engineer', terms: ['android engineer', 'android developer', 'software engineer, android', 'software development engineer, android'], skills: ['Android', 'Kotlin'] },
  { role: 'iOS Engineer', terms: ['ios engineer', 'ios developer'], skills: ['iOS', 'Swift'] },
  { role: 'Platform Engineer', terms: ['platform engineer'], skills: ['Kubernetes', 'Docker', 'Terraform', 'AWS'] },
  { role: 'DevOps Engineer', terms: ['devops engineer', 'site reliability engineer', 'sre'], skills: ['Kubernetes', 'Docker', 'Terraform', 'CI/CD'] },
  { role: 'Data Engineer', terms: ['data engineer'], skills: ['Data Engineering', 'Python', 'Kafka', 'PostgreSQL'] },
  { role: 'Machine Learning Engineer', terms: ['machine learning engineer', 'ml engineer'], skills: ['Machine Learning', 'Python', 'Deep Learning'] },
  { role: 'AI Engineer', terms: ['ai engineer', 'applied ai engineer'], skills: ['LLMs', 'Machine Learning', 'Python'] },
  { role: 'Data Analyst', terms: ['data analyst', 'business intelligence analyst'], skills: ['Data Analysis', 'SQL', 'Python', 'Excel', 'Tableau', 'Power BI'] },
  { role: 'Business Intelligence Analyst', terms: ['business intelligence analyst', 'bi analyst'], skills: ['SQL', 'Excel', 'Tableau', 'Power BI'] },
  { role: 'Product Manager', terms: ['product manager'], skills: ['Product Management'] },
  { role: 'Project Manager', terms: ['project manager', 'program manager'], skills: ['Project Management'] },
  { role: 'Business Analyst', terms: ['business analyst', 'business systems analyst'], skills: ['Business Analysis', 'Data Analysis', 'SQL'] },
  { role: 'Marketing Analyst', terms: ['marketing analyst', 'growth analyst'], skills: ['Data Analysis', 'Digital Marketing', 'Excel'] },
  { role: 'Digital Marketing Specialist', terms: ['digital marketing specialist', 'digital marketer', 'performance marketer'], skills: ['Digital Marketing', 'Content Marketing'] },
  { role: 'Content Marketing Specialist', terms: ['content marketing specialist', 'content strategist', 'content marketer'], skills: ['Content Marketing', 'Digital Marketing'] },
  { role: 'Sales Representative', terms: ['sales representative', 'sales executive', 'inside sales'], skills: ['Sales'] },
  { role: 'Business Development Representative', terms: ['business development representative', 'business development executive', 'bdr'], skills: ['Sales'] },
  { role: 'Account Executive', terms: ['account executive'], skills: ['Sales', 'Customer Success'] },
  { role: 'Customer Success Manager', terms: ['customer success manager', 'client success manager'], skills: ['Customer Success'] },
  { role: 'Financial Analyst', terms: ['financial analyst', 'finance analyst'], skills: ['Financial Analysis', 'Excel'] },
  { role: 'Accountant', terms: ['accountant', 'accounting associate'], skills: ['Accounting', 'Excel'] },
  { role: 'Human Resources Specialist', terms: ['human resources specialist', 'hr specialist', 'hr executive'], skills: ['Human Resources'] },
  { role: 'Recruiter', terms: ['recruiter', 'talent acquisition specialist'], skills: ['Recruiting', 'Human Resources'] },
  { role: 'Operations Analyst', terms: ['operations analyst', 'business operations analyst'], skills: ['Operations', 'Data Analysis', 'Excel'] },
  { role: 'Operations Manager', terms: ['operations manager', 'business operations manager'], skills: ['Operations'] },
  { role: 'UX Designer', terms: ['ux designer', 'product designer'], skills: ['UX Design', 'Figma'] },
];

export async function inferProfileDraft(root, draftId) {
  const extraction = await readFullExtraction(root, draftId);
  if (!extraction) throw inferenceError('extraction_required', 'Extract the resume before starting profile review', 409);
  if (extraction.diagnostics?.readyForInference === false) {
    throw inferenceError('extraction_quality_low', 'Resume sections could not be recovered reliably. Review or replace the PDF before continuing.', 422);
  }
  const inferred = inferProfile(extraction);
  const draftPath = path.join(root, 'data', 'onboarding-drafts', draftId);
  await writeFile(path.join(draftPath, 'inference.json'), JSON.stringify(inferred, null, 2), 'utf8');
  return publicInference(inferred);
}

export async function readInference(root, draftId) {
  try {
    const inferred = JSON.parse(await readFile(path.join(root, 'data', 'onboarding-drafts', validateDraftId(draftId), 'inference.json'), 'utf8'));
    return publicInference(inferred);
  } catch {
    return null;
  }
}

export function inferProfile(extraction) {
  const text = extraction.text || '';
  const sectionList = extraction.sections || [];
  const sections = Object.fromEntries(sectionList.map((section) => [section.key, section.text]));
  const header = sections.header || text.slice(0, 800);
  const employmentText = sectionText(sectionList, ['experience', 'internships']);
  const roleEvidence = sectionList
    .filter((section) => section.searchRelevant !== false && section.key !== 'header')
    .map((section) => section.text)
    .filter(Boolean)
    .join('\n') || text;
  const name = inferName(header);
  const email = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] || '';
  const phone = text.match(/(?:\+?\d[\d ().-]{7,}\d)/)?.[0]?.trim() || '';
  const links = inferLinks(text);
  const location = inferLocation(header);
  const skills = inferSkills(text, sections.skills || '');
  const experience = inferExperience(employmentText);
  const earlyCareer = experience.years === null
    && sectionList.some((section) => ['education', 'projects', 'simulations', 'internships'].includes(section.key));
  const roles = expandEarlyCareerRoles(inferRoles(roleEvidence, skills), earlyCareer);
  const seniority = inferSeniority(employmentText, experience.years, earlyCareer);
  const summary = (sections.summary || '').split('\n').filter(Boolean).slice(0, 3).join(' ').slice(0, 500);

  return {
    version: 1,
    draftId: extraction.draftId,
    inferredAt: new Date().toISOString(),
    candidate: {
      full_name: field(name, name ? 0.9 : 0, name ? 'First header line' : 'Not found'),
      email: field(email, email ? 0.98 : 0, email ? 'Resume text email match' : 'Not found'),
      phone: field(phone, phone ? 0.86 : 0, phone ? 'Resume text phone match' : 'Not found'),
      location: field(location, location ? 0.55 : 0, location ? 'Header contact line' : 'Not found'),
      linkedin: field(links.linkedin, links.linkedin ? 0.95 : 0, links.linkedin ? 'Resume URL' : 'Not found'),
      github: field(links.github, links.github ? 0.95 : 0, links.github ? 'Resume URL' : 'Not found'),
      portfolio_url: field(links.portfolio, links.portfolio ? 0.65 : 0, links.portfolio ? 'Resume URL' : 'Not found'),
    },
    summary: field(summary, summary ? 0.9 : 0, summary ? 'Summary section' : 'Not found'),
    experience: {
      total_years: field(experience.years, experience.years !== null ? 0.72 : 0, experience.source),
      date_ranges: experience.ranges,
    },
    skills,
    target_roles: roles,
    seniority,
    evidence_sections: sectionList
      .filter((section) => section.key !== 'header')
      .map((section) => ({
        key: section.key,
        title: section.title,
        search_relevant: section.searchRelevant !== false,
      })),
    preferences: {
      location: {
        home_country: '',
        preferred_locations: [],
        remote_eligibility_required: true,
        remote_regions: [],
        relocation: 'unknown',
        visa_sponsorship_required: false,
      },
      compensation: {
        currency: '',
        minimum_annual: null,
        target_annual: null,
      },
      excluded_titles: [],
      excluded_skills: [],
      domains: [],
    },
    availability: {
      notice_period: '',
    },
    reviewRequired: [
      'target_roles',
      'skills',
      'location_policy',
      'compensation',
    ],
  };
}

export function validateReviewDraft(input = {}) {
  const errors = [];
  const candidate = input.candidate || {};
  if (!clean(candidate.full_name)) errors.push('Full name is required');
  if (candidate.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(candidate.email)) errors.push('Email format is invalid');
  const experienceYears = finiteOrNull(input.experience_years);
  if (experienceYears === null) errors.push('Years of experience is required; enter 0 for no employment experience');
  const seniority = clean(input.seniority);
  if (!seniority) errors.push('Experience level is required');
  const targetRoles = cleanList(input.target_roles);
  if (targetRoles.length === 0) errors.push('Choose at least one target role');
  const demonstrated = cleanList(input.skills?.demonstrated);
  if (demonstrated.length < 5) errors.push('Confirm at least five demonstrated skills');
  const homeCountry = clean(input.location?.home_country);
  if (!homeCountry) errors.push('Home country is required');
  const relocation = clean(input.location?.relocation);
  if (!relocation || relocation === 'unknown') errors.push('Relocation preference is required');
  const searchScopes = cleanList(input.location?.search_scopes)
    .map((scope) => scope.toLowerCase())
    .filter((scope) => ['local', 'remote', 'international'].includes(scope));
  if (searchScopes.length === 0) {
    errors.push('Choose at least one job-search scope: local, remote, or international');
  }
  const internationalLocations = cleanList(input.location?.international_locations);
  if (searchScopes.includes('international') && internationalLocations.length === 0) {
    errors.push('Add at least one target country or region for international search');
  }
  const noticePeriod = clean(input.availability?.notice_period);
  if (!noticePeriod) errors.push('Notice period is required');
  const currency = clean(input.compensation?.currency).toUpperCase();
  const minimumAnnual = finiteOrNull(input.compensation?.minimum_annual);
  if (minimumAnnual !== null && !currency) errors.push('Currency is required when minimum compensation is set');
  return {
    valid: errors.length === 0,
    errors,
    review: {
      candidate: {
        full_name: clean(candidate.full_name),
        email: clean(candidate.email),
        phone: clean(candidate.phone),
        location: clean(candidate.location),
        linkedin: clean(candidate.linkedin),
        github: clean(candidate.github),
        portfolio_url: clean(candidate.portfolio_url),
      },
      summary: clean(input.summary),
      experience_years: experienceYears,
      seniority,
      target_roles: targetRoles,
      adjacent_roles: cleanList(input.adjacent_roles),
      excluded_titles: cleanList(input.excluded_titles),
      preferences: {
        domains: cleanList(input.preferences?.domains),
      },
      skills: {
        demonstrated,
        confirmed_unlisted: cleanList(input.skills?.confirmed_unlisted),
        supporting: cleanList(input.skills?.supporting),
        learning: cleanList(input.skills?.learning),
        excluded: cleanList(input.skills?.excluded),
      },
      location: {
        home_country: homeCountry,
        preferred_locations: cleanList(input.location?.preferred_locations),
        remote_eligibility_required: input.location?.remote_eligibility_required !== false,
        remote_regions: cleanList(input.location?.remote_regions),
        relocation,
        search_scopes: [...new Set(searchScopes)],
        international_locations: internationalLocations,
        work_mode: legacyWorkMode(searchScopes),
        visa_sponsorship_required: input.location?.visa_sponsorship_required === true,
      },
      availability: {
        notice_period: noticePeriod,
      },
      compensation: {
        currency,
        minimum_annual: minimumAnnual,
        target_annual: finiteOrNull(input.compensation?.target_annual),
      },
    },
  };
}

export async function saveReviewDraft(root, draftId, input) {
  const id = validateDraftId(draftId);
  const validation = validateReviewDraft(input);
  if (!validation.valid) return validation;
  const value = {
    version: 1,
    draftId: id,
    reviewedAt: new Date().toISOString(),
    status: 'reviewed',
    ...validation.review,
  };
  const draftPath = path.join(root, 'data', 'onboarding-drafts', id);
  await writeFile(path.join(draftPath, 'review.json'), JSON.stringify(value, null, 2), 'utf8');
  try {
    const metadataPath = path.join(draftPath, 'metadata.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    await writeFile(metadataPath, JSON.stringify({
      ...metadata,
      status: 'reviewed',
      nextStep: 'activate',
      reviewedAt: value.reviewedAt,
    }, null, 2), 'utf8');
  } catch {
    // Tests and imported drafts may not include upload metadata.
  }
  return { valid: true, errors: [], review: value };
}

function inferName(header) {
  return header.split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find((line) =>
      line.length >= 3
      && line.length <= 60
      && /^[\p{L}][\p{L} .'-]+$/u.test(line)
      && !/@|https?:|linkedin|github|\d{3}/i.test(line)
    ) || '';
}

function inferLinks(text) {
  const normalized = text.replace(/([/\-])\n(?=[a-z0-9])/gi, '$1');
  const urls = normalized.split(/\s+/)
    .map((token) => token.replace(/^[([<{]+|[)\]}>;,]+$/g, ''))
    .filter((token) => !token.includes('@'))
    .filter((token) => /^(?:https?:\/\/|www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s·|,)]+)?$/i.test(token))
    .filter((token) => /^(?:https?:\/\/|www\.)/i.test(token) || token.includes('/'))
    .map((token) => token.replace(/[.;,]+$/, ''));
  return {
    linkedin: urls.find((url) => /linkedin\.com/i.test(url)) || '',
    github: urls.find((url) => /github\.com/i.test(url)) || '',
    portfolio: urls.find((url) => !/linkedin\.com|github\.com/i.test(url) && !url.includes('@')) || '',
  };
}

function inferLocation(header) {
  const lines = header.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines.slice(0, 6)) {
    const parts = line.split(/[·|]/).map((part) => part.trim());
    const location = parts.find((part) =>
      /,\s*[A-Z]{2,}$/.test(part)
      || /\b(india|canada|united states|usa|uk|united kingdom|germany|france|spain|australia|singapore|uae)\b/i.test(part)
    );
    if (location) return location;
  }
  return '';
}

function inferSkills(text, skillsSection) {
  const lower = text.toLowerCase();
  const inferred = SKILL_TAXONOMY
    .map(([name, aliases]) => {
      const hits = aliases.filter((alias) => containsTerm(lower, alias));
      if (hits.length === 0) return null;
      const inSkills = aliases.some((alias) => containsTerm(skillsSection.toLowerCase(), alias));
      const occurrences = aliases.reduce((sum, alias) => sum + countTerm(lower, alias), 0);
      return {
        name,
        confidence: inSkills ? 0.95 : occurrences >= 2 ? 0.8 : 0.62,
        source: inSkills ? 'Skills section' : occurrences >= 2 ? `Mentioned ${occurrences} times` : 'Resume text',
        evidence: hits,
        suggested_state: inSkills || occurrences >= 2 ? 'demonstrated' : 'supporting',
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
  for (const name of parseExplicitSkills(skillsSection)) {
    const existing = inferred.find((skill) => skill.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.confidence = Math.max(existing.confidence, 0.95);
      existing.source = 'Skills section';
      existing.suggested_state = 'demonstrated';
      continue;
    }
    inferred.push({
      name,
      confidence: 0.92,
      source: 'Skills section',
      evidence: [name],
      suggested_state: 'demonstrated',
    });
  }
  return inferred.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
}

function inferExperience(text) {
  if (!text.trim()) {
    return { years: null, ranges: [], source: 'No employment section found' };
  }
  const now = new Date();
  const currentMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const ranges = [];
  const date = '(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\s+)?(?:19|20)\\d{2}';
  const pattern = new RegExp(`\\b(${date})\\s*(?:-|–|—|to)\\s*(present|current|now|${date})\\b`, 'gi');
  for (const match of text.matchAll(pattern)) {
    const start = parseMonth(match[1], false);
    const end = /present|current|now/i.test(match[2]) ? currentMonth : parseMonth(match[2], true);
    if (start !== null && end !== null && end >= start && end - start <= 600) {
      ranges.push({ start, end, label: match[0] });
    }
  }
  if (ranges.length === 0) {
    const explicit = text.match(/\b(\d{1,2})\+?\s+years? of experience\b/i);
    return {
      years: explicit ? Number(explicit[1]) : null,
      ranges: [],
      source: explicit ? 'Explicit experience statement' : 'No reliable date ranges',
    };
  }
  const months = new Set();
  for (const range of ranges) {
    for (let month = range.start; month <= range.end; month += 1) months.add(month);
  }
  return {
    years: Math.round((months.size / 12) * 10) / 10,
    ranges: ranges.map((range) => ({
      start: monthLabel(range.start),
      end: monthLabel(range.end),
      label: range.label,
    })),
    source: `${ranges.length} employment date range${ranges.length === 1 ? '' : 's'}`,
  };
}

function inferExperienceLegacy(text) {
  const currentYear = new Date().getUTCFullYear();
  const ranges = [];
  for (const match of text.matchAll(/\b((?:19|20)\d{2})\s*(?:-|–|—|to)\s*(present|current|now|(?:19|20)\d{2})\b/gi)) {
    const start = Number(match[1]);
    const end = /present|current|now/i.test(match[2]) ? currentYear : Number(match[2]);
    if (end >= start && end - start <= 50) ranges.push({ start, end, label: match[0] });
  }
  if (ranges.length === 0) {
    const explicit = text.match(/\b(\d{1,2})\+?\s+years? of experience\b/i);
    return {
      years: explicit ? Number(explicit[1]) : null,
      ranges: [],
      source: explicit ? 'Explicit experience statement' : 'No reliable date ranges',
    };
  }
  const years = new Set();
  for (const range of ranges) {
    for (let year = range.start; year < range.end; year += 1) years.add(year);
  }
  return { years: years.size, ranges, source: `${ranges.length} employment date range${ranges.length === 1 ? '' : 's'}` };
}

function inferRoles(evidenceText, skills) {
  const lower = evidenceText.toLowerCase();
  const skillNames = new Set(
    skills
      .filter((skill) => skill.suggested_state === 'demonstrated')
      .map((skill) => skill.name),
  );
  return ROLE_FAMILIES.map((family) => {
    const titleHits = family.terms.filter((term) => containsTerm(lower, term));
    const skillHits = family.skills.filter((skill) => skillNames.has(skill));
    const score = titleHits.length * 4 + skillHits.length;
    if (titleHits.length === 0 && skillHits.length < 2) return null;
    return {
      name: family.role,
      confidence: titleHits.length ? Math.min(0.96, 0.78 + titleHits.length * 0.08) : Math.min(0.7, 0.35 + skillHits.length * 0.08),
      source: titleHits.length ? `Resume role evidence: ${titleHits.join(', ')}` : `Skill cluster: ${skillHits.join(', ')}`,
      suggested_fit: titleHits.length ? 'primary' : 'adjacent',
      score,
    };
  }).filter(Boolean).sort((a, b) => b.score - a.score || b.confidence - a.confidence).slice(0, 6);
}

function parseExplicitSkills(section) {
  const values = [];
  for (const rawLine of section.split('\n')) {
    let line = rawLine
      .replace(/^(?:[•●▪◦*]|[-–—])\s*/i, '')
      .trim();
    if (!line) continue;
    line = line.replace(/^[^:]{2,32}:\s*/, '');
    const parenthetical = [...line.matchAll(/\(([^)]+)\)/g)].flatMap((match) => splitTopLevel(match[1]));
    const primary = line.replace(/\([^)]*\)/g, '').trim();
    values.push(...splitTopLevel(primary), ...parenthetical);
  }
  return [...new Set(values
    .map((value) => value.replace(/^[^:]{2,32}:\s*/, '').replace(/[()]/g, '').trim())
    .filter((value) => value.length >= 2 && value.length <= 48 && !/^(and|or|none|other tools?|soft skills?)$/i.test(value)))];
}

function parseMonth(value, endOfPeriod) {
  const match = String(value).trim().match(/^(?:([a-z]+)\s+)?((?:19|20)\d{2})$/i);
  if (!match) return null;
  const year = Number(match[2]);
  const month = match[1] ? monthIndex(match[1]) : endOfPeriod ? 11 : 0;
  return month === null ? null : year * 12 + month;
}

function monthIndex(value) {
  const index = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    .indexOf(value.toLowerCase().slice(0, 3));
  return index < 0 ? null : index;
}

function monthLabel(value) {
  return `${String((value % 12) + 1).padStart(2, '0')}/${Math.floor(value / 12)}`;
}

function inferSeniority(text, years, earlyCareer = false) {
  const titleMatches = [
    ['executive', /\b(vp|vice president|chief|director|head of)\b/i],
    ['staff/lead', /\b(staff|principal|lead)\b/i],
    ['senior', /\b(senior|sr\.?)\b/i],
    ['junior', /\b(junior|jr\.?|intern|graduate)\b/i],
  ];
  const title = titleMatches.find(([, pattern]) => pattern.test(text));
  if (title) return field(title[0], 0.88, 'Experience title');
  if (earlyCareer) return field('entry-level', 0.82, 'No employment history; education/project evidence found');
  if (years !== null) {
    const value = years >= 10 ? 'staff/lead' : years >= 5 ? 'senior' : years >= 2 ? 'mid' : 'junior';
    return field(value, 0.65, `Estimated from ${years} years`);
  }
  return field('', 0, 'Not inferred');
}

function sectionText(sections, keys) {
  return sections
    .filter((section) => keys.includes(section.key))
    .map((section) => section.text)
    .filter(Boolean)
    .join('\n');
}

function expandEarlyCareerRoles(roles, earlyCareer) {
  if (!earlyCareer) return roles;
  const expanded = [];
  for (const role of roles) {
    expanded.push(role);
    if (role.suggested_fit !== 'primary') continue;
    for (const prefix of ['Junior', 'Entry Level']) {
      expanded.push({
        ...role,
        name: `${prefix} ${role.name}`,
        confidence: Math.max(0.6, role.confidence - 0.08),
        source: `${role.source}; entry-level targeting`,
        suggested_fit: 'adjacent',
      });
    }
    expanded.push({
      ...role,
      name: `${role.name} Intern`,
      confidence: Math.max(0.58, role.confidence - 0.12),
      source: `${role.source}; internship targeting`,
      suggested_fit: 'adjacent',
    });
  }
  return uniqueByName(expanded).slice(0, 10);
}

function splitTopLevel(value) {
  const output = [];
  let current = '';
  let depth = 0;
  for (const character of String(value)) {
    if (character === '(') depth += 1;
    if (character === ')') depth = Math.max(0, depth - 1);
    if ((character === ',' || character === ';' || character === '|') && depth === 0) {
      if (current.trim()) output.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  if (current.trim()) output.push(current.trim());
  return output;
}

function uniqueByName(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = value.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function publicInference(value) {
  return value;
}

function field(value, confidence, source) {
  return { value, confidence, source };
}

function containsTerm(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

function countTerm(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...text.matchAll(new RegExp(`(^|[^a-z0-9])${escaped}(?=[^a-z0-9]|$)`, 'gi'))].length;
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanList(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [...new Set(list.map(clean).filter(Boolean))];
}

function finiteOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function legacyWorkMode(scopes) {
  if (scopes.length === 1 && scopes[0] === 'remote') return 'remote_only';
  if (scopes.length === 1 && scopes[0] === 'local') return 'local_only';
  return 'remote_and_local';
}

function validateDraftId(value) {
  const id = String(value || '');
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw inferenceError('invalid_draft', 'Draft id is invalid', 400);
  return id;
}

function inferenceError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
