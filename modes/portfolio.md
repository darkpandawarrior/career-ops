# Mode: portfolio

Generate the DATA for a personal portfolio website from the candidate's own
career-ops files. You are a proposer: you READ their data and EMIT one JSON object.
You do not write files or design HTML — the app renders your JSON into a site.

## What to read
- `cv.md` — the candidate's CV (source of truth for experience, impact, skills).
- `config/profile.yml` — name, contact, links, target roles, location.
The app also passes these inline in the prompt; use whichever is present.

## What to emit
Emit EXACTLY ONE JSON object (optionally inside a ```json fence) and nothing else
that matters. Shape:

```json
{
  "name": "Full Name",
  "title": "Senior X Engineer",
  "tagline": "One punchy line — what you do, in their voice (e.g. 'I take Android apps from prototype to platform.')",
  "location": "City, Country",
  "email": "name@example.com",
  "github": "https://github.com/handle",
  "linkedin": "https://linkedin.com/in/handle",
  "intro": "2–3 sentence first-person blurb for the hero. Concrete, not buzzwordy.",
  "availability": "One line: notice period + remote/location preference.",
  "metrics": [ { "value": "50k+", "label": "monthly active users", "detail": "short context" } ],
  "competencies": ["Top skill", "Another", "..."],
  "caseStudies": [ { "title": "Specific win with a number", "blurb": "2–3 sentences: problem → what you did → measurable result.", "tags": ["Tech","Tech"] } ],
  "experience": [ { "company": "Co", "role": "Title", "period": "Jun 2023 — Present", "points": [ { "label": "Theme", "text": "Impact sentence with a metric." } ] } ],
  "skills": [ { "group": "Architecture", "items": ["...", "..."] } ]
}
```

## Rules
- TRUTHFUL ONLY. Every metric, company, and claim must come from their files. Never invent numbers, employers, or skills.
- Lead with IMPACT and NUMBERS. Prefer "80% crash reduction" over "improved stability".
- 3–4 metrics, 3–5 case studies, all real roles in `experience`, 3–4 skill groups. Keep blurbs tight (2–3 sentences).
- First person and confident in `intro`/`tagline`; third-person impact bullets in `experience`.
- If a field is unknown, omit it (don't fabricate). `name` is required.
- Output JSON only — no commentary, no markdown prose around it beyond the optional fence.
