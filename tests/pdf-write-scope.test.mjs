// tests/pdf-write-scope.test.mjs — moved out of test-all.mjs §55.6 into the
// fork's auto-discovered tests/ layout. Content is upstream's guard, unchanged
// apart from the harness imports and one level of dedent.

import { pass, fail, warn, run, lastRunFailure, ROOT, NODE } from './helpers.mjs';
import { join, relative, sep } from 'path';
import { listTree } from '../lib/walk-tree.mjs';
import { existsSync, readFileSync } from 'fs';
import { pathToFileURL } from 'url';


// 55.6 pdf mode must never hand the agent write access (#2185).
// The web's "pdf" agent tailors content and nothing else: it emits the CV
// through a <<cv-html>> envelope and the BACKEND writes every file. A write
// grant here would be unscoped, so a prompt injection in a posting or report
// (both enter that agent's context) could redirect it at cv.md.
//
// Asserted on VALUES — the built argv and the built prompt. FIVE source-text
// versions of this guard were defeated by rewriting route.ts around them (see
// web/src/lib/claude-invocation.mjs's header). The one structural rule left is
// that route.ts may not spell a tool flag itself, which is what stops an inline
// argv from hiding beside a legitimate claudeCliArgs() call.
//
// In the REQUIRED suite on purpose: web-ci.yml is informative-only, so asserting
// this only there would gate nothing. Importing is safe — these are
// dependency-free ESM modules and the root suite runs on Node >= 18.
const webLib = join(ROOT, 'web', 'src', 'lib');
const runRoutePath = join(ROOT, 'web', 'src', 'app', 'api', 'run', 'route.ts');
if (!existsSync(webLib)) {
  // Expected for a data-only install: web/ is in no SYSTEM_PATHS entry.
  warn('web/ not present in this checkout — skipping the pdf write-scope freeze (#2185)');
} else {
  // web/ IS here, so a missing file means a move, not an absence — fail rather
  // than skip, because a skip is how this freeze would silently stop guarding.
  const required = {
    'claude-invocation.mjs': join(webLib, 'claude-invocation.mjs'),
    'worker-capabilities.mjs': join(webLib, 'worker-capabilities.mjs'),
    'cv-envelope.mjs': join(webLib, 'cv-envelope.mjs'),
    'run-prompts.mjs': join(webLib, 'run-prompts.mjs'),
    'api/run/route.ts': runRoutePath,
  };
  const missing = Object.entries(required).filter(([, f]) => !existsSync(f)).map(([name]) => name);
  if (missing.length > 0) {
    fail(`web/ exists but ${missing.join(', ')} is missing — the #2185 write-scope freeze cannot verify (was it moved?)`);
  } else {
    let invocation;
    let capabilities;
    let prompts;
    try {
      invocation = await import(pathToFileURL(required['claude-invocation.mjs']).href);
      // KNOWN_KINDS moved to worker-capabilities.mjs (#2507).
      capabilities = await import(pathToFileURL(required['worker-capabilities.mjs']).href);
      prompts = await import(pathToFileURL(required['run-prompts.mjs']).href);
      // Imported for its side effect of resolving: run-prompts pulls cv-envelope
      // for CV_ENVELOPE_INSTRUCTION, so a break there would surface here anyway,
      // but naming it keeps the failure message specific.
      await import(pathToFileURL(required['cv-envelope.mjs']).href);
    } catch (err) {
      fail(`web pdf write-scope modules could not be imported (${err.message}) — the #2185 freeze cannot verify`);
    }
    // Gate the web unit suites from the REQUIRED check too. web-ci.yml is
    // informative-only, so without this a contributor strengthening those files
    // adds nothing to CI. This deliberately overlaps the value assertions below:
    // those give a named, greppable #2185 signal and still hold if the web suite
    // is ever trimmed, which is the failure this section exists to catch.
    // Discovered, not hand-listed: a list silently stops gating whatever is added
    // next, and this section previously covered 4 of the 6 files present.
    let webUnits = [];
    try {
      // RECURSIVE on purpose. This read the top level only, so the 14 suites under
      // core/, onboarding/, apply/, search/, scoring/, beta/ and home/ were gated by
      // NOTHING: web's own `test:engine` script globs all eight directories, and
      // nothing invokes test:engine. That is how a core/ suite sat broken and unrun
      // since the v1.29.0 sync, and how an onboarding/ suite kept a failing
      // assertion nobody saw.
      // listTree, not a recursive readdir: it applies the nested-checkout guard.
      const webLibRoot = join(ROOT, 'web', 'src', 'lib');
      webUnits = listTree(webLibRoot, { match: /\.test\.mjs$/ })
        .map((abs) => relative(webLibRoot, abs).split(sep).join('/'))
        .sort()
        .map((f) => `web/src/lib/${f}`);
    } catch (err) {
      // Fail rather than throw to the outer catch, which would skip every value
      // assertion below while reporting only "freeze section crashed".
      fail(`web/src/lib is unreadable (${err.message}) — the #2185 unit suites cannot be gated`);
    }
    // Three distinct states, so the message never misdescribes the failure: the
    // unreadable case already called fail() above, an empty directory is its own
    // fault, and only a non-empty list is actually run.
    if (webUnits.length === 0) {
      if (existsSync(join(ROOT, 'web', 'src', 'lib'))) {
        fail('web/src/lib contains no *.test.mjs — the #2185 unit suites are not being gated');
      }
    } else if (run(NODE, ['--test', ...webUnits], { timeout: 180000 }) !== null) {
      pass('web pdf write-scope unit suites pass (#2185)');
    } else {
      // The signal distinguishes a timeout/kill from an assertion failure —
      // run()'s default 30s is short for six suites in one child process.
      const killed = lastRunFailure()?.signal;
      fail(`web pdf write-scope unit suites failed${killed ? ` (killed: ${killed})` : ''} (run: node --test ${webUnits.join(' ')})`);
    }

    if (invocation && prompts) {
      const { claudeCliArgs, argValue, toolNames, grantsWriteCapability, WRITE_CAPABLE_TOOLS } = invocation;
      const pdfArgs = claudeCliArgs({ kind: 'pdf', prompt: 'freeze-probe' });
      const allowed = argValue(pdfArgs, '--allowedTools');
      const disallowed = argValue(pdfArgs, '--disallowedTools');

      if (!grantsWriteCapability({ allowed, disallowed })) {
        pass('web pdf command line grants no write-capable tool (#2185)');
      } else {
        const granted = WRITE_CAPABLE_TOOLS.filter((t) => toolNames(allowed).includes(t));
        fail(`web pdf command line grants write access via ${granted.join(', ')} — an unscoped write grant is the #2185 hole`);
      }

      // Denied by name, not merely omitted: --permission-mode acceptEdits exists
      // to auto-approve edit tools, so "unmentioned" is the one status a
      // file-writing tool must never have.
      const undenied = WRITE_CAPABLE_TOOLS.filter((t) => !toolNames(disallowed).includes(t));
      if (undenied.length === 0) {
        pass('web pdf command line explicitly denies every write-capable tool (#2185)');
      } else {
        fail(`web pdf command line no longer denies ${undenied.join(', ')} — #2172/#2185 guardrail weakened`);
      }

      // EVERY kind, not just pdf: a write tool that is neither allowed nor denied
      // can still be auto-approved by --permission-mode acceptEdits, and a
      // pdf-only probe let exactly that ship for the persisting kinds.
      const unmentioned = [];
      for (const kind of capabilities.KNOWN_KINDS) {
        const scope = invocation.toolScopeFor(kind);
        const named = [...toolNames(scope.allowed), ...toolNames(scope.disallowed)];
        for (const tool of WRITE_CAPABLE_TOOLS) {
          if (!named.includes(tool)) unmentioned.push(`${kind}:${tool}`);
        }
      }
      if (unmentioned.length === 0) {
        pass('web tool scopes leave no write-capable tool unmentioned for any kind (#2185)');
      } else {
        fail(`web tool scopes leave ${unmentioned.join(', ')} neither allowed nor denied — acceptEdits may auto-approve them (#2185)`);
      }

      // The PROMPT is asserted by run-prompts.test.mjs, which this section already
      // runs above — restating its regexes here would be two copies of one intent.
      // What is checked here is only what that suite cannot see: that the shipped
      // prompt is the one the route actually sends (below).
      // The one structural rule: the route delegates its argv. If it spells any
      // tool flag itself, an inline pdf arm could grant writes while every value
      // check above still describes claudeCliArgs's untouched output.
      // Strip comments with a scanner that respects string and template literals.
      // A `.replace(/\/\/.*$/, '')` per line also fires inside strings: a URL on the
      // same line as a tool flag deletes the flag, so a route spelling its own
      // --allowedTools would pass unnoticed. Only `//` OUTSIDE a literal is a comment.
      const stripJsComments = (src) => {
        let out = '';
        let quote = null;   // "'" | '"' | '`' when inside a literal
        let block = false;  // inside a /* */ comment
        let line = false;   // inside a // comment
        for (let i = 0; i < src.length; i++) {
          const c = src[i];
          const next = src[i + 1];
          if (line) { if (c === '\n') { line = false; out += c; } continue; }
          if (block) { if (c === '*' && next === '/') { block = false; i++; } continue; }
          if (quote) {
            // A backslash escapes the next character, so an escaped quote does not
            // close the literal and an escaped backslash does not escape what follows.
            if (c === '\\') { out += c + (next ?? ''); i++; continue; }
            if (c === quote) quote = null;
            out += c;
            continue;
          }
          if (c === '/' && next === '/') { line = true; continue; }
          if (c === '/' && next === '*') { block = true; i++; continue; }
          // A `/` here can also open a REGEX literal, and a quote inside one (say
          // /["']/) would otherwise flip the scanner into string state and swallow
          // the rest of the file. Distinguish regex from division the usual way:
          // regex can only follow an operator or an opener, never a value.
          if (c === '/') {
            const prev = out.replace(/\s+$/, '').slice(-1);
            if (prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev)) {
              out += c;
              for (i++; i < src.length; i++) {
                const r = src[i];
                out += r;
                if (r === '\\') { out += src[i + 1] ?? ''; i++; continue; }
                if (r === '[') { // a class can contain an unescaped `/`
                  for (i++; i < src.length && src[i] !== ']'; i++) {
                    out += src[i];
                    if (src[i] === '\\') { out += src[i + 1] ?? ''; i++; }
                  }
                  out += src[i] ?? '';
                  continue;
                }
                if (r === '/' || r === '\n') break;
              }
              continue;
            }
          }
          if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue; }
          out += c;
        }
        return out;
      };
      const routeCode = stripJsComments(readFileSync(runRoutePath, 'utf-8'))
        .split('\n')
        .filter((l) => !/^\s*import\b/.test(l))
        .join('\n');
      const spelledFlags = ['--allowedTools', '--disallowedTools', '--permission-mode']
        .filter((flag) => routeCode.includes(flag));
      const argvCallSites = (routeCode.match(/claudeCliArgs\s*\(/g) ?? []).length;
      // `kind` must reach claudeCliArgs as a SHORTHAND property. Property order
      // and line wrapping are free, but `{ kind: <anything> }` is refused:
      // `claudeCliArgs({ kind: kind === "pdf" ? "evaluate" : kind, prompt })`
      // once passed every check while pdf received the persisting scope.
      const passesKindVerbatim = /claudeCliArgs\s*\(\s*\{(?:[^{}]*,)?\s*kind\s*[,}]/.test(routeCode);
      if (spelledFlags.length === 0 && argvCallSites === 1 && passesKindVerbatim) {
        pass('web run route delegates its whole argv, spelling no tool flag and remapping no kind (#2185)');
      } else {
        const why = spelledFlags.length > 0
          ? `it spells ${spelledFlags.join(', ')} itself`
          : argvCallSites !== 1
            ? `it builds argv at ${argvCallSites} site(s), expected exactly 1`
            : 'it does not pass `kind` through verbatim (a remapped kind hands pdf another kind\'s scope)';
        fail(`web run route no longer delegates its argv — ${why}, so the value checks above may not describe what pdf actually ships (#2185)`);
      }
    }
  }
}
