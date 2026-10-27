#!/usr/bin/env node

/**
 * migrate-profile.mjs — Migrate a legacy single-profile install into a named
 * profile under `profiles/<slug>/`, and register it in `profiles.yml`.
 *
 * ## Background
 *
 * A legacy ("single-profile") install keeps all of a candidate's data directly
 * at the engine / data root (cv.md, config/, data/, reports/, …). Multi-profile
 * support introduces a `profiles.yml` registry that maps a slug → a data root
 * (relative to the engine root), so one checkout can host several candidates:
 *
 *   profiles:
 *     - name: alex
 *       display_name: Alex Doe
 *       root: profiles/alex        # relative to the data root
 *       color: "#0284c7"
 *
 * This tool copies (default) or moves a single-profile install's USER-LAYER
 * data (see DATA_CONTRACT.md) into `profiles/<slug>/`, preserving structure,
 * and appends a registry entry. It NEVER touches system-layer files (scripts,
 * templates, modes/* except _profile.md, …) — those stay shared at the root.
 *
 * ## Usage
 *
 *   node migrate-profile.mjs <slug> --display-name "Full Name" \
 *        [--color "#dd7627"] [--root <dataRoot>] [--dry-run] [--move] [--force]
 *
 *   node migrate-profile.mjs alex --display-name "Alex Doe" --dry-run
 *   node migrate-profile.mjs alex --display-name "Alex Doe" --color "#0284c7"
 *
 * `<slug>` must match ^[a-z0-9_-]+$ (the same allowlist the dashboard enforces).
 * Default data root = process.env.CAREER_OPS_ROOT || process.cwd().
 *
 * Idempotent: registering twice does not duplicate the entry. If
 * `profiles/<slug>/` already exists the tool refuses unless `--force`. On copy,
 * a destination file that is NEWER than the source is left alone unless `--force`.
 *
 * Exit codes: 0 = success, non-zero = error.
 */

import { listTree } from './lib/walk-tree.mjs';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  readdirSync,
  copyFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as yaml from 'js-yaml';
import { loadYaml as parseYaml } from './lib/yaml-document.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── console helpers ───────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const c = (code) => (s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = c('32');
const red = c('31');
const yellow = c('33');
const cyan = c('36');
const dim = c('2');
const bold = c('1');

function die(msg) {
  process.stderr.write(`${red('error')}: ${msg}\n`);
  process.exit(1);
}

// ── User-layer manifest (see DATA_CONTRACT.md) ────────────────────────────────
// Only these files/dirs are migrated. Everything else (scripts, templates,
// modes/* except _profile.md, dashboard, fonts, …) is system-layer and shared.
// `type` is 'file' or 'dir'. Missing entries are skipped (a partial install is
// valid). Order is cosmetic (governs report grouping).
const USER_LAYER = [
  { rel: 'cv.md', type: 'file' },
  { rel: 'config/profile.yml', type: 'file' },
  { rel: 'config/job-search.yml', type: 'file' },
  { rel: 'modes/_profile.md', type: 'file' },
  { rel: 'modes/_custom.md', type: 'file' },
  { rel: 'voice-dna.md', type: 'file' },
  { rel: 'article-digest.md', type: 'file' },
  { rel: 'portals.yml', type: 'file' },
  { rel: 'data/applications.md', type: 'file' },
  { rel: 'data/applications.db', type: 'file' },
  { rel: 'data/pipeline.md', type: 'file' },
  { rel: 'data/scan-history.tsv', type: 'file' },
  { rel: 'data/follow-ups.md', type: 'file' },
  { rel: 'data/job-dashboard.json', type: 'file' },
  { rel: 'reports', type: 'dir' },
  { rel: 'output', type: 'dir' },
  { rel: 'jds', type: 'dir' },
  { rel: 'interview-prep', type: 'dir' },
  { rel: 'writing-samples', type: 'dir' },
];

// Within a user-layer dir, these basenames are SYSTEM-owned and must be left in
// place (DATA_CONTRACT.md: writing-samples/README.md is delivered by updates).
const SYSTEM_OWNED_BASENAMES = new Set(['README.md']);
function isSystemOwned(relDir, relFile) {
  if (relDir === 'writing-samples' && SYSTEM_OWNED_BASENAMES.has(path.basename(relFile))) {
    return true;
  }
  return false;
}

const SLUG_RE = /^[a-z0-9_-]+$/;
const COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const DEFAULT_COLOR = '#0284c7';

// ── argv parsing ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {
    slug: null,
    displayName: null,
    color: null,
    root: null,
    dryRun: false,
    move: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const needsValue = (name) => {
      const v = argv[++i];
      if (v === undefined) die(`${name} requires a value`);
      return v;
    };
    switch (a) {
      case '--display-name': opts.displayName = needsValue('--display-name'); break;
      case '--color': opts.color = needsValue('--color'); break;
      case '--root': opts.root = needsValue('--root'); break;
      case '--dry-run': opts.dryRun = true; break;
      case '--move': opts.move = true; break;
      case '--force': opts.force = true; break;
      case '-h':
      case '--help': printUsage(); process.exit(0); break;
      default:
        if (a.startsWith('--')) die(`unknown flag: ${a}`);
        if (opts.slug !== null) die(`unexpected argument: ${a} (slug already set to "${opts.slug}")`);
        opts.slug = a;
    }
  }
  return opts;
}

function printUsage() {
  process.stdout.write(
    `Usage: node migrate-profile.mjs <slug> --display-name "Full Name" \\\n` +
    `         [--color "#dd7627"] [--root <dataRoot>] [--dry-run] [--move] [--force]\n\n` +
    `Migrate a single-profile install's user-layer data into profiles/<slug>/\n` +
    `and register it in profiles.yml.\n\n` +
    `  <slug>            Profile id, must match ^[a-z0-9_-]+$\n` +
    `  --display-name    Human-readable name (required)\n` +
    `  --color           Hex accent color (default ${DEFAULT_COLOR})\n` +
    `  --root            Data root (default $CAREER_OPS_ROOT || cwd)\n` +
    `  --dry-run         Print what would happen; write nothing\n` +
    `  --move            Move instead of copy (destructive — default is copy)\n` +
    `  --force           Overwrite existing profile dir / newer files\n`
  );
}

// ── fs helpers ────────────────────────────────────────────────────────────────
/** Recursively enumerate files under `abs` (a dir), returning paths relative to it. */
function walkFiles(abs) {
  return listTree(abs, { links: 'follow' }).map((f) => path.relative(abs, f));
}

/** mtime in ms, or 0 if the path is missing. */
function mtimeMs(p) {
  try { return statSync(p).mtimeMs; } catch { return 0; }
}

// ── registry ──────────────────────────────────────────────────────────────────
function loadRegistry(registryPath) {
  if (!existsSync(registryPath)) return { profiles: [] };
  let doc;
  try {
    const raw = readFileSync(registryPath, 'utf8');
    doc = raw.trim() ? parseYaml(raw) : null;
  } catch (err) {
    die(`failed to parse ${registryPath}: ${err.message}`);
  }
  if (doc == null) return { profiles: [] };
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    die(`${registryPath} is malformed (expected a mapping with a "profiles:" list)`);
  }
  if (!Array.isArray(doc.profiles)) doc.profiles = [];
  return doc;
}

// ── main ──────────────────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.slug) { printUsage(); die('missing <slug>'); }
  if (!SLUG_RE.test(opts.slug)) {
    die(`invalid slug "${opts.slug}" — must match ^[a-z0-9_-]+$ (lowercase letters, digits, hyphen, underscore)`);
  }
  if (!opts.displayName || !opts.displayName.trim()) {
    die('--display-name "Full Name" is required');
  }
  if (opts.color && !COLOR_RE.test(opts.color)) {
    die(`invalid --color "${opts.color}" — expected a hex color like "#dd7627"`);
  }

  const dataRoot = path.resolve(
    opts.root || process.env.CAREER_OPS_ROOT || process.cwd()
  );
  if (!existsSync(dataRoot)) die(`data root does not exist: ${dataRoot}`);

  const color = opts.color || DEFAULT_COLOR;
  const relProfileRoot = path.join('profiles', opts.slug); // as written in profiles.yml
  const profileRoot = path.join(dataRoot, relProfileRoot);
  const registryPath = path.join(dataRoot, 'profiles.yml');
  const mode = opts.move ? 'move' : 'copy';

  // Guard: a populated destination requires --force (idempotency / safety).
  // We treat "exists but empty" as fine so a half-finished run can resume.
  const destPopulated =
    existsSync(profileRoot) &&
    statSync(profileRoot).isDirectory() &&
    readdirSync(profileRoot).length > 0;
  if (destPopulated && !opts.force && !opts.dryRun) {
    die(
      `${relProfileRoot}/ already exists and is not empty.\n` +
      `  Re-run with --force to overwrite, or pick a different slug.\n` +
      `  (Registry updates are idempotent and run regardless of --force.)`
    );
  }

  // ── Header ──
  process.stdout.write(
    `${bold('migrate-profile')} ${dim('—')} ${cyan(opts.slug)} ` +
    `${dim('(' + opts.displayName + ')')}\n`
  );
  process.stdout.write(`  data root : ${dataRoot}\n`);
  process.stdout.write(`  target    : ${relProfileRoot}/\n`);
  process.stdout.write(`  mode      : ${mode}${opts.dryRun ? dim('  [dry-run]') : ''}\n\n`);

  // ── Plan the file operations ──
  const plan = []; // { from, to, action: 'copy'|'move'|'skip-newer', relGroup }
  let skippedMissing = 0;

  for (const item of USER_LAYER) {
    const srcAbs = path.join(dataRoot, item.rel);
    if (!existsSync(srcAbs)) { skippedMissing++; continue; }

    if (item.type === 'file') {
      const destAbs = path.join(profileRoot, item.rel);
      plan.push(classify(srcAbs, destAbs, item.rel, item.rel, opts));
    } else {
      // dir — walk every file, preserving structure, skipping system-owned files
      const files = walkFiles(srcAbs);
      for (const rel of files) {
        if (isSystemOwned(item.rel, rel)) continue;
        const srcFile = path.join(srcAbs, rel);
        const destFile = path.join(profileRoot, item.rel, rel);
        plan.push(classify(srcFile, destFile, path.join(item.rel, rel), item.rel, opts));
      }
    }
  }

  const toApply = plan.filter((p) => p.action !== 'skip-newer');
  const skippedNewer = plan.filter((p) => p.action === 'skip-newer');

  if (plan.length === 0) {
    process.stdout.write(
      `${yellow('!')} No user-layer files found under ${dataRoot} — nothing to migrate.\n` +
      `  ${dim('Is this the right --root? A fresh install has no data yet.')}\n`
    );
  }

  // ── Print the plan ──
  const verb = opts.dryRun ? 'would ' + mode : mode;
  for (const p of toApply) {
    process.stdout.write(`  ${green(opts.dryRun ? '·' : '✓')} ${verb.padEnd(5)} ${p.rel}\n`);
  }
  for (const p of skippedNewer) {
    process.stdout.write(
      `  ${yellow('skip')} ${p.rel} ${dim('(destination is newer; use --force to overwrite)')}\n`
    );
  }
  if (skippedMissing > 0) {
    process.stdout.write(`  ${dim(`(${skippedMissing} optional user-layer path(s) not present — skipped)`)}\n`);
  }

  // ── Registry preview / mutation ──
  const registry = loadRegistry(registryPath);
  const existing = registry.profiles.find((p) => p && p.name === opts.slug);
  const registryAction = existing ? 'already-registered' : 'register';

  process.stdout.write('\n');
  if (registryAction === 'register') {
    process.stdout.write(
      `  ${green(opts.dryRun ? '·' : '✓')} ${opts.dryRun ? 'would register' : 'register'} in profiles.yml: ` +
      `${cyan('{ name: ' + opts.slug + ', root: ' + relProfileRoot + ', color: ' + color + ' }')}\n`
    );
  } else {
    process.stdout.write(`  ${dim('· profiles.yml already has an entry for ' + opts.slug + ' — leaving it unchanged')}\n`);
  }

  if (opts.dryRun) {
    process.stdout.write(`\n${dim('Dry run — no files written. Re-run without --dry-run to apply.')}\n`);
    process.exit(0);
  }

  // ── Apply file operations ──
  let applied = 0;
  for (const p of toApply) {
    mkdirSync(path.dirname(p.to), { recursive: true });
    try {
      if (mode === 'move') {
        try {
          renameSync(p.from, p.to);
        } catch (err) {
          if (err.code === 'EXDEV') {
            // cross-device — fall back to copy + unlink
            copyFileSync(p.from, p.to);
            rmSync(p.from);
          } else { throw err; }
        }
      } else {
        copyFileSync(p.from, p.to);
      }
      applied++;
    } catch (err) {
      die(`failed to ${mode} ${p.rel}: ${err.message}`);
    }
  }

  // ── Apply registry mutation (idempotent) ──
  if (registryAction === 'register') {
    registry.profiles.push({
      name: opts.slug,
      display_name: opts.displayName,
      root: relProfileRoot,
      color,
    });
    try {
      writeFileSync(
        registryPath,
        yaml.dump(registry, { lineWidth: 100, noRefs: true }),
        'utf8'
      );
    } catch (err) {
      die(`failed to write ${registryPath}: ${err.message}`);
    }
  }

  // ── Leave a move note (so it's obvious data was relocated, not copied) ──
  if (mode === 'move' && applied > 0) {
    const note = path.join(profileRoot, 'MIGRATED.md');
    try {
      writeFileSync(
        note,
        `# Migrated profile: ${opts.slug}\n\n` +
        `User-layer data for **${opts.displayName}** was **moved** here from the data root\n` +
        `\`${dataRoot}\` on ${new Date().toISOString()} by \`migrate-profile.mjs --move\`.\n\n` +
        `The original files no longer exist at the root. To undo, move them back and\n` +
        `remove the \`${opts.slug}\` entry from \`profiles.yml\`.\n`,
        'utf8'
      );
    } catch { /* note is best-effort */ }
  }

  // ── Summary ──
  process.stdout.write(`\n${green('✓ done')} — ${applied} file(s) ${mode === 'move' ? 'moved' : 'copied'} into ${relProfileRoot}/\n`);
  if (registryAction === 'register') {
    process.stdout.write(`${green('✓')} registered "${opts.slug}" in profiles.yml\n`);
  }

  process.stdout.write(`\n${bold('Use it:')}\n`);
  process.stdout.write(`  Dashboard  : open the web app with ${cyan('?profile=' + opts.slug)} (sticks via the co-profile cookie)\n`);
  process.stdout.write(`  CLI / cron : ${cyan('CAREER_OPS_ROOT=' + profileRoot)} node <script>.mjs\n`);

  process.stdout.write(`\n${bold('Rollback:')}\n`);
  if (mode === 'copy') {
    process.stdout.write(
      `  ${dim('(copy was non-destructive — your root data is untouched)')}\n` +
      `  1. rm -rf ${profileRoot}\n` +
      `  2. remove the "${opts.slug}" entry from ${registryPath}\n`
    );
  } else {
    process.stdout.write(
      `  ${yellow('(move relocated your data — root files are gone)')}\n` +
      `  1. move files back from ${relProfileRoot}/ to the data root\n` +
      `  2. remove the "${opts.slug}" entry from ${registryPath}\n` +
      `  3. delete ${relProfileRoot}/MIGRATED.md\n`
    );
  }

  process.exit(0);
}

/** Decide copy/move/skip for a single source→dest file pair. */
function classify(from, to, rel, relGroup, opts) {
  if (!opts.move && !opts.force && existsSync(to)) {
    // copy mode: never clobber a NEWER destination without --force
    if (mtimeMs(to) > mtimeMs(from)) {
      return { from, to, rel, relGroup, action: 'skip-newer' };
    }
  }
  return { from, to, rel, relGroup, action: opts.move ? 'move' : 'copy' };
}

main();
