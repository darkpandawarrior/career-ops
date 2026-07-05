const SECTION_ALIASES = Object.freeze({
  summary: ['summary', 'profile summary', 'professional summary', 'profile', 'about me', 'objective'],
  experience: ['experience', 'work experience', 'professional experience', 'employment', 'employment history', 'career history'],
  internships: ['internship', 'internships', 'internship experience', 'industrial training'],
  simulations: ['job simulation', 'job simulations', 'virtual experience', 'virtual experiences', 'forage experience'],
  projects: ['projects', 'selected projects', 'personal projects', 'project experience'],
  skills: ['skills', 'technical skills', 'core skills', 'technologies', 'competencies', 'technical expertise'],
  education: ['education', 'academic background', 'qualifications'],
  certifications: ['certifications', 'certificates', 'licenses'],
  achievements: ['achievements', 'awards', 'honors', 'accomplishments', 'key achievements'],
  publications: ['publications', 'articles', 'writing', 'talks'],
});

const SEARCH_RELEVANT_KEYS = new Set([
  'summary',
  'experience',
  'internships',
  'simulations',
  'projects',
  'skills',
  'education',
  'certifications',
  'achievements',
  'publications',
]);

export function normalizeResumeText(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function structureResume(value) {
  const text = normalizeResumeText(value);
  const lines = text.split('\n');
  const sections = [];
  let current = createSection('header', 'Header');

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    const nextLine = lines.slice(index + 1).find((candidate) => candidate.trim())?.trim() || '';
    const { heading, remainder } = splitHeading(line, { nextLine });
    if (heading) {
      if (current.lines.some(Boolean)) sections.push(finalizeSection(current));
      current = createSection(heading.key, heading.title);
      current.searchRelevant = heading.searchRelevant;
      if (remainder) current.lines.push(remainder);
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.some(Boolean)) sections.push(finalizeSection(current));

  const recognizedSections = sections
    .filter((section) => section.key !== 'header')
    .map((section) => section.key);
  const evidenceSections = sections
    .filter((section) => section.key !== 'header' && section.text.length >= 20);
  const searchRelevantSections = evidenceSections
    .filter((section) => section.searchRelevant)
    .map((section) => section.key);
  const diagnostics = {
    characterCount: text.length,
    wordCount: text ? text.split(/\s+/).filter(Boolean).length : 0,
    lineCount: lines.filter((line) => line.trim()).length,
    recognizedSections,
    searchRelevantSections,
    readyForInference: text.length >= 200
      && evidenceSections.length >= 2,
  };
  const warnings = [];
  if (diagnostics.characterCount < 200) warnings.push('Very little text was extracted; the PDF may be image-based or incomplete.');
  if (!recognizedSections.includes('experience') && !recognizedSections.includes('internships')) {
    warnings.push('No employment section was detected; education, projects, simulations, and skills will be used for entry-level targeting.');
  }
  if (!recognizedSections.includes('skills')) warnings.push('No clear skills section was detected.');
  if (!diagnostics.readyForInference && diagnostics.characterCount >= 200) {
    warnings.push('Review the extracted layout before profile inference.');
  }
  return { text, sections, diagnostics, warnings };
}

function splitHeading(line, context = {}) {
  const direct = classifyHeading(line, context);
  if (direct) return { heading: direct, remainder: '' };
  const match = line.match(/^(.{2,48}?)\s*[:|]\s+(.+)$/);
  if (!match) return { heading: null, remainder: '' };
  const heading = classifyHeading(match[1], context);
  return { heading, remainder: heading ? match[2].trim() : '' };
}

function classifyHeading(line, context = {}) {
  if (!line || line.length > 64) return null;
  const cleaned = line
    .replace(/^#{1,6}\s*/, '')
    .replace(/[:|—–-]+$/, '')
    .trim()
    .toLowerCase();
  for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
    if (aliases.includes(cleaned)) return { key, title: titleCase(cleaned), searchRelevant: SEARCH_RELEVANT_KEYS.has(key) };
  }
  if (looksLikeCustomHeading(line, cleaned, context)) {
    return {
      key: `custom_${slug(cleaned)}`,
      title: titleCase(cleaned),
      searchRelevant: isSearchRelevantHeading(cleaned),
    };
  }
  return null;
}

function createSection(key, title) {
  return { key, title, lines: [], searchRelevant: key === 'header' ? false : SEARCH_RELEVANT_KEYS.has(key) };
}

function finalizeSection(section) {
  const text = normalizeResumeText(section.lines.join('\n'));
  return {
    key: section.key,
    title: section.title,
    searchRelevant: section.searchRelevant,
    text,
    lineCount: text ? text.split('\n').filter(Boolean).length : 0,
    preview: text.slice(0, 320),
  };
}

function titleCase(value) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function looksLikeCustomHeading(original, cleaned, context) {
  if (!cleaned || cleaned.length < 3 || cleaned.split(/\s+/).length > 7) return false;
  if (/[@]|https?:|www\.|\d{3,}/i.test(cleaned)) return false;
  if (/^[•*\-–—]/.test(original.trim())) return false;
  if (looksLikeDateRange(context.nextLine)) return false;
  const letters = original.match(/[A-Za-z]/g) || [];
  const uppercase = original.match(/[A-Z]/g) || [];
  if (letters.length >= 3 && uppercase.length / letters.length >= 0.78) return true;
  return /\b(leadership|volunteering|volunteer experience|community|activities|affiliations|memberships|patents|conferences|workshops|training|coursework|case studies|case study|competitions|hackathons|open source|awards)\b/i.test(cleaned);
}

function isSearchRelevantHeading(value) {
  return !/\b(references|declaration|personal details|interests|hobbies)\b/i.test(value);
}

function slug(value) {
  return value.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'section';
}

function looksLikeDateRange(value) {
  return /\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+)?(?:19|20)\d{2}\s*(?:-|–|—|to)\s*(?:present|current|now|(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+)?(?:19|20)\d{2})\b/i.test(value);
}
