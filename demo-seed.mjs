#!/usr/bin/env node

/**
 * demo-seed.mjs — materialize a fully-populated DEMO profile with synthetic data.
 *
 * Why this exists: the README's screenshots must show the product actually
 * working, and they must never show a real job search. Every company, role, URL
 * and score below is invented. Nothing is derived from the user's tracker, feed
 * or reports — deriving would risk leaking a field nobody remembered to
 * overwrite.
 *
 * Deterministic: same input, same output, so a regenerated screenshot set diffs
 * cleanly instead of churning on every run.
 *
 *   node demo-seed.mjs /tmp/hs-demo
 *   CAREER_OPS_ROOT=/tmp/hs-demo npm --prefix web run dev
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node demo-seed.mjs <targetDir>');
  process.exit(1);
}

const DAY = 86_400_000;
// Fixed clock so the fixture is reproducible rather than "now"-dependent.
const NOW = Date.parse('2026-08-14T09:00:00.000Z');
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
const ymd = (daysAgo) => iso(daysAgo).slice(0, 10);

// Deliberately fictional employers — the standard placeholder cast.
const JOBS = [
  ['Acme',             'Senior Platform Engineer',     'Bengaluru, India',    9.1, 'excellent', 'ats',    1, ['Kotlin', 'Kubernetes', 'Terraform']],
  ['Globex',           'Staff DevOps Engineer',        'Remote — worldwide',  8.7, 'excellent', 'ats',    1, ['Go', 'AWS', 'CI/CD']],
  ['Wayne Data',       'Staff Infrastructure Engineer','Pune, India',         8.4, 'excellent', 'ats',    2, ['Terraform', 'Observability']],
  ['Soylent Systems',  'Senior SRE',                   'Remote — India',      8.2, 'excellent', 'board',  2, ['SRE', 'Prometheus', 'Go']],
  ['Umbrella Cloud',   'Platform Engineer',            'Hybrid — Bengaluru',  7.6, 'strong',    'ats',    3, ['Kubernetes', 'Helm']],
  ['Stark Industries', 'Infrastructure Engineer',      'Pune, India',         7.3, 'strong',    'ats',    3, ['Linux', 'Networking']],
  ['Initech',          'Site Reliability Engineer',    'Remote — EU only',    6.9, 'strong',    'board',  4, ['SRE', 'Python']],
  ['Cyberdyne',        'Cloud Platform Engineer',      'Chennai, India',      6.4, 'possible',  'ats',    5, ['AWS', 'Docker']],
  ['Tyrell Corp',      'DevOps Engineer',              'Remote — US only',    5.8, 'possible',  'board',  6, ['Jenkins', 'Ansible']],
  ['Hooli',            'DevOps Lead',                  'Bengaluru, India',    5.1, 'possible',  'ats',    7, ['Leadership', 'CI/CD']],
  ['Vandelay',         'Systems Engineer',             'Mumbai, India',       4.2, 'low',       'board',  9, ['Bash', 'Monitoring']],
  ['Massive Dynamic',  'Build Engineer',               'Remote — India',      3.6, 'low',       'ats',   11, ['Gradle', 'Bazel']],
];

const jobs = JOBS.map(([company, title, location, score, level, sourceCategory, age, skills], i) => ({
  id: `demo-${String(i + 1).padStart(3, '0')}`,
  type: 'job',
  title,
  company,
  location,
  url: `https://example.com/${company.toLowerCase().replace(/\W+/g, '-')}/jobs/${1000 + i}`,
  source: company,
  sourceCategory,
  discoveryQuery: '',
  discoveryReason: 'ats-sweep',
  snippet: `${company} is hiring a ${title}. Synthetic demo posting — not a real opening.`,
  compensation: score >= 8 ? '₹40–55L' : '',
  employmentType: 'Full-time',
  postedDate: ymd(age),
  updatedDate: ymd(age),
  freshness: age <= 3 ? 'fresh' : age <= 7 ? 'recent' : 'aging',
  text: '',
  score,
  scoreRaw: score,
  level,
  priority: score >= 8 ? 'high' : score >= 6 ? 'medium' : 'low',
  urgency: age <= 2 ? 'apply-now' : 'normal',
  titleMatch: true,
  matchedTitle: title,
  matchedSkills: skills,
  supportingSkills: [],
  learningSkills: [],
  skillMatchCount: skills.length,
  locationLabel: location,
  remoteStatus: location.startsWith('Remote') ? 'remote' : 'onsite',
  eligibility: location.includes('US only') || location.includes('EU only') ? 'restricted' : 'eligible',
  reasons: [`Matches ${skills.length} of your core skills`],
  whyRanksHighly: score >= 8 ? [`Strong overlap on ${skills[0]}`, 'Location within your gate'] : [],
  potentialConcerns: location.includes('only') ? ['Country eligibility restricted'] : [],
  recommendedAction: score >= 8 ? 'apply' : score >= 6 ? 'review' : 'skip',
  section: score >= 8 ? 'recommended' : score >= 6 ? 'review' : 'sources',
}));

const feed = {
  version: 2,
  scored: true,
  generatedAt: iso(0),
  jobs,
  stats: {
    total: jobs.length,
    excellent: jobs.filter(j => j.level === 'excellent').length,
    strong: jobs.filter(j => j.level === 'strong').length,
    sources: [...new Set(jobs.map(j => j.source))].length,
  },
  scan: { lastRun: iso(0), companies: 28746, newOffers: jobs.length },
};

const TRACKER = [
  [1, 19, 'Acme',             'Senior Platform Engineer',     '4.2/5', 'Applied',   '✅', 'Strong platform fit; follow-up sent'],
  [2, 16, 'Globex',           'Staff DevOps Engineer',        '4.5/5', 'Interview', '✅', 'R2 scheduled; referral via ex-colleague'],
  [3, 13, 'Initech',          'Site Reliability Engineer',    '3.1/5', 'SKIP',      '❌', 'Below the 4.0 bar — not pursued'],
  [4, 10, 'Umbrella Cloud',   'Platform Engineer',            '4.0/5', 'Evaluated', '❌', 'Awaiting decision'],
  [5, 6,  'Hooli',            'DevOps Lead',                  '3.8/5', 'Rejected',  '✅', 'Auto-rejection on day 2'],
  [6, 4,  'Stark Industries', 'Infrastructure Engineer',      '4.1/5', 'Applied',   '✅', 'Follow-up due next week'],
  [7, 2,  'Soylent Systems',  'Senior SRE',                   '4.6/5', 'Responded', '✅', 'Recruiter replied, screen pending'],
  [8, 1,  'Wayne Data',       'Staff Infrastructure Engineer','4.4/5', 'Offer',     '✅', 'Offer received, negotiating'],
];

mkdirSync(join(target, 'data'), { recursive: true });
mkdirSync(join(target, 'config'), { recursive: true });
mkdirSync(join(target, 'reports'), { recursive: true });
mkdirSync(join(target, 'modes'), { recursive: true });

writeFileSync(join(target, 'data', 'job-dashboard.json'), JSON.stringify(feed, null, 2));

writeFileSync(join(target, 'data', 'applications.md'),
  '# Applications Tracker\n\n'
  + '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
  + '|---|------|---------|------|-------|--------|-----|--------|-------|\n'
  + TRACKER.map(([n, age, co, role, score, status, pdf, note]) =>
      `| ${n} | ${ymd(age)} | ${co} | ${role} | ${score} | ${status} | ${pdf} | — | ${note} |`).join('\n') + '\n');

writeFileSync(join(target, 'data', 'pipeline.md'),
  '# Pipeline — Pending Offers\n\n## Pendientes\n'
  + jobs.filter(j => j.section !== 'sources').slice(0, 6)
      .map(j => `- [ ] ${j.url} | ${j.company} | ${j.title} | ${j.location} | posted: ${j.postedDate}`).join('\n') + '\n');

writeFileSync(join(target, 'data', 'scan-runs.tsv'),
  'timestamp\tstatus\tcompanies\tboards\tfound\tfiltered_title\tfiltered_tier\tfiltered_location\tfiltered_posting_age\tfiltered_salary\tfiltered_content\tfiltered_cooldown\tdupes\tnew_added\terrors\tfiltered_blacklist\tfiltered_visa\tfiltered_posted_date\tfiltered_country_eligibility\n'
  + [0, 1, 2, 3].map(d =>
      `${iso(d)}\tcompleted\t28746\t28746\t${2000 + d * 37}\t${1900 + d * 30}\t0\t26\t0\t0\t0\t0\t34\t${d === 0 ? jobs.length : 2}\t13252\t0\t0\t0\t${4 + d}`).join('\n') + '\n');

writeFileSync(join(target, 'data', 'follow-ups.md'),
  `# Follow-ups\n\n- ${ymd(5)} | Acme | Senior Platform Engineer | first follow-up sent\n- ${ymd(2)} | Stark Industries | Infrastructure Engineer | nudge sent\n`);

writeFileSync(join(target, 'portals.yml'),
  '# Demo portal config — fictional employers only.\n'
  + 'title_filter:\n  positive: ["platform engineer", "sre", "devops", "infrastructure"]\n  negative: ["intern", "manager"]\n'
  + 'location_filter:\n  positive: ["remote", "india", "bengaluru", "pune"]\n'
  + 'country_eligibility_filter:\n'
  + '  exclusionary: ["must be located in the united states", "us-based candidates only"]\n'
  + '  inclusive: ["united states or canada", "worldwide", "india"]\n'
  + 'tracked_companies:\n'
  + [...new Set(jobs.map(j => j.company))].map(c =>
      `  - name: ${c}\n    careers_url: https://example.com/${c.toLowerCase().replace(/\W+/g, '-')}/careers`).join('\n') + '\n');

// The scorer reads config/job-search.yml (schema: config/job-search.example.yml),
// not profile.yml — an empty skills list gates scoring and the board stays blank.
writeFileSync(join(target, 'config', 'job-search.yml'),
  'titles:\n'
  + '  strong:\n    - Senior Platform Engineer\n    - Staff Platform Engineer\n    - Senior SRE\n'
  + '  adjacent:\n    - Infrastructure Engineer\n    - DevOps Engineer\n    - Cloud Platform Engineer\n'
  + '  exclude:\n    - Frontend Engineer\n    - Engineering Manager\n'
  + 'skills:\n'
  + '  demonstrated:\n    - Kubernetes\n    - Terraform\n    - Go\n    - Kotlin\n'
  + '  confirmed_unlisted:\n    - Helm\n'
  + '  supporting:\n    - AWS\n    - Prometheus\n    - CI/CD\n'
  + '  learning:\n    - Bazel\n'
  + 'locations:\n  preferred:\n    - Remote\n    - Bengaluru\n    - Pune\n  country: India\n');

writeFileSync(join(target, 'config', 'profile.yml'),
  'personal:\n  name: Demo Candidate\n  email: demo@example.com\n  location: "Bengaluru, India"\n'
  + 'location:\n  country: India\n  city: Bengaluru\n'
  + 'job_search:\n  skills: ["Kotlin", "Kubernetes", "Terraform", "Go", "AWS", "CI/CD", "SRE"]\n'
  + '  titles: ["Platform Engineer", "SRE", "DevOps Engineer"]\n  min_score: 6\n');

writeFileSync(join(target, 'cv.md'),
  '# Demo Candidate\n\nPlatform / SRE engineer. Every fact on this page is invented for the demo fixture.\n\n'
  + '## Experience\n\n### Senior Platform Engineer — Globex (2022–present)\n'
  + '- Ran a 40-node Kubernetes platform for 12 product teams\n- Cut deploy lead time from 45min to 6min\n\n'
  + '### Infrastructure Engineer — Initech (2019–2022)\n- Migrated 60 services to Terraform\n\n'
  + '## Skills\n\nKotlin · Kubernetes · Terraform · Go · AWS · Prometheus\n');

writeFileSync(join(target, 'modes', '_profile.md'), '# Demo profile\n\nSynthetic fixture for screenshots.\n');

console.log(`demo profile seeded at ${target}`);
console.log(`  ${jobs.length} scored roles · ${TRACKER.length} tracker rows · 4 scan runs · all synthetic`);
