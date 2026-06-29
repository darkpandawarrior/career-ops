const EDUCATION_REQUIREMENT = /\b(?:bachelor(?:'s)?|master(?:'s)?|ph\.?d|doctorate|degree|diploma|certification|licen[cs]e)\b/i;
const REQUIRED_CONTEXT = /\b(?:required|must|minimum|need(?:ed)?|mandatory)\b/i;

export function scoreEducation(text, education = {}) {
  const clauses = String(text || '').split(/[.\n;]/).filter((clause) => EDUCATION_REQUIREMENT.test(clause));
  const required = clauses.filter((clause) => REQUIRED_CONTEXT.test(clause));
  if (required.length === 0) {
    return { ratio: 1, status: 'neutral', requirements: [], reason: 'Education is not explicitly required' };
  }
  const requirements = required.map((clause) => clause.trim()).slice(0, 3);
  const evidence = [...(education.levels || []), ...(education.certifications || [])];
  const matched = evidence.filter((item) => requirements.some((requirement) => educationMatches(item, requirement)));
  if (matched.length > 0) return { ratio: 1, status: 'matched', requirements, matched, reason: `Required education matched: ${matched.join(', ')}` };
  if (evidence.length === 0) return { ratio: 0.5, status: 'verify', requirements, matched: [], reason: 'Education is required, but candidate education is not configured' };
  return { ratio: 0.2, status: 'gap', requirements, matched: [], reason: 'An explicit education or certification requirement is not matched' };
}

function educationMatches(evidence, requirement) {
  const value = String(evidence).toLowerCase();
  const target = String(requirement).toLowerCase();
  if (/master|ph\.?d|doctorate/.test(value) && /bachelor|degree/.test(target)) return true;
  return value.split(/[,/]/).some((term) => term.trim().length > 2 && target.includes(term.trim()));
}
