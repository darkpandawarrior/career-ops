import Link from "next/link";
import { ArrowLeft, FileText, ExternalLink, ChevronDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Application } from "@/lib/career-ops";
import { Badge } from "@/components/ui/badge";
import { scoreTone, scoreNum, legitimacyTone, parseReport } from "@/lib/format";
import { cleanHeading, splitSections } from "@/lib/report-sections.mjs";
import { StatusSelect } from "@/components/status-select";
import { CompanyLogo } from "@/components/company-logo";
import { ScoreMethodology } from "@/components/score-methodology";
import { GeneratePdfButton } from "@/components/generate-pdf-button";
import { ApplyButton } from "@/components/apply-button";
import { DeleteFromTracker } from "@/components/delete-from-tracker";
import { PageShell } from "@/components/ui/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { companyPresentation } from "@/lib/company-presentation.mjs";

// Progressive disclosure of the report body. Our reports (modes/oferta.md)
// write "## A) Role Summary" / "## Block A — Role Summary" through G/H, plus
// an unlettered "## Verdict", "## Machine Summary" (YAML) and "## Keywords
// extracted" tail. A reader deciding "should I apply?" needs Verdict + Role
// Summary + Match; the rest is depth-on-demand. Native <details> only — no
// client JS, still a server component.
//
// Splitting and heading cleanup live in lib/report-sections.mjs so the
// author-letter range has one definition shared with the rest of the app —
// duplicating it here is what let a bare-letter H-block ("## H) Draft
// Application Answers") render with its letter still attached while every
// other section rendered clean (#2324).

const LEAD_LETTERS = new Set(["A", "B"]);

// Machine artifacts (YAML dump, submit log — for devs) vs human content
// (collapsed only because there's a lot of it).
function isMachine(heading: string): boolean {
  return /machine summary|submit(ted|[-\s]?log)/i.test(heading);
}

function isVerdict(heading: string): boolean {
  return /^verdict$/i.test(cleanHeading(heading));
}

// One-line teaser for a collapsed section's <summary> — first ~80 chars of
// its rendered-down text.
function preview(md: string): string {
  const text = md
    .replace(/^#+\s.*$/gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*_`>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 80 ? text.slice(0, 80).trimEnd() + "…" : text;
}

export function ReportView({
  id,
  app,
  report,
  file,
  canDelete = false,
  pdfReadyFromIndex = false,
}: {
  id: string;
  app: Application | null;
  report: string | null;
  file: string | null;
  canDelete?: boolean;
  pdfReadyFromIndex?: boolean;
}) {
  const meta = report ? parseReport(report) : null;
  const field = (label: string) => meta?.fields.find((f) => f.label === label)?.value;
  const score = app?.score || field("Score");
  const date = app?.date || field("Date");
  const archetype = field("Archetype");
  const url = field("URL");
  const pdfReady = (app?.pdf ?? "").includes("✅") || pdfReadyFromIndex;
  const company = app ? companyPresentation(app) : null;

  return (
    <PageShell maxWidth="3xl">
      <Link
        href="/pipeline"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand"
      >
        <ArrowLeft className="size-4" /> Pipeline
      </Link>

      <header className="mt-5">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-faint">#{id}</p>
        <div className="mt-2 flex items-center gap-3">
          <CompanyLogo name={company?.logoName ?? meta?.title ?? `Report #${id}`} size={40} />
          <h1 className="font-display text-3xl tracking-tight text-landing">
            {company?.label ?? meta?.title ?? `Report #${id}`}
          </h1>
        </div>
        {app?.role && <p className="mt-1 text-muted">{app.role}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {score && <Badge tone={scoreTone(score)}>{score}</Badge>}
          {score &&
            !Number.isNaN(scoreNum(score)) &&
            (scoreNum(score) >= 4.0 ? (
              <Badge tone="good">Recommended</Badge>
            ) : (
              <Badge tone="muted">Below the apply line</Badge>
            ))}
          {meta?.legitimacy && <Badge tone={legitimacyTone(meta.legitimacy)}>{meta.legitimacy}</Badge>}
          {app && <StatusSelect n={id} current={app.status} />}
          <GeneratePdfButton n={id} company={app?.company ?? meta?.title ?? id} pdfReady={pdfReady} />
          <ApplyButton n={id} url={url && url.startsWith("http") ? url : undefined} company={app?.company ?? meta?.title ?? id} pdfReady={pdfReady} />
        </div>

        {app && canDelete && (
          <div className="mt-3">
            <DeleteFromTracker n={id} />
          </div>
        )}

        {(archetype || date || (url && url.startsWith("http"))) && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            {archetype && <span className="max-w-full truncate">{archetype}</span>}
            {date && <span className="tabular-nums text-faint">{date}</span>}
            {url && url.startsWith("http") && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-1 text-brand hover:underline max-sm:min-h-[44px]"
              >
                posting <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        )}
      </header>

      {report ? (
        <>
          {(() => {
            const { intro, sections } = splitSections(meta?.body ?? report);
            // Tolerant fallback: no recognizable sections (unusual report
            // format) → render the whole body flat, same as before.
            if (sections.length === 0) {
              return (
                <article className="report-prose mt-8">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{meta?.body ?? report}</ReactMarkdown>
                </article>
              );
            }

            const verdict = sections.find((s) => isVerdict(s.heading));
            const rest = sections.filter((s) => s !== verdict);
            const machine = rest.filter((s) => isMachine(s.heading));
            const mainSections = rest.filter((s) => !isMachine(s.heading));
            const anyLead = mainSections.some((s) => s.letter && LEAD_LETTERS.has(s.letter));

            return (
              <div className="mt-8">
                {intro && (
                  <article className="report-prose">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{intro}</ReactMarkdown>
                  </article>
                )}

                {verdict && (
                  <div className="rounded-2xl border border-brand/25 bg-brand-soft/50 px-5 py-4">
                    <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.16em] text-brand/80">Verdict</p>
                    <article className="report-prose [&_p]:font-medium [&_p]:text-foreground">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{verdict.content}</ReactMarkdown>
                    </article>
                  </div>
                )}

                {mainSections.map((s, i) => {
                  const expanded = (s.letter && LEAD_LETTERS.has(s.letter)) || (!anyLead && !verdict && i === 0);
                  if (expanded) {
                    return (
                      <article key={i} className="report-prose mt-6">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{`## ${cleanHeading(s.heading)}\n\n${s.content}`}</ReactMarkdown>
                      </article>
                    );
                  }
                  return (
                    <details key={i} className="group mt-3 overflow-hidden rounded-xl border border-border bg-surface/30">
                      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-4 py-3 transition-colors hover:bg-surface-hover">
                        <span className="text-sm font-medium">{cleanHeading(s.heading)}</span>
                        <span className="hidden truncate text-xs text-faint sm:inline">{preview(s.content)}</span>
                        <ChevronDown className="ml-auto size-4 shrink-0 text-faint transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="report-prose border-t border-border px-4 py-3">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.content}</ReactMarkdown>
                      </div>
                    </details>
                  );
                })}

                {machine.length > 0 && (
                  <>
                    <div className="mt-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-faint">
                      <span className="h-px flex-1 bg-border" />
                      Technical details · for developers
                      <span className="h-px flex-1 bg-border" />
                    </div>
                    {machine.map((s, i) => (
                      <details key={i} className="group mt-2 overflow-hidden rounded-xl border border-border/60 bg-surface/20">
                        <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-4 py-3 font-mono text-xs text-muted transition-colors hover:bg-surface-hover">
                          {cleanHeading(s.heading)}
                          <ChevronDown className="ml-auto size-4 shrink-0 text-faint transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="report-prose border-t border-border/60 px-4 py-3 opacity-80">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.content}</ReactMarkdown>
                        </div>
                      </details>
                    ))}
                  </>
                )}
              </div>
            );
          })()}
          <ScoreMethodology />
        </>
      ) : (
        <EmptyState
          className="mt-8"
          layout="inline"
          icon={FileText}
          description={<>No report file found for #{id} in <code className="text-foreground">reports/</code>.</>}
        />
      )}
    </PageShell>
  );
}
