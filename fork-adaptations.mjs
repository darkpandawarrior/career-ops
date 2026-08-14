#!/usr/bin/env node

/**
 * fork-adaptations.mjs — the fork's layer over upstream career-ops, as data.
 *
 * WHY THIS EXISTS
 *
 * Absorbing an upstream release means touching ~200 files, and the classify pass
 * on the post-1.26.0 window found 90 of them "diverged". But the divergence is
 * not 90 bespoke decisions: it is a handful of mechanical transforms repeated
 * across ~40-47 files (namespace yaml import, multi-profile data roots, the
 * fork's own tracker lock), plus a small residue of genuinely fork-only logic.
 *
 * Hand-applying those transforms per file is what makes syncs slow and, worse,
 * silently lossy — an adaptation dropped during a copy does not fail the build,
 * it just quietly restores the bug it was written to fix. That has happened:
 * upstream #75 fixed 25 scripts that derived data paths from the script
 * directory and so read the WRONG PROFILE's tracker under `./profile <name>`,
 * with a 100% green suite the whole time.
 *
 * So the layer lives here as data instead of as tribal knowledge:
 *
 *   node fork-adaptations.mjs            # check; exit 1 on violations
 *   node fork-adaptations.mjs --apply    # rewrite what can be rewritten
 *   node fork-adaptations.mjs --json     # machine-readable report
 *
 * SYNC WORKFLOW THIS ENABLES
 *
 *   1. copy upstream's file wholesale
 *   2. node fork-adaptations.mjs --apply
 *   3. node fork-adaptations.mjs         (must be clean)
 *   4. node test-all.mjs
 *
 * Only the residue — genuinely fork-only logic — then needs judgment, and
 * tests/fork-adaptations.test.mjs makes step 3 fail loudly instead of shipping
 * a silently reverted adaptation.
 *
 * WHAT DOES NOT BELONG HERE: anything needing judgment. A rule earns a place
 * only if a machine can decide it. Fork-only *behaviour* (e.g. workday's
 * cap-hit warning) is guarded by ordinary tests, not by this file.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname } from 'path';

const ROOT = dirname(fileURLToPath(import.meta.url));

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'graphify-out', 'output', 'batch']);

/** Every .mjs/.ts/.tsx file the fork owns, repo-relative, excluding vendor trees. */
export function sourceFiles(root = ROOT) {
  const out = [];
  (function walk(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (/\.(mjs|ts|tsx)$/.test(name)) out.push(relative(root, full));
    }
  })(root);
  return out.sort();
}

/**
 * Whether a script reads or writes the ACTIVE profile's data directory.
 *
 * Detected from the source rather than kept as a hand-maintained list, on
 * purpose: a list drifts the moment a script starts touching data/, and drift
 * in a safety check is worse than no check — it reads as "verified" while
 * covering nothing. (The first draft of this file DID hardcode a list, and it
 * immediately produced a false positive on add-entry.mjs, which never touches
 * data/ at all.)
 */
function touchesProfileData(src) {
  return /['"]data\/[a-z-]|join\([^)]*['"]data['"]|resolveTrackerPath/.test(src);
}

export const ADAPTATIONS = [
  {
    id: 'yaml-namespace-import',
    why: 'js-yaml v5 is ESM-only and has no default export. Upstream still writes the '
       + 'default import; it throws at module load here, and also breaks `next build` '
       + 'under turbopack — not just node.',
    autofix: true,
    violations(src, file) {
      if (!/\.(mjs|ts|tsx)$/.test(file)) return [];
      return /^import\s+yaml\s+from\s+['"]js-yaml['"]/m.test(src)
        ? [`${file}: default js-yaml import (use \`import * as yaml\`)`]
        : [];
    },
    fix(src) {
      return src.replace(/^import\s+yaml\s+from\s+(['"])js-yaml\1/gm, 'import * as yaml from $1js-yaml$1');
    },
  },
  {
    id: 'no-update-system-import',
    why: 'This fork syncs explicitly and never self-updates, so update-system.mjs is '
       + 'deleted here. Upstream files that import it must be given a fork-local module '
       + '(user-layer-paths.mjs exists for exactly this reason) rather than dragging it back in.',
    autofix: false,
    violations(src, file) {
      return /from\s+['"]\.\/update-system\.mjs['"]/.test(src)
        ? [`${file}: imports ./update-system.mjs, which this fork does not ship`]
        : [];
    },
  },
  {
    id: 'multi-profile-data-root',
    why: 'Under `./profile <name>` the ACTIVE profile\'s data lives at CAREER_OPS_ROOT, '
       + 'which is NOT the script directory. Upstream derives data paths from the script '
       + 'directory, so a wholesale copy reads the wrong profile\'s tracker and reports an '
       + 'empty pipeline instead of erroring — invisible in a single-checkout install, and '
       + 'invisible to the test suite (upstream #75 shipped it across 25 scripts).',
    // Autofixable ONLY because the shape was normalised: all 37 call sites now
    // use one canonical destructure with one pair of names, so re-applying it
    // after a sync is a deterministic rewrite rather than a per-file guess.
    // Before normalisation there were TEN shapes across these files, which is
    // exactly why an automated resolver silently dropped the adaptation in 14
    // of 17 files it claimed to have resolved.
    autofix: true,
    fix(src) {
      if (!/^#!.*\bnode\b/.test(src)) return src;
      if (!touchesProfileData(src)) return src;
      if (/resolveCareerOpsRoot|CAREER_OPS_ROOT/.test(src)) return src;
      // Upstream's shape -> the fork's canonical shape, plus the import.
      const anchored = src.replace(
        /^const CAREER_OPS = dirname\(fileURLToPath\(import\.meta\.url\)\);$/m,
        'const { engineRoot: CAREER_OPS, dataRoot: CAREER_OPS_DATA } = resolveCareerOpsRoot(import.meta.url);',
      );
      if (anchored === src) return src;          // no anchor: leave for a human
      const m = /^import .*?;\n/m.exec(anchored);
      if (!m) return anchored;
      return anchored.slice(0, m.index + m[0].length)
        + "import { resolveCareerOpsRoot } from './path-resolver.mjs';\n"
        + anchored.slice(m.index + m[0].length);
    },
    violations(src, file) {
      if (!/^[^/]+\.mjs$/.test(file)) return [];        // root scripts only
      if (/\.test\.mjs$|-tests\.mjs$/.test(file)) return []; // fixtures use their own roots
      // Executables only. A library that takes `root` as a parameter (e.g.
      // tracker-utils.mjs's resolveTrackerPath(root)) is correct BECAUSE it
      // resolves nothing itself — flagging it would be exactly the false
      // positive that makes a check get ignored.
      if (!/^#!.*\bnode\b/.test(src)) return [];
      if (!touchesProfileData(src)) return [];
      const resolves = /resolveCareerOpsRoot|CAREER_OPS_ROOT/.test(src);
      return resolves ? [] : [`${file}: touches profile data but never resolves CAREER_OPS_ROOT`];
    },
  },
  {
    id: 'local-imports-resolve',
    why: 'A wholesale copy from upstream silently DELETES fork-only exports, and nothing '
       + 'fails until the importing module is loaded — which for a rarely-run CLI can be '
       + 'weeks. Observed: copying upstream verify-portals.mjs dropped the fork-only '
       + '`discoverAlternates`, breaking scan.mjs and 6 test suites at once; and the reverse '
       + '(upstream retiring jobvite\'s `resolveCompanyId`) is the same hazard from the other '
       + 'direction. Deliberately has NO baseline snapshot to drift: it re-derives both sides '
       + 'from the tree every run.',
    autofix: false,
    violations(src, file, ctx) {
      if (!file.endsWith('.mjs')) return [];
      const out = [];
      const importRe = /import\s*\{([^}]*)\}\s*from\s*['"](\.\/[^'"]+\.mjs)['"]/g;
      for (const m of src.matchAll(importRe)) {
        const target = m[2].slice(2);
        const targetSrc = ctx?.read(target);
        if (targetSrc == null) continue;                    // not ours / generated
        if (/^export\s+\*/m.test(targetSrc)) continue;      // re-export, can't resolve cheaply
        const exported = new Set([
          ...[...targetSrc.matchAll(/^export\s+(?:async\s+)?(?:function|class)\s+(\w+)/gm)].map(x => x[1]),
          ...[...targetSrc.matchAll(/^export\s+(?:const|let|var)\s+(\w+)/gm)].map(x => x[1]),
          ...[...targetSrc.matchAll(/^export\s*\{([^}]*)\}/gm)]
            .flatMap(x => x[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop().trim())),
        ]);
        for (const raw of m[1].split(',')) {
          const name = raw.trim().split(/\s+as\s+/)[0].trim();
          if (!name || name.startsWith('//')) continue;
          if (!exported.has(name)) out.push(`${file}: imports \`${name}\` from ${m[2]}, which does not export it`);
        }
      }
      return out;
    },
  },
  {
    id: 'web-tests-colocated',
    why: 'Upstream puts web node:test suites in web/tests/; this fork colocates them as '
       + 'web/src/lib/*.test.mjs so they run under `npm run test:engine` while vitest keeps '
       + 'globbing *.test.{ts,tsx}. A copied web/tests/ file is simply never run here.',
    autofix: false,
    violations(src, file) {
      return /^web\/tests\/.*\.test\.mjs$/.test(file)
        ? [`${file}: web node:test suite under web/tests/ (colocate at web/src/lib/)`]
        : [];
    },
  },
];

/** Run every adaptation over every source file. Returns a flat violation list. */
export function check(root = ROOT, files = sourceFiles(root)) {
  const found = [];
  // Lets a rule read a sibling module (import resolution needs both sides).
  const cache = new Map();
  const ctx = { read(rel) {
    if (cache.has(rel)) return cache.get(rel);
    let v = null;
    try { v = readFileSync(join(root, rel), 'utf-8'); } catch { v = null; }
    cache.set(rel, v);
    return v;
  } };
  for (const file of files) {
    let src;
    try { src = readFileSync(join(root, file), 'utf-8'); } catch { continue; }
    for (const a of ADAPTATIONS) found.push(...a.violations(src, file, ctx).map(m => ({ id: a.id, message: m })));
  }
  return found;
}

/** Apply every autofixable adaptation in place. Returns the files rewritten. */
export function apply(root = ROOT, files = sourceFiles(root)) {
  const changed = [];
  for (const file of files) {
    const path = join(root, file);
    let src;
    try { src = readFileSync(path, 'utf-8'); } catch { continue; }
    let next = src;
    for (const a of ADAPTATIONS) if (a.autofix) next = a.fix(next);
    if (next !== src) { writeFileSync(path, next, 'utf-8'); changed.push(file); }
  }
  return changed;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node fork-adaptations.mjs [--apply] [--json]\n\n'
      + '  (no flags)  check the tree; exit 1 if any adaptation was lost\n'
      + '  --apply     rewrite what can be rewritten mechanically, then check\n'
      + '  --json      machine-readable report');
    process.exit(0);
  }
  if (args.includes('--apply')) {
    const changed = apply();
    console.log(changed.length ? `rewrote ${changed.length} file(s):\n  ${changed.join('\n  ')}` : 'nothing to rewrite');
  }
  const found = check();
  if (args.includes('--json')) {
    console.log(JSON.stringify({ ok: found.length === 0, violations: found }, null, 2));
  } else if (found.length) {
    console.error(`\n✗ ${found.length} fork adaptation(s) lost — a sync overwrote them:\n`);
    for (const v of found) console.error(`  [${v.id}] ${v.message}`);
    console.error('\nEach one is a bug this fork already fixed once. See the rule\'s `why` in fork-adaptations.mjs.');
  } else {
    console.log(`✓ all ${ADAPTATIONS.length} fork adaptations intact across ${sourceFiles().length} files`);
  }
  process.exit(found.length ? 1 : 0);
}
