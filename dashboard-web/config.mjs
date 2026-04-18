import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import yaml from 'js-yaml';

export const USER_FILES = Object.freeze({
  cv: 'cv.md',
  profile: 'config/profile.yml',
  jobSearch: 'config/job-search.yml',
  profileNarrative: 'modes/_profile.md',
  portals: 'portals.yml',
});

export function userFilePaths(root) {
  return Object.fromEntries(
    Object.entries(USER_FILES).map(([key, relative]) => [key, path.join(root, ...relative.split('/'))]),
  );
}

export async function readYamlIfPresent(file) {
  if (!existsSync(file)) return {};
  const value = yaml.load(await readFile(file, 'utf8'));
  return value && typeof value === 'object' ? value : {};
}

export async function getSetupStatus(root) {
  const files = userFilePaths(root);
  const present = Object.fromEntries(
    Object.entries(files).map(([key, file]) => [key, existsSync(file)]),
  );
  const required = ['cv', 'profile', 'jobSearch', 'profileNarrative', 'portals'];
  const missing = required.filter((key) => !present[key]).map((key) => USER_FILES[key]);
  return {
    ready: missing.length === 0,
    hasActiveProfile: present.cv && present.profile,
    present,
    missing,
  };
}

export async function loadActiveProfile(root) {
  const files = userFilePaths(root);
  const [profile, jobSearch] = await Promise.all([
    readYamlIfPresent(files.profile),
    readYamlIfPresent(files.jobSearch),
  ]);
  const candidate = profile.candidate || {};
  return {
    name: candidate.full_name || 'Candidate',
    headline: profile.narrative?.headline || '',
    location: candidate.location || profile.location?.city || '',
    roles: profile.target_roles?.primary || jobSearch.titles?.strong || [],
  };
}

export async function loadJobSearchConfig(root) {
  const files = userFilePaths(root);
  return readYamlIfPresent(files.jobSearch);
}
