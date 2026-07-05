// Portfolio themes — a named palette + type pairing. Role- and taste-neutral so the
// same generated content works for an engineer, a designer, a PM, a marketer, etc.
// The renderer injects these as CSS custom properties; the data carries the chosen
// theme key. Adding a theme here makes it available everywhere (renderer + picker).
// These are candidate-facing tokens for the GENERATED portfolio site, deliberately
// separate from the dashboard's own web/src/app/globals.css tokens — not a duplicate,
// the two audiences (a recruiter viewing the site vs. the candidate using the dashboard)
// are allowed to look different and evolve independently.

export type Theme = {
  key: string;
  label: string;
  vars: {
    bg: string;
    surface: string;
    border: string;
    fg: string;
    muted: string;
    faint: string;
    accent: string;
    accentSoft: string;
    accentFg: string; // text color on an accent-filled button
  };
  fontDisplay: string;
  fontBody: string;
  // Google Fonts families to request (empty = system fonts only, fully offline).
  googleFonts?: string;
};

export const THEMES: Record<string, Theme> = {
  midnight: {
    key: "midnight",
    label: "Midnight",
    vars: { bg: "#0b0f0d", surface: "#141a17", border: "#1f2a24", fg: "#e8efe9", muted: "#9fb0a6", faint: "#6b7d72", accent: "#3ddc84", accentSoft: "rgba(61,220,132,.12)", accentFg: "#06140c" },
    fontDisplay: '"Space Grotesk", "Inter", sans-serif',
    fontBody: '"Inter", system-ui, -apple-system, sans-serif',
    googleFonts: "Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600",
  },
  aurora: {
    key: "aurora",
    label: "Aurora",
    vars: { bg: "#0c0e1a", surface: "#161a2e", border: "#262c45", fg: "#eceefb", muted: "#a4a9c8", faint: "#6f7494", accent: "#8b7cff", accentSoft: "rgba(139,124,255,.14)", accentFg: "#0c0817" },
    fontDisplay: '"Space Grotesk", "Inter", sans-serif',
    fontBody: '"Inter", system-ui, sans-serif',
    googleFonts: "Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600",
  },
  ember: {
    key: "ember",
    label: "Ember",
    vars: { bg: "#120e0c", surface: "#1e1814", border: "#2e2620", fg: "#f3ebe5", muted: "#c0ab9d", faint: "#83705f", accent: "#f5793b", accentSoft: "rgba(245,121,59,.14)", accentFg: "#1a0d05" },
    fontDisplay: '"Space Grotesk", "Inter", sans-serif',
    fontBody: '"Inter", system-ui, sans-serif',
    googleFonts: "Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600",
  },
  paper: {
    key: "paper",
    label: "Paper (light)",
    vars: { bg: "#f7f6f3", surface: "#ffffff", border: "#e6e3dc", fg: "#1a1a17", muted: "#5c5b53", faint: "#8c8a80", accent: "#0f766e", accentSoft: "rgba(15,118,110,.1)", accentFg: "#ffffff" },
    fontDisplay: '"Space Grotesk", "Inter", sans-serif',
    fontBody: '"Inter", system-ui, sans-serif',
    googleFonts: "Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600",
  },
  mono: {
    key: "mono",
    label: "Mono (minimal)",
    vars: { bg: "#0a0a0a", surface: "#151515", border: "#262626", fg: "#fafafa", muted: "#a3a3a3", faint: "#6b6b6b", accent: "#fafafa", accentSoft: "rgba(250,250,250,.1)", accentFg: "#0a0a0a" },
    fontDisplay: '"Inter", system-ui, sans-serif',
    fontBody: '"Inter", system-ui, sans-serif',
    googleFonts: "Inter:wght@400;500;600;700",
  },
};

export const DEFAULT_THEME = "midnight";

export function resolveTheme(key: string | undefined): Theme {
  return (key && THEMES[key]) || THEMES[DEFAULT_THEME];
}

/** [{key,label}] for a picker UI. */
export function themeOptions(): { key: string; label: string }[] {
  return Object.values(THEMES).map((t) => ({ key: t.key, label: t.label }));
}
