# Mode: portfolio

Generate the DATA for a personal portfolio website from the candidate's own
career-ops files. You are a proposer: you READ their data and EMIT one JSON object.
You do not write files or design HTML — the app renders your JSON into a site.

## What to read
The app passes these inline (use ALL of them — they exist to make the site DEEP):
- `cv.md` — the CV (experience, impact, skills).
- `config/profile.yml` — name, contact, links, target roles, location.
- `modes/_profile.md` — personalization / voice notes.
- The interview **storybank** — titled wins with their "earned secret" insight. These are your richest case-study material: each story → one deep case study.
- Recent evaluation **reports** — extra proof points and framing.

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
  "caseStudies": [ {
    "title": "Specific win with a number",
    "metric": "headline number (e.g. 'GPS 50% → 95%')",
    "summary": "2–3 sentence headline narrative.",
    "problem": "What was hard / the constraint (1–2 sentences — use the storybank's earned secret).",
    "approach": ["Concrete step 1", "Step 2", "Step 3 — 3–6 bullets of what you actually did"],
    "outcome": "The measurable result + impact.",
    "tags": ["Tech","Tech"]
  } ],
  "experience": [ { "company": "Co", "role": "Title", "period": "Jun 2023 — Present", "points": [ { "label": "Theme", "text": "Impact sentence with a metric." } ] } ],
  "skills": [ { "group": "Architecture", "items": ["...", "..."] } ]
}
```

## Rules
- TRUTHFUL ONLY. Every metric, company, and claim must come from their files. Never invent numbers, employers, or skills.
- Lead with IMPACT and NUMBERS. Prefer "80% crash reduction" over "improved stability".
- 3–4 metrics, 4–6 DEEP case studies (each WITH problem + approach[] + outcome — this is what makes the site impressive; don't leave them shallow), all real roles in `experience` with 3–5 labeled points each, 6–10 competencies, 3–4 skill groups.
- First person and confident in `intro`/`tagline`; third-person impact bullets in `experience`.
- If a field is unknown, omit it (don't fabricate). `name` is required.
- Output JSON only — no commentary, no markdown prose around it beyond the optional fence.
