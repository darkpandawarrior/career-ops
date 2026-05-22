# Public Dashboard Scoring

The dashboard score is generated entirely from `config/job-search.yml`.
Profession-specific terms do not live in JavaScript.

## Signals

Default weights:

| Signal | Weight |
|---|---:|
| Core skills | 60 |
| Experience | 25 |
| Joining availability | 15 |

These three signals form the complete 100-point relevance score.
Titles, employer names, summary wording, education, projects, industries,
domains, and company preferences do not contribute to discovery or ranking.

Eligibility is evaluated separately. An eligible local, remote, or
international job keeps its full relevance score. Explicit ineligibility is a
gate, while unclear eligibility is retained for review.

## Joining availability

The candidate's reviewed notice period is compared with explicit joining
requirements in the posting. Immediate-joiner and stated joining-window
requirements receive compatibility scoring. Immediate availability is
compatible with every joining window. Longer notice periods rank relaxed
joining windows above urgent requirements. When a posting gives no joining
timeline, availability receives neutral full credit instead of lowering an
otherwise relevant match.

## Title behavior

- Strong titles receive full title credit.
- Adjacent titles receive partial credit.
- Generic titles can still rank well through verified skill matches.
- Excluded titles cap the final score.

## Skill behavior

Demonstrated and user-confirmed skills receive full credit. Supporting skills
receive partial credit. Learning and recommended-gap skills receive no full
credit. Excluded skills create a gate.

When a posting mentions a configured recommended gap, the card shows it
explicitly. The system does not add the skill to the resume.

## Eligibility and compensation

The word `remote` is not sufficient proof of eligibility. Global, home-country,
or configured regional language is required for an open classification.
Country-only restrictions create a gate.

For international roles, eligible remote work receives the strongest location
signal. Onsite roles with explicit visa or relocation support remain strong but
rank below eligible remote roles. If sponsorship is required and the posting
requires existing work authorization or explicitly refuses sponsorship, the
job is blocked.

Compensation is gated only when a comparable configured minimum and listed
salary are available. Missing or different-currency compensation is marked for
review instead of being silently rejected.

## Search plan

`GET /api/search-plan` returns generated searches for:

- Strong target titles
- Adjacent titles
- Verified-skill rescue searches

The same plan also exposes career-ops-compatible title, content, location, and
search-query configuration for later persistence into `portals.yml`.
