import type { PortfolioData } from "./schema";

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
 * system-font fallback). Dark theme, Android-green accent, matching the proven
 * cv-siddharth design. Pure + deterministic → unit-testable and preview==export.
 */
export function renderPortfolio(d: PortfolioData): string {
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
    .map(
      (c) => `        <article class="card">
          <h3>${esc(c.title)}</h3>
          <p>${esc(c.blurb)}</p>
          ${(c.tags ?? []).length ? `<div class="tags">${(c.tags ?? []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
        </article>`,
    )
    .join("\n");

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

  const navLinks = [
    (d.caseStudies ?? []).length ? `<a href="#work">Work</a>` : "",
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
  ]
    .filter(Boolean)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(d.name)}${d.title ? " — " + esc(d.title) : ""}</title>
<meta name="description" content="${esc(d.tagline || d.intro || d.title)}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
  :root{ --bg:#0b0f0d; --panel:#11161300; --surface:#141a17; --border:#1f2a24; --fg:#e8efe9; --muted:#9fb0a6; --faint:#6b7d72; --accent:#3ddc84; --accent-soft:rgba(61,220,132,.12); }
  *{ box-sizing:border-box; margin:0; padding:0; }
  html{ scroll-behavior:smooth; }
  body{ background:var(--bg); color:var(--fg); font-family:"Inter",system-ui,-apple-system,sans-serif; line-height:1.6; -webkit-font-smoothing:antialiased; }
  a{ color:inherit; text-decoration:none; }
  .wrap{ max-width:1040px; margin:0 auto; padding:0 24px; }
  h1,h2,h3,h4,.display{ font-family:"Space Grotesk","Inter",sans-serif; letter-spacing:-.01em; }
  /* nav */
  nav{ position:sticky; top:0; z-index:10; backdrop-filter:blur(12px); background:rgba(11,15,13,.72); border-bottom:1px solid var(--border); }
  nav .wrap{ display:flex; align-items:center; gap:24px; height:60px; }
  .brand{ display:flex; align-items:center; gap:10px; font-family:"Space Grotesk"; font-weight:700; }
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
  .btn.primary{ background:var(--accent); color:#06140c; }
  .btn.ghost{ border:1px solid var(--border); color:var(--fg); }
  .btn:hover{ opacity:.9; }
  /* metrics */
  .metrics{ display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:14px; margin-top:44px; }
  .metric{ border:1px solid var(--border); background:var(--surface); border-radius:14px; padding:18px; }
  .metric-value{ font-family:"Space Grotesk"; font-size:30px; font-weight:700; color:var(--accent); }
  .metric-label{ font-weight:600; margin-top:4px; }
  .metric-detail{ color:var(--faint); font-size:13px; margin-top:4px; }
  /* sections */
  section{ padding:56px 0; border-top:1px solid var(--border); }
  .section-title{ font-size:13px; text-transform:uppercase; letter-spacing:.12em; color:var(--faint); margin-bottom:26px; }
  .cards{ display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px; }
  .card{ border:1px solid var(--border); background:var(--surface); border-radius:16px; padding:22px; }
  .card h3{ font-size:18px; margin-bottom:8px; }
  .card p{ color:var(--muted); font-size:15px; }
  .tags{ display:flex; flex-wrap:wrap; gap:6px; margin-top:14px; }
  .tag{ font-size:12px; color:var(--accent); background:var(--accent-soft); border-radius:6px; padding:3px 9px; }
  /* experience */
  .job{ padding:22px 0; border-top:1px solid var(--border); }
  .job:first-child{ border-top:0; padding-top:0; }
  .job-head{ display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .job-role{ font-family:"Space Grotesk"; font-weight:600; font-size:17px; }
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
  exp
    ? `<section id="experience"><div class="wrap">
  <div class="section-title">Experience</div>
${exp}
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
