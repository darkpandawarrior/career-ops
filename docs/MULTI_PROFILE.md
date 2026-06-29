# Multi-Profile

A single career-ops checkout can host **several candidates** ("profiles"), each
with its own private data root (`cv.md`, `config/`, `data/`, `reports/`, …) while
sharing one copy of the engine (scripts, modes, templates, the `web/` dashboard).

This is opt-in. With no `profiles.yml` present, the install behaves exactly as a
classic single-profile install — all the user-layer data lives directly at the
data root, and nothing below changes.

---

## How it works

A registry file, **`profiles.yml`**, at the data root maps a slug → a data root:

```yaml
profiles:
  - name: siddharth                 # slug — must match ^[a-z0-9_-]+$
    display_name: Siddharth Pandalai
    root: profiles/siddharth        # relative to the data root (engine root)
    color: "#0284c7"                # optional accent color (hex)
  - name: lakshita
    display_name: Lakshita
    root: profiles/lakshita
    color: "#dd7627"
```

- `root` is resolved **relative to the data root** (the engine root, i.e.
  `careerOpsRoot()`); an absolute path is also accepted.
- `display_name` falls back to the slug if omitted; `color` is optional.
- `profiles/`, `sync/`, and `profiles.yml` are **gitignored** — they hold private
  candidate data and must never be committed.

Both the legacy dashboard (`dashboard-web/server.mjs`) and the 2.0 web app
(`web/src/lib/profile-registry.ts`) read this exact shape.

---

## Migrating an existing single-profile install

Use `migrate-profile.mjs` (at the engine root) to lift a single-profile install's
**user-layer** data into `profiles/<slug>/` and register it.

```
node migrate-profile.mjs <slug> --display-name "Full Name" \
     [--color "#dd7627"] [--root <dataRoot>] [--dry-run] [--move] [--force]
```

| Flag | Meaning |
|------|---------|
| `<slug>` | Profile id — must match `^[a-z0-9_-]+$` |
| `--display-name` | Human-readable name (**required**) |
| `--color` | Hex accent color (default `#0284c7`) |
| `--root` | Data root (default `$CAREER_OPS_ROOT` or the current dir) |
| `--dry-run` | Print exactly what would be copied/registered; write nothing |
| `--move` | **Move** instead of copy (destructive; default is copy) |
| `--force` | Overwrite an existing profile dir / a newer destination file |

Only **user-layer** files are migrated (see `DATA_CONTRACT.md`): `cv.md`,
`config/profile.yml`, `config/job-search.yml`, `modes/_profile.md`,
`modes/_custom.md`, `voice-dna.md`, `article-digest.md`, `portals.yml`,
`data/applications.md`, `data/applications.db`, `data/pipeline.md`,
`data/scan-history.tsv`, `data/follow-ups.md`, `data/job-dashboard.json`, and the
`reports/`, `output/`, `jds/`, `interview-prep/`, `writing-samples/` directories.
**System-layer** files (scripts, templates, `modes/*` except `_profile.md`,
`writing-samples/README.md`, …) are never touched — they stay shared at the root.
Missing files are skipped (a partial install is valid).

### Examples

Preview first (recommended — writes nothing):

```
node migrate-profile.mjs siddharth --display-name "Siddharth Pandalai" --dry-run
```

Apply (copy — non-destructive, leaves the root data in place):

```
node migrate-profile.mjs siddharth --display-name "Siddharth Pandalai" --color "#0284c7"
```

Migrate a candidate whose data lives in another checkout:

```
node migrate-profile.mjs lakshita --display-name "Lakshita" \
     --root /path/to/her/career-ops
```

Move instead of copy (relocates the data; drops a `MIGRATED.md` note):

```
node migrate-profile.mjs siddharth --display-name "Siddharth Pandalai" --move
```

The tool is **idempotent**: re-running never duplicates the `profiles.yml` entry.
If `profiles/<slug>/` already exists and is non-empty it refuses unless `--force`;
in copy mode it also won't overwrite a destination file that is **newer** than the
source without `--force`. Exit code is `0` on success, non-zero on any error
(bad slug, missing `--display-name`, unwritable root, …).

---

## Selecting a profile in the dashboard

Selection is driven by a query parameter and made sticky by a cookie.

- **`?profile=<slug>`** — open any dashboard URL with this query param to view that
  profile's data, e.g. `http://localhost:3000/?profile=siddharth`.
- **Stickiness (`co-profile` cookie)** — `web/middleware.ts` resolves the slug once
  per request and forwards it to every page/route handler as the `x-co-profile`
  request header. When `?profile=` is **explicit**, the slug is persisted in the
  `co-profile` cookie (`httpOnly`, `sameSite=lax`), so subsequent plain navigations
  (bare links without the query string) keep the same profile.
- **Precedence** — explicit `?profile=` query param **wins** over the cookie. An
  explicit but **empty or invalid** `?profile=` clears the cookie → back to the
  single-profile root.
- The middleware only validates the slug grammar (it runs on the edge runtime). The
  filesystem registry lookup happens server-side in `requestRoot()`; an unknown or
  unregistered slug silently falls back to the single-profile root, so nothing
  breaks if a slug isn't in `profiles.yml`.

For CLI/cron runs against a specific profile, point the engine at that data root:

```
CAREER_OPS_ROOT=/path/to/checkout/profiles/siddharth node verify-pipeline.mjs
```

---

## Rolling back a migration

Because the default is **copy** (non-destructive), rollback just removes the new
profile and its registry entry — your root data was never touched:

1. `rm -rf profiles/<slug>` (delete the copied profile dir)
2. Remove the `<slug>` entry from `profiles.yml` (delete the whole list item; if it
   was the only profile you may delete `profiles.yml` entirely).

If you migrated with **`--move`**, the root files were relocated, so also:

3. Move the files back from `profiles/<slug>/` to the data root, then
4. Delete `profiles/<slug>/MIGRATED.md`.

The migration tool prints these same rollback steps (with absolute paths) at the
end of every run.

---

## Staging build / deploy (the `web/` app)

The 2.0 dashboard is a Next.js app under `web/`. Standard flow:

```
cd web
npm install
npm run build
npm start          # serves the production build (defaults to port 3000)
```

Useful environment variables:

| Variable | Purpose |
|----------|---------|
| `CAREER_OPS_ROOT` | Absolute path to the data root the app reads (`cv.md`, `data/`, `reports/`, `profiles.yml`). Defaults to the parent of `web/` (`..`). Set this to read a separate (gitignored) data checkout. |
| `BUILD_DIST` | Override the Next.js build output dir (e.g. `BUILD_DIST=.next-prod`) so a production/staging build uses a **throwaway** dist dir and doesn't clobber a running `next dev` server's `.next/`. Wired in `web/next.config.mjs` via `distDir`. |

Example staging build into a throwaway dir, pointed at a specific data root:

```
cd web
npm install
CAREER_OPS_ROOT=/srv/career-ops BUILD_DIST=.next-staging npm run build
CAREER_OPS_ROOT=/srv/career-ops BUILD_DIST=.next-staging npm start
```

> Multi-profile and the build are orthogonal: you build the app **once**, and each
> request selects its profile at runtime via `?profile=<slug>` (see above). You do
> **not** rebuild per profile.
