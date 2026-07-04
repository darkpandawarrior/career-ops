#!/usr/bin/env node
/**
 * path-resolver.mjs — shared CAREER_OPS_ROOT resolution for root-level scripts.
 *
 * Every root script needs two roots that are usually the same directory but can
 * diverge in a multi-profile setup:
 *   - the ENGINE root: where the script itself (and its sibling .mjs modules)
 *     live — always the script's own directory.
 *   - the DATA root: where that script's data/, cv.md, config/, etc. live —
 *     the engine root by default, or CAREER_OPS_ROOT when a caller (e.g. the
 *     web app's per-profile subprocess spawn) points it at a different profile.
 *
 * scan.mjs, verify-pipeline.mjs, and followup-cadence.mjs each carried their own
 * copy of this ternary. Centralizing it here keeps all callers resolving
 * CAREER_OPS_ROOT the exact same way.
 *
 * @param {string} scriptUrl - the caller's `import.meta.url`.
 * @returns {{engineRoot: string, dataRoot: string}}
 */
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

export function resolveCareerOpsRoot(scriptUrl) {
  const engineRoot = dirname(fileURLToPath(scriptUrl));
  const dataRoot = process.env.CAREER_OPS_ROOT ? resolve(process.env.CAREER_OPS_ROOT) : engineRoot;
  return { engineRoot, dataRoot };
}
