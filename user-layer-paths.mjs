// The USER layer: paths a candidate fills with their own personal data.
//
// Upstream keeps this list inside update-system.mjs, because there it also
// drives what the self-updater must never overwrite. This fork does not carry
// update-system.mjs — it takes upstream by explicit sync, not by self-update —
// so the list lives on its own here rather than dragging in a self-update
// mechanism to reach one constant.
//
// The authority is DATA_CONTRACT.md's User Layer table; this is its executable
// form. Adding a personal path means editing BOTH, in the same change, plus
// .gitignore (see the root CLAUDE.md rule). Directory entries keep their
// trailing slash — consumers match them as prefixes.
//
// Consumers must only ever use this to EXEMPT a path from system-layer tooling.
// Nothing here may be validated, rewritten or shipped by an update.
export const USER_PATHS = [
  'cv.md',
  'config/profile.yml',
  'config/cv-facts.json',
  'modes/_profile.md',
  'modes/_custom.md',
  'modes/_brief.md',
  'voice-dna.md',
  'portals.yml',
  'article-digest.md',
  'interview-prep/',
  'data/',
  'documents/',
  'reports/',
  'output/',
  'jds/',
  'writing-samples/',
  'config/plugins.yml',
  'plugins.local/',
  'plugins.lock',
  'opencode.json',
  '.claude/settings.json',
  '.claude/hooks/',
  // Fork-only, per DATA_CONTRACT.md: the multi-profile registry and the
  // dashboard's derived index (which holds dashboard credentials and live
  // session tokens).
  'profiles.json',
  'profiles.yml',
  'index.db',
];
