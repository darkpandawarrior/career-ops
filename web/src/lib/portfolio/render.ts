import type { PortfolioData } from "./schema";
import { resolveTheme } from "./themes";

// HTML-escape every interpolated value. The data originates from an AI CLI, so it
// is treated as untrusted: no raw markup ever reaches the document.
function esc(s: string | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const href = (url: string | undefined): string => {
  const u = (url ?? "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return esc(u);
  if (/^[^@\s]+@[^@\s]+$/.test(u)) return `mailto:${esc(u)}`;
  return `https://${esc(u)}`;
};

/**
 * Render a PortfolioData object into a single self-contained, deployable HTML
 * document — no external network calls except the Google Fonts stylesheet (with a
 * system-font fallback). Themed (role/taste-neutral) + pure + deterministic →
 * unit-testable, and preview == export.
 */
export function renderPortfolio(d: PortfolioData): string {
  const t = resolveTheme(d.theme);
  const v = t.vars;
  const initial = esc(d.name.trim().charAt(0).toUpperCase() || "•");
  const metrics = (d.metrics ?? [])
    .map(
      (m) => `        <div class="metric">
          <div class="metric-value">${esc(m.value)}</div>
          <div class="metric-label">${esc(m.label)}</div>
          ${m.detail ? `<div class="metric-detail">${esc(m.detail)}</div>` : ""}
        </div>`,
    )
    .join("\n");

  const cases = (d.caseStudies ?? [])
    .map((c) => {
      const deep =
        c.problem || (c.approach ?? []).length || c.outcome
          ? `<details class="deep"><summary>Deep dive</summary>
            ${c.problem ? `<p class="dd-label">Problem</p><p>${esc(c.problem)}</p>` : ""}
            ${(c.approach ?? []).length ? `<p class="dd-label">Approach</p><ul>${(c.approach ?? []).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
            ${c.outcome ? `<p class="dd-label">Outcome</p><p>${esc(c.outcome)}</p>` : ""}
          </details>`
          : "";
      return `        <article class="card">
          ${c.metric ? `<div class="card-metric">${esc(c.metric)}</div>` : ""}
          <h3>${esc(c.title)}</h3>
          <p>${esc(c.summary)}</p>
          ${(c.tags ?? []).length ? `<div class="tags">${(c.tags ?? []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
          ${deep}
        </article>`;
    })
    .join("\n");

  const competencies = (d.competencies ?? []).length
    ? `<div class="competencies">${(d.competencies ?? []).map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>`
    : "";

  const exp = (d.experience ?? [])
    .map(
      (e) => `        <div class="job">
          <div class="job-head"><span class="job-role">${esc(e.role)}</span><span class="job-period">${esc(e.period)}</span></div>
          <div class="job-company">${esc(e.company)}</div>
          <ul>${e.points.map((p) => `<li>${p.label ? `<strong>${esc(p.label)}:</strong> ` : ""}${esc(p.text)}</li>`).join("")}</ul>
        </div>`,
    )
    .join("\n");

  const skills = (d.skills ?? [])
    .map(
      (s) => `        <div class="skill-group">
          <h4>${esc(s.group)}</h4>
          <ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
        </div>`,
    )
    .join("\n");

  const projects = (d.projects ?? [])
    .map(
      (p) => `        <article class="card">
          <h3>${esc(p.name)}</h3>
          <p>${esc(p.description)}</p>
          ${(p.tags ?? []).length ? `<div class="tags">${(p.tags ?? []).map((tg) => `<span class="tag">${esc(tg)}</span>`).join("")}</div>` : ""}
          ${p.link ? `<a class="card-link" href="${href(p.link)}" target="_blank" rel="noreferrer">View →</a>` : ""}
        </article>`,
    )
    .join("\n");

  const navLinks = [
    (d.caseStudies ?? []).length ? `<a href="#work">Work</a>` : "",
    (d.projects ?? []).length ? `<a href="#projects">Projects</a>` : "",
    (d.experience ?? []).length ? `<a href="#experience">Experience</a>` : "",
    (d.skills ?? []).length ? `<a href="#skills">Skills</a>` : "",
    `<a href="#contact">Contact</a>`,
  ]
    .filter(Boolean)
    .join("");

  const contactLinks = [
    d.email ? `<a href="${href(d.email)}">${esc(d.email)}</a>` : "",
    d.linkedin ? `<a href="${href(d.linkedin)}" target="_blank" rel="noreferrer">LinkedIn</a>` : "",
    d.github ? `<a href="${href(d.github)}" target="_blank" rel="noreferrer">GitHub</a>` : "",
    d.website ? `<a href="${href(d.website)}" target="_blank" rel="noreferrer">Website</a>` : "",
  ]
    .filter(Boolean)
    .join("");

  const eduLine = d.education && (d.education.school || d.education.degree)
    ? `${esc([d.education.degree, d.education.school].filter(Boolean).join(", "))}${d.education.period ? " · " + esc(d.education.period) : ""}`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(d.name)}${d.title ? " — " + esc(d.title) : ""}</title>
<meta name="description" content="${esc(d.tagline || d.intro || d.title)}" />
${t.googleFonts ? `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=${t.googleFonts}&display=swap" rel="stylesheet" />` : ""}
<style>
  :root{ --bg:${v.bg}; --surface:${v.surface}; --border:${v.border}; --fg:${v.fg}; --muted:${v.muted}; --faint:${v.faint}; --accent:${v.accent}; --accent-soft:${v.accentSoft}; --accent-fg:${v.accentFg}; --font-display:${t.fontDisplay}; }
  *{ box-sizing:border-box; margin:0; padding:0; }
  html{ scroll-behavior:smooth; }
  body{ background:var(--bg); color:var(--fg); font-family:${t.fontBody}; line-height:1.6; -webkit-font-smoothing:antialiased; }
  a{ color:inherit; text-decoration:none; }
  .wrap{ max-width:1040px; margin:0 auto; padding:0 24px; }
  h1,h2,h3,h4,.display{ font-family:${t.fontDisplay}; letter-spacing:-.01em; }
  /* nav */
  nav{ position:sticky; top:0; z-index:10; backdrop-filter:blur(12px); background:color-mix(in srgb, var(--bg) 78%, transparent); border-bottom:1px solid var(--border); }
  nav .wrap{ display:flex; align-items:center; gap:24px; height:60px; }
  .brand{ display:flex; align-items:center; gap:10px; font-family:${t.fontDisplay}; font-weight:700; }
  .brand .mark{ width:30px; height:30px; border-radius:8px; background:var(--accent-soft); color:var(--accent); display:grid; place-items:center; font-weight:700; }
  nav .links{ margin-left:auto; display:flex; gap:22px; font-size:14px; color:var(--muted); }
  nav .links a:hover{ color:var(--fg); }
  /* hero */
  header{ padding:88px 0 56px; }
  .eyebrow{ color:var(--accent); font-size:13px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; }
  header h1{ font-size:clamp(34px,6vw,60px); font-weight:700; line-height:1.05; margin:14px 0 18px; max-width:18ch; }
  header h1 .accent{ color:var(--accent); }
  .lede{ color:var(--muted); font-size:18px; max-width:62ch; }
  .cta-row{ display:flex; flex-wrap:wrap; gap:12px; margin-top:28px; }
  .btn{ display:inline-flex; align-items:center; gap:8px; padding:11px 18px; border-radius:999px; font-weight:600; font-size:14px; }
  .btn.primary{ background:var(--accent); color:var(--accent-fg); }
  .btn.ghost{ border:1px solid var(--border); color:var(--fg); }
  .btn:hover{ opacity:.9; }
  /* metrics */
  .metrics{ display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:14px; margin-top:44px; }
  .metric{ border:1px solid var(--border); background:var(--surface); border-radius:14px; padding:18px; }
  .metric-value{ font-family:var(--font-display); font-size:30px; font-weight:700; color:var(--accent); }
  .metric-label{ font-weight:600; margin-top:4px; }
  .metric-detail{ color:var(--faint); font-size:13px; margin-top:4px; }
  /* sections */
  section{ padding:56px 0; border-top:1px solid var(--border); }
  .section-title{ font-size:13px; text-transform:uppercase; letter-spacing:.12em; color:var(--faint); margin-bottom:26px; }
  .cards{ display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px; }
  .card{ border:1px solid var(--border); background:var(--surface); border-radius:16px; padding:22px; }
  .card h3{ font-size:18px; margin-bottom:8px; }
  .card p{ color:var(--muted); font-size:15px; }
  .card-metric{ display:inline-block; font-family:var(--font-display); font-weight:700; font-size:13px; color:var(--accent); background:var(--accent-soft); border-radius:6px; padding:3px 10px; margin-bottom:10px; }
  .tags{ display:flex; flex-wrap:wrap; gap:6px; margin-top:14px; }
  .tag{ font-size:12px; color:var(--accent); background:var(--accent-soft); border-radius:6px; padding:3px 9px; }
  .card-link{ display:inline-block; margin-top:12px; color:var(--accent); font-size:14px; font-weight:600; }
  .edu{ margin-top:18px; color:var(--faint); font-size:14px; }
  .deep{ margin-top:14px; border-top:1px solid var(--border); padding-top:12px; }
  .deep summary{ cursor:pointer; color:var(--accent); font-size:13px; font-weight:600; list-style:none; }
  .deep summary::-webkit-details-marker{ display:none; }
  .deep[open] summary{ margin-bottom:10px; }
  .dd-label{ color:var(--faint); font-size:11px; text-transform:uppercase; letter-spacing:.1em; margin:12px 0 4px; }
  .deep ul{ list-style:none; display:grid; gap:6px; }
  .deep li{ color:var(--muted); font-size:14px; padding-left:16px; position:relative; }
  .deep li::before{ content:""; position:absolute; left:0; top:8px; width:5px; height:5px; border-radius:50%; background:var(--accent); }
  .competencies{ display:flex; flex-wrap:wrap; gap:8px; margin-top:28px; }
  .chip{ font-size:13px; color:var(--muted); border:1px solid var(--border); border-radius:999px; padding:5px 13px; }
  /* experience */
  .job{ padding:22px 0; border-top:1px solid var(--border); }
  .job:first-child{ border-top:0; padding-top:0; }
  .job-head{ display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .job-role{ font-family:var(--font-display); font-weight:600; font-size:17px; }
  .job-period{ color:var(--faint); font-size:14px; }
  .job-company{ color:var(--accent); font-size:14px; margin:2px 0 12px; }
  .job ul{ list-style:none; display:grid; gap:8px; }
  .job li{ color:var(--muted); font-size:15px; padding-left:18px; position:relative; }
  .job li::before{ content:""; position:absolute; left:0; top:9px; width:6px; height:6px; border-radius:50%; background:var(--accent); }
  .job li strong{ color:var(--fg); font-weight:600; }
  /* skills */
  .skills-grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:20px; }
  .skill-group h4{ font-size:14px; color:var(--accent); margin-bottom:10px; }
  .skill-group ul{ list-style:none; display:grid; gap:6px; }
  .skill-group li{ color:var(--muted); font-size:14px; }
  /* contact */
  #contact{ text-align:center; }
  #contact h2{ font-size:clamp(26px,4vw,38px); }
  #contact p{ color:var(--muted); margin:12px auto 22px; max-width:48ch; }
  .contact-links{ display:flex; gap:18px; justify-content:center; flex-wrap:wrap; }
  .contact-links a{ color:var(--accent); font-weight:600; }
  footer{ padding:28px 0; color:var(--faint); font-size:13px; text-align:center; border-top:1px solid var(--border); }
  @media (max-width:640px){ nav .links{ display:none; } header{ padding:56px 0 40px; } }
</style>
</head>
<body>
<nav><div class="wrap">
  <a class="brand" href="#"><span class="mark">${initial}</span>${esc(d.name)}</a>
  <div class="links">${navLinks}</div>
</div></nav>

<header><div class="wrap">
  ${d.title ? `<div class="eyebrow">${esc(d.title)}</div>` : ""}
  <h1>${esc(d.tagline || d.name)}</h1>
  ${d.intro ? `<p class="lede">${esc(d.intro)}</p>` : ""}
  <div class="cta-row">
    ${d.email ? `<a class="btn primary" href="${href(d.email)}">Get in touch</a>` : ""}
    ${d.linkedin ? `<a class="btn ghost" href="${href(d.linkedin)}" target="_blank" rel="noreferrer">LinkedIn</a>` : ""}
    ${d.github ? `<a class="btn ghost" href="${href(d.github)}" target="_blank" rel="noreferrer">GitHub</a>` : ""}
  </div>
  ${metrics ? `<div class="metrics">\n${metrics}\n  </div>` : ""}
  ${competencies}
</div></header>

${
  cases
    ? `<section id="work"><div class="wrap">
  <div class="section-title">Selected work</div>
  <div class="cards">
${cases}
  </div>
</div></section>`
    : ""
}

${
  projects
    ? `<section id="projects"><div class="wrap">
  <div class="section-title">Projects</div>
  <div class="cards">
${projects}
  </div>
</div></section>`
    : ""
}

${
  exp
    ? `<section id="experience"><div class="wrap">
  <div class="section-title">Experience</div>
${exp}
${eduLine ? `  <div class="edu">${eduLine}</div>` : ""}
</div></section>`
    : ""
}

${
  skills
    ? `<section id="skills"><div class="wrap">
  <div class="section-title">Skills</div>
  <div class="skills-grid">
${skills}
  </div>
</div></section>`
    : ""
}

<section id="contact"><div class="wrap">
  <h2>${esc(d.availability ? "Let's talk" : "Get in touch")}</h2>
  ${d.availability ? `<p>${esc(d.availability)}</p>` : `<p>Open to new opportunities.</p>`}
  <div class="contact-links">${contactLinks}</div>
</div></section>

<footer><div class="wrap">${esc(d.name)}${d.location ? " · " + esc(d.location) : ""} · built with career-ops</div></footer>
</body>
</html>
`;
}
