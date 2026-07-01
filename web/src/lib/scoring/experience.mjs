export function extractExperience(text = '', title = '') {
  const matches = [...String(text).matchAll(/(\d{1,2})\s*(?:\+|(?:-|–|to)\s*(\d{1,2}))?\s*(?:years?|yrs?)/gi)]
    .map((match) => ({
      min: Number(match[1]),
      max: match[2] ? Number(match[2]) : null,
    }))
    .filter(({ min, max }) => Number.isFinite(min) && (max === null || Number.isFinite(max)));

  if (matches.length > 0) {
    matches.sort((a, b) => a.min - b.min);
    const best = matches[0];
    return {
      ...best,
      label: best.max === null ? `${best.min}+ years` : `${best.min}-${best.max} years`,
      source: 'description',
    };
  }

  const normalizedTitle = String(title).toLowerCase();
  if (/\b(intern|internship|graduate|entry|junior|jr\.?)\b/.test(normalizedTitle)) {
    return { min: 0, max: 2, label: 'Likely 0-2 years', source: 'title inference' };
  }
  if (/\b(principal|director|head|vp|vice president)\b/.test(normalizedTitle)) {
    return { min: 8, max: null, label: 'Likely 8+ years', source: 'title inference' };
  }
  if (/\b(staff|lead)\b/.test(normalizedTitle)) {
    return { min: 6, max: 10, label: 'Likely 6-10 years', source: 'title inference' };
  }
  if (/\b(senior|sr\.?)\b/.test(normalizedTitle)) {
    return { min: 4, max: 8, label: 'Likely 4-8 years', source: 'title inference' };
  }
  return { min: null, max: null, label: 'Not listed', source: 'unknown' };
}

export function scoreExperience(experience, seniority) {
  const targetMin = seniority.minimum_years;
  const targetMax = seniority.maximum_years;
  if (experience.min === null) {
    return { ratio: 0.55, status: 'unknown', reason: 'Experience requirement is not listed' };
  }
  if (targetMax !== null && experience.min > targetMax + 1) {
    return { ratio: 0.15, status: 'too_senior', reason: `Role starts at ${experience.min} years; target ceiling is ${targetMax}` };
  }
  if (targetMin !== null && experience.max !== null && experience.max < targetMin - 1) {
    return { ratio: 0.3, status: 'too_junior', reason: `Role tops out at ${experience.max} years; target floor is ${targetMin}` };
  }
  if (targetMin !== null && experience.min > targetMin + 2) {
    return { ratio: 0.6, status: 'stretch', reason: `Role asks for ${experience.label}` };
  }
  return { ratio: 1, status: 'aligned', reason: `Experience aligns at ${experience.label}` };
}
