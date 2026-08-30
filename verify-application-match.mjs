#!/usr/bin/env node

/**
 * verify-application-match.mjs — Pre-submit gate: is this draft actually FOR
 * this company and role?
 *
 * verify-cv-facts.mjs checks whether claims in a draft are true. This checks
 * a different failure class: the right generation pipeline producing the
 * wrong output — a leaked {{TEMPLATE_TOKEN}}, a cover letter still addressed
 * to the last company, or a role title that never appears anywhere in the
 * text. All of this is plain string matching against the rendered output, so
 * it needs no LLM call and no new dependency.
 *
 * Usage:
 *   node verify-application-match.mjs <rendered-file> --company "Acme Inc" --role "Senior Android Engineer"
 *
 * Both --company and --role are optional; whichever is omitted isn't checked.
 * Exit 0 = clean, exit 1 = mismatch found.
 */

import { existsSync, readFileSync } from 'fs';
import { isMainModule } from './lib/is-main-module.mjs';
import { isAbsolute, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { roleTokens } from './role-matcher.mjs';

const TOKEN_LEAK = /\{\{[A-Z_]+\}\}/g;

const PLACEHOLDER_PHRASES = [
  '[company name]',
  '[hiring manager]',
  '[insert company]',
  '[insert role]',
  '[role title]',
  '[your name]',
  'lorem ipsum',
  'to whom it may concern',
];

function stripMarkup(text) {
  return text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// Checked against the raw text (not stripped) — a leaked token can sit
// inside an HTML attribute just as easily as in visible text.
export function findLeakedTokens(text) {
  return [...new Set(String(text).match(TOKEN_LEAK) || [])];
}

export function findPlaceholderPhrases(text) {
  const lower = String(text).toLowerCase();
  return PLACEHOLDER_PHRASES.filter(p => lower.includes(p));
}

export function checkCompanyMention(text, company) {
  if (!company) return true; // not checked
  return String(text).toLowerCase().includes(String(company).toLowerCase());
}

// Reuses role-matcher.mjs's tokenizer so "Senior Android Engineer" is
// satisfied by "android" or "engineer" appearing anywhere in the draft,
// rather than requiring the exact title string verbatim. A title made up
// entirely of stopwords (e.g. "Senior Lead") yields no discriminating
// tokens — nothing to check, so it passes rather than false-failing.
export function checkRoleMention(text, role) {
  if (!role) return true;
  const tokens = roleTokens(role);
  if (tokens.length === 0) return true;
  const lower = String(text).toLowerCase();
  return tokens.some(t => lower.includes(t));
}

export function verifyDraft(rawText, { company, role } = {}) {
  const clean = stripMarkup(String(rawText));
  const issues = [];

  const leaked = findLeakedTokens(rawText);
  if (leaked.length) issues.push(`leaked template token(s): ${leaked.join(', ')}`);

  const placeholders = findPlaceholderPhrases(clean);
  if (placeholders.length) issues.push(`placeholder text left in: ${placeholders.join(', ')}`);

  if (!checkCompanyMention(clean, company)) {
    issues.push(`company "${company}" is never mentioned in the draft`);
  }
  if (!checkRoleMention(clean, role)) {
    issues.push(`role "${role}" (or any distinguishing word from it) is never mentioned in the draft`);
  }

  return { clean: issues.length === 0, issues };
}

// ── CLI ──────────────────────────────────────────────────────────────

function resolveInputPath(path) {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}

function main() {
  const args = process.argv.slice(2);
  let targetArg = '';
  let company = null;
  let role = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--company') {
      if (!args[i + 1]) { console.error('ERROR: --company requires a value'); process.exit(1); }
      company = args[++i];
    } else if (arg === '--role') {
      if (!args[i + 1]) { console.error('ERROR: --role requires a value'); process.exit(1); }
      role = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      // handled by usage block below
    } else if (arg.startsWith('--')) {
      console.error(`ERROR: unknown option: ${arg}`);
      process.exit(1);
    } else if (!targetArg) {
      targetArg = arg;
    } else {
      console.error(`ERROR: unexpected extra positional argument: ${arg}`);
      process.exit(1);
    }
  }

  if (!targetArg || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node verify-application-match.mjs <rendered-file> --company "Acme Inc" --role "Senior Android Engineer"

Checks a rendered CV/cover-letter draft actually mentions the target company
and role, and has no leaked {{TEMPLATE}} tokens or placeholder text left in.
Both --company and --role are optional; whichever is omitted isn't checked.`);
    process.exit(targetArg ? 0 : 1);
  }

  const targetPath = resolveInputPath(targetArg);
  if (!existsSync(targetPath)) {
    console.error(`ERROR: target file not found: ${targetArg}`);
    process.exit(1);
  }

  const rawText = readFileSync(targetPath, 'utf-8');
  const { clean, issues } = verifyDraft(rawText, { company, role });

  if (clean) {
    console.log(`Application draft match check passed: ${targetArg}`);
    process.exit(0);
  }

  console.error(`Application draft match check failed: ${targetArg}`);
  for (const issue of issues) console.error(`  - ${issue}`);
  console.error('\nFix the draft, or omit --company/--role if this check doesn\'t apply here.');
  process.exit(1);
}

const isMain = isMainModule(import.meta.url);
if (isMain) main();
