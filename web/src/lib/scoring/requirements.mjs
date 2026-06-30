const MANDATORY = /\b(must|required|requirements?|minimum qualifications?|need(?:ed)?|proficien(?:t|cy)|strong (?:knowledge|experience))\b/i;
const PREFERRED = /\b(preferred|nice to have|desirable|bonus|plus|ideally)\b/i;

export function parseSkillRequirements(text, skills) {
  const clauses = String(text || '').split(/(?:[.\n;]|\s[-\u2022]\s)+/).filter(Boolean);
  const configured = unique([
    ...skills.demonstrated, ...skills.confirmed_unlisted, ...skills.supporting,
    ...skills.learning, ...skills.recommended_gaps,
  ]);
  const result = { mandatory: [], preferred: [], related: [], transferable: [] };
  for (const skill of configured) {
    const matching = clauses.filter((clause) => containsTerm(clause, skill));
    if (matching.length === 0) continue;
    if (matching.some((clause) => MANDATORY.test(clause))) result.mandatory.push(skill);
    else if (matching.some((clause) => PREFERRED.test(clause))) result.preferred.push(skill);
    else if (skills.supporting.some((item) => same(item, skill))) result.related.push(skill);
    else if (skills.learning.some((item) => same(item, skill))) result.transferable.push(skill);
    else result.mandatory.push(skill);
  }
  return result;
}

export function containsTerm(value, term) {
  const needle = String(term || '').trim();
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const left = /^[a-z0-9]/i.test(needle) ? '(?<![a-z0-9])' : '';
  const right = /[a-z0-9]$/i.test(needle) ? '(?![a-z0-9])' : '';
  return new RegExp(`${left}${escaped}${right}`, 'i').test(String(value));
}

function same(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = String(value).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
