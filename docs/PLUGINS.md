# Plugins

Plugins extend career-ops with integrations that need an API key or talk to an
external service — things the zero-keys, local-first core doesn't carry. They are
**opt-in**, sandboxed-by-convention, and additive: with no plugins enabled, the
core runs exactly as it always has.

> This is **not** the Claude Code plugin (`.claude-plugin/`). These plugins
> extend career-ops itself.

## Using plugins

```bash
node plugins.mjs list          # what's installed + its trust badge
node plugins.mjs available     # bundled + community plugins we've approved
node plugins.mjs add <name>    # install an approved community plugin
node plugins.mjs enable <id>   # show the capability card (then add --confirm)
node plugins.mjs skill <id>    # print a plugin's how-to (if it ships one)
```

Two gates must both be satisfied for a plugin to run: it must be **enabled**
(`node plugins.mjs enable <id> --confirm`, which records your consent) **and** its
keys must be in your `.env`. `node doctor.mjs` shows what's missing.

### Trust badges

| Badge | Meaning |
|-------|---------|
| `📦 bundled` | Shipped in `plugins/`, reviewed in-tree, auto-updated with the core. |
| `✓ approved` | A community plugin we reviewed at an exact pinned commit (in the registry). |
| `❓ community-unverified` | You installed it from a repo we haven't reviewed — you're trusting the author. |
| `⚠️ off-registry` | Installed commit differs from the approved one. |

If a plugin's files change without a version bump, career-ops **blocks it** and
asks you to review + `node plugins.mjs trust <id>` to re-pin (tamper detection).

## Writing a plugin

```bash
node plugins.mjs new my-plugin     # scaffolds plugins.local/my-plugin/
```

A plugin is a directory with a `manifest.json` (validated before any code is
imported), an `index.mjs` (default-exports your hooks), and optionally a
`skill.md` + `_helpers`. Hooks: **provider / ingest / search / notify / export**
— there is no auto-submit hook. Producers **return** `Job[]`; the engine writes
them. Reach the network **only** through `ctx.fetch` (your manifest
`allowedHosts` is enforced, with SSRF protection). Keys arrive via `ctx.env`,
non-secret settings via `ctx.settings`.

See `plugins/README.md` for the full contract + the honest trust model (plain
ESM has no hard sandbox — bundled plugins are code-reviewed; your own are your
trust).

## Installing an unlisted plugin

This fork does not run a public plugin registry, so `node plugins.mjs available`
only ever shows the bundled set (`apify`, `gmail`, `notion`). To use a plugin
from any other GitHub repo, install it directly at a pinned commit:

```bash
node plugins.mjs add owner/career-ops-plugin-<name> --sha <40-hex-commit>
```

It installs into `plugins.local/` and is classified `❓ community-unverified` —
you're trusting the author, since nobody here reviewed the code. Broadly-useful,
low/zero-key plugins can be promoted into `plugins/` (bundled, code-reviewed,
auto-updated with the core) on request.

## Not a plugin

- **Centralized infrastructure** (hosted aggregation, shared services, proxies)
  → a separate, opt-in service.
- **Auto-submitting / blind-applying** → out of the core everywhere. career-ops
  drafts for you to review and submit; it is a decision-support tool, not a bot.
