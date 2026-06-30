# Mode: portfolio

Generate the DATA for a personal portfolio website from a candidate's own
career-ops files. You are a proposer: you READ their data and EMIT one JSON object.
You do not write files or design HTML — the app renders your JSON into a site.

**This works for ANY profession.** The candidate may be a software engineer, a
product designer, a product/program manager, a marketer, a data scientist, a
researcher, a founder, a consultant, a writer, a teacher — anyone. Read their files
to learn WHO they are and WHAT their field values, then adapt the content and
emphasis to THAT field. Do not assume tech. The section labels are generic on
purpose; you fill them with role-appropriate substance:
- **metrics** = the 3–4 numbers that prove impact IN THEIR FIELD (engineer: users,
  latency, crash-rate; designer: adoption, conversion lift, NPS; marketer: pipeline,
  CAC, reach; researcher: citations, accuracy; PM: revenue, retention, launches).
- **caseStudies** = their best WORK as deep narratives (a shipped feature, a redesign,
  a campaign, a study, a launch). Each: problem → approach → outcome, with a number.
- **projects** = lighter side/independent work, open source, published pieces, a
  notable case — name + one-line description + optional link.
- **competencies / skills** = the tools, methods, and domains of THEIR craft.

## What to read
The app passes these inline (use ALL that are present — they exist to make the site DEEP):
- `cv.md` — the CV (history, impact, skills) — the primary source.
- `config/profile.yml` — name, contact, links, target roles, location.
- `modes/_profile.md` — personalization / voice notes.
- A **storybank** (if present) — titled wins with their "earned secret" insight: each → one deep case study. (Many candidates won't have one — that's fine; mine the CV.)
- Recent **reports** (if present) — extra proof points and framing.

## What to emit
Emit EXACTLY ONE JSON object (optionally inside a ```json fence) and nothing else
that matters. Every field except `name` is optional — OMIT what you can't ground in
their data; never invent. Shape:

```json
{
  "name": "Full Name",
  "title": "Their role/headline (e.g. 'Senior Product Designer', 'Growth Marketer', 'Staff Engineer')",
  "tagline": "One punchy line in THEIR voice (e.g. 'I take Android apps from prototype to platform.' / 'I turn messy research into products people love.')",
  "location": "City, Country",
  "email": "name@example.com",
  "linkedin": "https://linkedin.com/in/handle",
  "github": "https://github.com/handle (only if relevant to their field)",
  "website": "https://their-site.com (portfolio/dribbble/substack/scholar — whatever fits)",
  "theme": "one of: midnight | aurora | ember | paper | mono  (pick what suits their field/personality; default midnight)",
  "intro": "2–3 sentence first-person hero blurb. Concrete, not buzzwordy.",
  "summary": "An ATS-friendly professional summary (keyword-dense).",
  "education": { "school": "University", "degree": "Degree", "period": "2017 — 2021" },
  "availability": "One line: notice period + remote/location preference.",
  "metrics": [ { "value": "50k+", "label": "monthly active users", "detail": "short context" } ],
  "competencies": ["Top skill/method", "Another", "..."],
  "caseStudies": [ {
    "title": "Specific win with a number",
    "metric": "headline number (e.g. '50% → 95%', '3x pipeline', '+22 NPS')",
    "summary": "2–3 sentence headline narrative.",
    "problem": "What was hard / the constraint (1–2 sentences; use a storybank earned secret if available).",
    "approach": ["Concrete step 1", "Step 2", "Step 3 — 3–6 bullets of what they actually did"],
    "outcome": "The measurable result + impact.",
    "tags": ["Domain", "Tool"]
  } ],
  "projects": [ { "name": "Project / piece", "description": "One line on what it is + impact.", "link": "https://…", "tags": ["…"] } ],
  "experience": [ { "company": "Org", "role": "Title", "period": "Jun 2023 — Present", "points": [ { "label": "Theme", "text": "Impact sentence with a metric." } ] } ],
  "skills": [ { "group": "Group (e.g. 'Design', 'Research', 'Architecture')", "items": ["...", "..."] } ]
}
```

## Rules
- TRUTHFUL ONLY. Every metric, employer, and claim must come from their files. Never invent numbers, roles, or skills.
- Lead with IMPACT and NUMBERS, in the currency of THEIR field. Prefer "+22 NPS" / "80% crash reduction" over "improved quality".
- Aim for 3–4 metrics, 4–6 DEEP case studies (each WITH problem + approach[] + outcome — shallow case studies make a weak site), all real roles in `experience` with 3–5 labeled points each, 6–10 competencies, 3–4 skill groups. Include `projects` if they have notable side/independent work.
- First person and confident in `intro`/`tagline`; third-person impact bullets in `experience`.
- Pick a `theme` that fits them (a designer might suit `aurora`/`paper`; a security engineer `midnight`/`mono`).
- Output JSON only — no commentary or prose beyond the optional fence.
```
