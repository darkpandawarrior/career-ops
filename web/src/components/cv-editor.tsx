"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { SkillGaps } from "@/components/skill-gaps";
import remarkGfm from "remark-gfm";
import { Check, Loader2, FolderGit2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { RunModeButton } from "@/components/ui/run-mode-button";
import { PageShell, PageHeader } from "@/components/ui/page-shell";

export function CvEditor() {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [exists, setExists] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/cv")
      .then((r) => r.json())
      .then((d) => {
        setContent(d.content ?? "");
        setExists(d.exists ?? false);
      })
      .catch(() => setError("Couldn't load cv.md."))
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/cv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        setError("");
        setDirty(false);
        setExists(true);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        // The skill-gap panel below reads cv.md to subtract skills the user
        // already has, so a save changes its answer. Announced rather than
        // wired directly, following the co-job-done convention, so the panel
        // stays a listener and this stays a save.
        window.dispatchEvent(new CustomEvent("co-cv-saved"));
      } else {
        setError("Couldn't save cv.md — try again.");
      }
    } catch {
      setError("Couldn't save cv.md — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell maxWidth="6xl">
      <PageHeader
        title="CV editor"
        description={
          <>
            Edit <code className="text-foreground">cv.md</code> with live preview.
            {!exists && loaded && <span className="ml-1 text-faint">No cv.md yet — start typing to create it.</span>}
            {error && <span className="ml-1 text-red-500">{error}</span>}
          </>
        }
        actions={
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-colors max-sm:min-h-[44px]",
              dirty
                ? "bg-brand text-brand-foreground hover:bg-brand-200"
                : "border border-border bg-surface text-muted",
            )}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
            {saved ? "Saved" : "Save"}
          </button>
        }
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <RunModeButton
          icon={FolderGit2}
          label="Pull competencies from GitHub"
          message="Run expand mode — discover competencies from my GitHub/portfolio and add them to cv.md or article-digest.md."
        />
      </div>

      {!loaded ? (
        <div className="mt-6 text-sm text-muted">Loading…</div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setDirty(true);
            }}
            spellCheck={false}
            placeholder="# Your Name&#10;&#10;## Summary&#10;..."
            className="min-h-[60vh] w-full resize-none rounded-2xl border border-border bg-surface/50 p-4 font-mono text-sm leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-brand/40"
          />
          <article className="report-prose min-h-[60vh] overflow-auto rounded-2xl border border-border bg-surface/30 p-5">
            {content.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            ) : (
              <p className="text-muted">Preview appears here.</p>
            )}
          </article>
        </div>
      )}

      {/* Below the editor: the gaps are context for what to write next, and they
          belong after the document rather than competing with it. */}
      <SkillGaps />
    </PageShell>
  );
}
