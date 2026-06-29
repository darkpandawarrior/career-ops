import { normalizeJobSearchConfig } from '../search/config-schema.mjs';
import { classifyCompensation } from './compensation.mjs';
import { classifyEligibility } from './eligibility.mjs';
import { extractExperience, scoreExperience } from './experience.mjs';
import { scoreEducation } from './education.mjs';
import { containsTerm, parseSkillRequirements } from './requirements.mjs';

export function scoreJob(rawJob, rawConfig) {
  const config = normalizeJobSearchConfig(rawConfig);
  const job = normalizeRawJob(rawJob);
  const skillSignal = scoreSkills(job, config.skills);
  const experience = extractExperience(job.text, job.title);
  const experienceSignal = scoreExperience(experience, config.seniority);
  const availabilitySignal = scoreAvailability(job.text, config.availability);
  const eligibility = classifyEligibility(job, config);
  const compensation = classifyCompensation(job, eligibility, config);
  const educationSignal = scoreEducation(job.text, config.education);
  const otherSignal = scoreOtherSignals(job, compensation, config.preferences);
  const weights = config.weights;

  let rawScore =
    skillSignal.ratio * weights.skills
    + experienceSignal.ratio * weights.experience
    + eligibility.ratio * weights.eligibility
    + ((availabilitySignal.ratio + educationSignal.ratio) / 2) * weights.notice_education
    + otherSignal.ratio * weights.other;

  const gates = [];
  if (skillSignal.excluded.length > 0) gates.push(`Excluded skills: ${skillSignal.excluded.join(', ')}`);
  if (eligibility.status === 'blocked') gates.push(eligibility.reason);

  if (gates.length > 0) rawScore = Math.min(rawScore, 35);
  const scoreRaw = Math.max(0, Math.min(100, Math.round(rawScore * 10) / 10));
  const score = Math.max(1, Math.min(10, Math.round(scoreRaw / 10)));
  const priority = classifyPriority(score, eligibility, compensation, gates);
  const reasons = [
    `Skills: ${skillSignal.reason}`,
    `Experience: ${experienceSignal.reason}`,
    `Eligibility: ${eligibility.reason}`,
    `Notice period: ${availabilitySignal.reason}`,
    `Education: ${educationSignal.reason}`,
    `Other signals: ${otherSignal.reason}`,
  ];
  if (skillSignal.recommendedGaps.length > 0) {
    reasons.push(`Recommended gaps: ${skillSignal.recommendedGaps.join(', ')}`);
  }
  if (gates.length > 0) reasons.push(`Gates: ${gates.join('; ')}`);
  const explanation = buildExplanation({
    skillSignal,
    experienceSignal,
    availabilitySignal,
    educationSignal,
    eligibility,
    compensation,
    gates,
  });
  const missingInformation = buildMissingInformation(job, experience, eligibility, compensation);
  const recommendedAction = buildRecommendedAction({ gates, eligibility, scoreRaw, missingInformation });

  return {
    ...job,
    score,
    scoreRaw,
    level: score >= 9 ? 'Excellent' : score >= 7 ? 'Strong' : score >= 5 ? 'Possible' : 'Low',
    priority,
    urgency: priority,
    titleMatch: 'Not scored',
    matchedTitle: '',
    matchedSkills: skillSignal.fullCredit,
    supportingSkills: skillSignal.supporting,
    learningSkills: skillSignal.learning,
    recommendedSkillGaps: skillSignal.recommendedGaps,
    skillRequirements: skillSignal.requirements,
    excludedSkillMatches: skillSignal.excluded,
    skillMatchCount: skillSignal.fullCredit.length + skillSignal.supporting.length,
    yearsRequired: experience.label,
    yearsMin: experience.min,
    yearsMax: experience.max,
    experienceStatus: experienceSignal.status,
    availabilityStatus: availabilitySignal.status,
    educationStatus: educationSignal.status,
    educationRequirements: educationSignal.requirements,
    locationLabel: eligibility.label,
    remoteStatus: eligibility.status,
    eligibility,
    compensation,
    scoreBreakdown: {
      skills: roundSignal(skillSignal.ratio * weights.skills),
      experience: roundSignal(experienceSignal.ratio * weights.experience),
      eligibility: roundSignal(eligibility.ratio * weights.eligibility),
      noticeEducation: roundSignal(((availabilitySignal.ratio + educationSignal.ratio) / 2) * weights.notice_education),
      other: roundSignal(otherSignal.ratio * weights.other),
    },
    gates,
    reasons,
    whyRanksHighly: explanation.positive,
    potentialConcerns: explanation.concerns,
    missingInformation,
    recommendedAction,
  };
}

export function normalizeJob(rawJob, config) {
  const scored = scoreJob(rawJob, config);
  return {
    id: rawJob.id || stableId(`${scored.url}|${scored.company}|${scored.title}`),
    ...scored,
    section: scored.type === 'searchLead'
      ? 'sources'
      : scored.score >= 7 && scored.gates.length === 0 ? 'recommended' : 'review',
  };
}

function normalizeRawJob(rawJob = {}) {
  const title = clean(rawJob.title) || 'Untitled role';
  const company = clean(rawJob.company) || inferCompany(rawJob.url) || 'Unknown company';
  const location = clean(rawJob.location);
  const snippet = clean(rawJob.snippet || rawJob.description);
  const source = clean(rawJob.source);
  return {
    type: clean(rawJob.type) || 'job',
    title,
    company,
    location,
    url: clean(rawJob.url),
    source,
    sourceCategory: clean(rawJob.sourceCategory),
    discoveryQuery: clean(rawJob.discoveryQuery),
    discoveryReason: clean(rawJob.discoveryReason),
    snippet,
    compensation: rawJob.compensation,
    salary: rawJob.salary,
    employmentType: clean(rawJob.employmentType || rawJob.employment_type) || inferEmploymentType(snippet),
    authorization: clean(rawJob.authorization || rawJob.workAuthorization || rawJob.work_authorization) || 'unknown',
    remoteRestrictions: clean(rawJob.remoteRestrictions || rawJob.remote_restrictions) || inferRemoteRestrictions(snippet),
    postedDate: normalizeDate(rawJob.postedDate || rawJob.posted_at || rawJob.publishedAt || rawJob.published_at || rawJob.date),
    updatedDate: normalizeDate(rawJob.updatedDate || rawJob.updated_at),
    freshness: classifyFreshness(rawJob.postedDate || rawJob.posted_at || rawJob.publishedAt || rawJob.published_at || rawJob.date),
    text: `${title} ${company} ${location} ${source} ${snippet}`,
  };
}

function scoreSkills(job, skills) {
  const requirements = parseSkillRequirements(job.snippet, skills);
  const fullCredit = matchedTerms(job.text, [...skills.demonstrated, ...skills.confirmed_unlisted]);
  const supporting = matchedTerms(job.text, skills.supporting);
  const learning = matchedTerms(job.text, skills.learning);
  const recommendedGaps = matchedTerms(job.text, skills.recommended_gaps);
  const excluded = matchedTerms(job.text, skills.excluded);
  const evidence = [...skills.demonstrated, ...skills.confirmed_unlisted];
  const candidateHas = (skill) => matchedTerms(skill, evidence).length > 0;
  const mandatoryRatio = requirements.mandatory.length
    ? requirements.mandatory.filter(candidateHas).length / requirements.mandatory.length
    : Math.min(1, fullCredit.length / 3);
  const preferredRatio = requirements.preferred.length
    ? requirements.preferred.filter(candidateHas).length / requirements.preferred.length
    : Math.min(1, (supporting.length + fullCredit.length) / 4);
  const adjacentCredit = Math.min(1, (requirements.related.length * 0.65 + requirements.transferable.length * 0.35) / 2);
  const ratio = Math.min(1, mandatoryRatio * 0.7 + preferredRatio * 0.2 + adjacentCredit * 0.1);
  const parts = [];
  if (fullCredit.length > 0) parts.push(`${fullCredit.length} verified`);
  if (supporting.length > 0) parts.push(`${supporting.length} supporting`);
  if (learning.length > 0) parts.push(`${learning.length} learning (no full credit)`);
  if (recommendedGaps.length > 0) parts.push(`${recommendedGaps.length} recommended gap`);
  return {
    ratio,
    fullCredit,
    supporting,
    learning,
    recommendedGaps,
    excluded,
    requirements,
    reason: parts.join(', ') || 'No configured skill evidence found',
  };
}

function scoreOtherSignals(job, compensation, preferences) {
  const domainMatch = matchedTerms(job.text, preferences.domains).length > 0;
  const negative = matchedTerms(job.text, preferences.negative_keywords).length > 0;
  const compensationRatio = compensation.status === 'below_minimum' ? 0.1
    : compensation.status === 'meets_minimum' ? 1 : 0.7;
  const sourceRatio = job.source ? 1 : 0.6;
  const preferenceRatio = negative ? 0 : domainMatch || preferences.domains.length === 0 ? 1 : 0.6;
  const freshnessRatio = job.freshness.band === '0-14 days' ? 1
    : job.freshness.band === '15-30 days' ? 0.8
      : job.freshness.band === '31-60 days' ? 0.45
        : job.freshness.band === 'over 60 days' ? 0 : 0.55;
  return {
    ratio: compensationRatio * 0.35 + sourceRatio * 0.15 + preferenceRatio * 0.25 + freshnessRatio * 0.25,
    reason: [compensation.label, job.freshness.label, domainMatch ? 'preferred industry' : '', negative ? 'excluded preference found' : '', job.source ? `source: ${job.source}` : 'source unclear'].filter(Boolean).join('; '),
  };
}

export function classifyFreshness(value, now = new Date()) {
  const normalized = normalizeDate(value);
  if (!normalized) return { band: 'unknown', daysOld: null, label: 'Posting date unknown', confirmed: false };
  const daysOld = Math.max(0, Math.floor((now.getTime() - new Date(normalized).getTime()) / 86_400_000));
  if (daysOld <= 14) return { band: '0-14 days', daysOld, label: `Posted ${daysOld} day${daysOld === 1 ? '' : 's'} ago`, confirmed: true };
  if (daysOld <= 30) return { band: '15-30 days', daysOld, label: `Posted ${daysOld} days ago`, confirmed: true };
  if (daysOld <= 60) return { band: '31-60 days', daysOld, label: `Posted ${daysOld} days ago`, confirmed: true };
  return { band: 'over 60 days', daysOld, label: `Posted ${daysOld} days ago`, confirmed: true };
}

function normalizeDate(value) {
  if (value == null || value === '') return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function inferEmploymentType(text) {
  const value = String(text).toLowerCase();
  if (/\bintern(?:ship)?\b/.test(value)) return 'internship';
  if (/\bfreelance\b/.test(value)) return 'freelance';
  if (/\b(?:contract|contractor)\b/.test(value)) return 'contract';
  if (/\bpart[ -]?time\b/.test(value)) return 'part-time';
  if (/\bfull[ -]?time\b/.test(value)) return 'full-time';
  return 'unknown';
}

function inferRemoteRestrictions(text) {
  const value = String(text);
  const match = value.match(/\bremote\s*(?:-|â€“|â€”|:)?\s*(?:only\s+)?(?:within|in|from|for)?\s*([A-Z][A-Za-z ]{2,30})(?:\.|,|$)/i);
  return match ? match[1].trim() : 'unknown';
}

function buildMissingInformation(job, experience, eligibility, compensation) {
  const missing = [];
  if (!job.postedDate) missing.push('Posting date');
  if (job.employmentType === 'unknown') missing.push('Employment type');
  if (experience.min === null && experience.max === null) missing.push('Experience range');
  if (eligibility.status === 'verify') missing.push('Work authorization or location eligibility');
  if (job.remoteRestrictions === 'unknown' && /remote/i.test(job.text)) missing.push('Remote location restrictions');
  if (compensation.status === 'unknown') missing.push('Compensation');
  return missing;
}

function buildRecommendedAction({ gates, eligibility, scoreRaw, missingInformation }) {
  if (gates.length) return 'Do not apply unless the explicit incompatibility is resolved.';
  if (eligibility.status === 'verify') return 'Verify eligibility with the employer before investing in an application.';
  if (scoreRaw >= 70) return missingInformation.length ? 'Review the missing details, then consider a tailored application.' : 'Strong candidate for a tailored application.';
  if (scoreRaw >= 50) return 'Review the concerns before deciding whether to apply.';
  return 'Keep for reference, but prioritize stronger-fit opportunities.';
}

function buildExplanation({
  skillSignal,
  experienceSignal,
  availabilitySignal,
  educationSignal,
  eligibility,
  compensation,
  gates,
}) {
  const positive = [];
  const concerns = [];

  if (skillSignal.ratio >= 0.8) positive.push('Strong match across the role’s required skills');
  else if (skillSignal.ratio >= 0.55) positive.push('Good overlap with the role’s core skills');
  else concerns.push('Verified skill overlap is limited');

  if (experienceSignal.status === 'aligned') positive.push(`Experience aligns with ${experienceSignal.reason.replace(/^Experience aligns at\s*/i, '')}`);
  else if (experienceSignal.status === 'unknown') concerns.push('The posting does not state a clear experience requirement');
  else concerns.push(experienceSignal.reason);

  if (eligibility.status === 'open') positive.push(eligibility.reason);
  else if (eligibility.status === 'relocation') positive.push(eligibility.reason);
  else concerns.push(eligibility.reason);

  if (availabilitySignal.status === 'aligned') positive.push(availabilitySignal.reason);
  else if (!['unknown'].includes(availabilitySignal.status)) concerns.push(availabilitySignal.reason);

  if (educationSignal.status === 'matched') positive.push(educationSignal.reason);
  else if (['verify', 'gap'].includes(educationSignal.status)) concerns.push(educationSignal.reason);

  if (compensation.status === 'meets_minimum') positive.push(compensation.label);
  else if (['unknown', 'below_minimum', 'currency_mismatch'].includes(compensation.status)) concerns.push(compensation.label);

  for (const skill of skillSignal.recommendedGaps) concerns.push(`${skill} is requested but not confirmed`);
  for (const gate of gates) if (!concerns.includes(gate)) concerns.push(gate);

  return { positive: uniqueText(positive), concerns: uniqueText(concerns) };
}

function scoreAvailability(text, availability) {
  const noticeDays = parseNoticeDays(availability?.notice_period);
  const requiredDays = parseRequiredJoiningDays(text);
  if (requiredDays === null) {
    return {
      ratio: 1,
      status: 'unknown',
      reason: 'No joining deadline is listed, so availability does not reduce the match',
    };
  }
  if (noticeDays === null) {
    return {
      ratio: 0.5,
      status: 'verify',
      reason: `The role expects joining within ${requiredDays} days; candidate notice period is unclear`,
    };
  }
  if (noticeDays <= requiredDays) {
    return {
      ratio: 1,
      status: 'aligned',
      reason: `${noticeDays}-day notice fits the role's ${requiredDays}-day joining window`,
    };
  }
  const delay = noticeDays - requiredDays;
  return {
    ratio: delay <= 15 ? 0.65 : delay <= 30 ? 0.35 : 0.1,
    status: delay <= 15 ? 'close' : 'mismatch',
    reason: `${noticeDays}-day notice exceeds the role's ${requiredDays}-day joining window`,
  };
}

function parseNoticeDays(value) {
  const text = String(value || '').toLowerCase();
  if (!text) return null;
  if (/\b(immediate|available now|no notice)\b/.test(text)) return 0;
  const match = text.match(/(\d+(?:\.\d+)?)\s*(day|week|month)/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (match[2] === 'week') return Math.round(amount * 7);
  if (match[2] === 'month') return Math.round(amount * 30);
  return Math.round(amount);
}

function parseRequiredJoiningDays(text) {
  const normalized = String(text || '').toLowerCase();
  if (/\b(immediate joiner|join immediately|immediate joining|available immediately)\b/.test(normalized)) return 7;
  const match = normalized.match(/\bjoin(?:ing)?\s+(?:within|in)\s+(\d+)\s*(day|week|month)s?\b/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (match[2] === 'week') return Math.round(amount * 7);
  if (match[2] === 'month') return Math.round(amount * 30);
  return Math.round(amount);
}

function classifyPriority(score, eligibility, compensation, gates) {
  if (gates.length > 0) return 'Skip or investigate';
  if (eligibility.status === 'verify') return score >= 7 ? 'Verify eligibility' : 'Review later';
  if (compensation.status === 'unknown' && score >= 8) return 'Strong fit; verify compensation';
  if (score >= 9) return 'Apply immediately';
  if (score >= 8) return 'Apply within 24 hours';
  if (score >= 6) return 'Review this week';
  return 'Low priority';
}

function matchedTerms(value, terms) {
  return terms.filter((term) => containsTerm(value, term));
}

function roundSignal(value) { return Math.round(value * 10) / 10; }

function uniqueText(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = String(value).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferCompany(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').split('.')[0];
  } catch {
    return '';
  }
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stableId(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
