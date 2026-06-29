import { normalizeJobSearchConfig } from '../search/config-schema.mjs';
import { classifyCompensation } from './compensation.mjs';
import { classifyEligibility } from './eligibility.mjs';
import { extractExperience, scoreExperience } from './experience.mjs';

export function scoreJob(rawJob, rawConfig) {
  const config = normalizeJobSearchConfig(rawConfig);
  const job = normalizeRawJob(rawJob);
  const skillSignal = scoreSkills(job, config.skills);
  const experience = extractExperience(job.text, job.title);
  const experienceSignal = scoreExperience(experience, config.seniority);
  const availabilitySignal = scoreAvailability(job.text, config.availability);
  const eligibility = classifyEligibility(job, config);
  const compensation = classifyCompensation(job, eligibility, config);
  const weights = config.weights;

  let rawScore =
    skillSignal.ratio * weights.skills
    + experienceSignal.ratio * weights.experience
    + availabilitySignal.ratio * weights.availability;

  const gates = [];
  if (skillSignal.excluded.length > 0) gates.push(`Excluded skills: ${skillSignal.excluded.join(', ')}`);
  if (eligibility.status === 'blocked') gates.push(eligibility.reason);
  if (compensation.gate) gates.push(compensation.label);

  if (gates.length > 0) rawScore = Math.min(rawScore, 35);
  const scoreRaw = Math.max(0, Math.min(100, Math.round(rawScore * 10) / 10));
  const score = Math.max(1, Math.min(10, Math.round(scoreRaw / 10)));
  const priority = classifyPriority(score, eligibility, compensation, gates);
  const reasons = [
    `Skills: ${skillSignal.reason}`,
    `Experience: ${experienceSignal.reason}`,
    `Joining availability: ${availabilitySignal.reason}`,
    `Location: ${eligibility.reason}`,
    `Compensation: ${compensation.label}`,
  ];
  if (skillSignal.recommendedGaps.length > 0) {
    reasons.push(`Recommended gaps: ${skillSignal.recommendedGaps.join(', ')}`);
  }
  if (gates.length > 0) reasons.push(`Gates: ${gates.join('; ')}`);

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
    excludedSkillMatches: skillSignal.excluded,
    skillMatchCount: skillSignal.fullCredit.length + skillSignal.supporting.length,
    yearsRequired: experience.label,
    yearsMin: experience.min,
    yearsMax: experience.max,
    experienceStatus: experienceSignal.status,
    availabilityStatus: availabilitySignal.status,
    locationLabel: eligibility.label,
    remoteStatus: eligibility.status,
    eligibility,
    compensation,
    gates,
    reasons,
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
    snippet,
    compensation: rawJob.compensation,
    salary: rawJob.salary,
    text: `${title} ${company} ${location} ${source} ${snippet}`,
  };
}

function scoreSkills(job, skills) {
  const fullCredit = matchedTerms(job.text, [...skills.demonstrated, ...skills.confirmed_unlisted]);
  const supporting = matchedTerms(job.text, skills.supporting);
  const learning = matchedTerms(job.text, skills.learning);
  const recommendedGaps = matchedTerms(job.text, skills.recommended_gaps);
  const excluded = matchedTerms(job.text, skills.excluded);
  const totalWeight = skills.demonstrated.length + skills.confirmed_unlisted.length + skills.supporting.length * 0.6;
  const earned = fullCredit.length + supporting.length * 0.6;
  const ratio = totalWeight > 0 ? Math.min(1, earned / Math.min(totalWeight, 6)) : 0;
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
    reason: parts.join(', ') || 'No configured skill evidence found',
  };
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

function containsTerm(value, term) {
  const haystack = String(value).toLowerCase();
  const needle = String(term).toLowerCase().trim();
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const left = /^[a-z0-9]/i.test(needle) ? '(?<![a-z0-9])' : '';
  const right = /[a-z0-9]$/i.test(needle) ? '(?![a-z0-9])' : '';
  return new RegExp(`${left}${escaped}${right}`, 'i').test(haystack);
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
