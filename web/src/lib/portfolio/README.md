# lib/portfolio

The portfolio-site generator. Turns a candidate's career-ops data into a personal
portfolio **website** — for any role — that you can preview, refine, theme, version,
analyze, and export (single HTML or the full Vite project with an AI chat).

Full feature + data-model doc: [`../../../../docs/PORTFOLIO.md`](../../../../docs/PORTFOLIO.md).

| File | Responsibility |
|------|----------------|
| `schema.ts` | `PortfolioData` type + tolerant `coercePortfolio()` (never throws) + `extractPortfolioJson()` |
| `themes.ts` | named themes (palette + fonts): midnight / aurora / ember / paper / mono |
| `render.ts` | pure `renderPortfolio(data)` → one self-contained, themed, XSS-safe HTML page (preview == export) |
| `context.ts` | per-profile read/write under `.career-ops-web/portfolio/`; versions + `restore`/`finalize`; `buildPortfolioContext()` (the role-agnostic data assembly); `saveLocalCopy()` |
| `analyze.ts` | analyzer output contract + `coerceAnalysis()` + the analyze prompt |
| `scaffold.ts` | `PortfolioData` → the full Vite project (reads the bundled `templates/portfolio-site/`, injects a compilable `profile.ts`, a chat persona, and a filled `index.html`) |
| `zip.ts` | dependency-free STORE-method zip writer (deterministic) |

**Design rules**
- The renderer is **pure + deterministic** → unit-testable, and the in-app preview is byte-identical to the HTML export.
- AI output is **untrusted**: `coerce*` sanitizes it, `render` HTML-escapes everything, and the preview is a sandboxed iframe.
- Everything is **profile-scoped** (`requestRoot()`); drafts never cross profiles and never reach git.
- Sections are **role-neutral** — the mode (`modes/portfolio.md`) fills them with role-appropriate substance.

Tests live next to each file (`*.test.ts`).
