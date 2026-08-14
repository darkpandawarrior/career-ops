#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'fs';

const forbiddenTrackedPaths = [
  /^cv\.md$/i,
  /^config\/profile\.yml$/i,
  /^config\/job-search\.yml$/i,
  /^modes\/_profile\.md$/i,
  /^portals\.yml$/i,
  /^voice-dna\.md$/i,   // the TEMPLATE is tracked; the working copy never is

  /^\.env$/i,
  /^data\/(?!.*\.gitkeep$)/i,
  /^reports\/(?!.*\.gitkeep$)/i,
  /^output\/(?!.*\.gitkeep$)/i,
  /^jds\/(?!.*\.gitkeep$)/i,
];

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
  .map((file) => file.replaceAll('\\', '/'));

const violations = tracked.filter((file) => forbiddenTrackedPaths.some((pattern) => pattern.test(file)));

if (violations.length > 0) {
  console.error('Private user-layer files are tracked:');
  violations.forEach((file) => console.error(`- ${file}`));
  process.exit(1);
}

console.log(`Privacy audit passed: ${tracked.length} tracked files checked.`);
