import { Send } from "lucide-react";
import { ApplyView } from "@/components/apply-view";
import { ApplyBackdropMount } from "@/components/apply/apply-backdrop-mount";
import { PageShell, PageHeader } from "@/components/ui/page-shell";

export const dynamic = "force-dynamic";

export default function ApplyPage() {
  return (
    <div className="relative min-h-screen">
      {/* full-viewport blurred form wallpaper (behind everything) */}
      <ApplyBackdropMount />
      <PageShell maxWidth="3xl" className="relative z-10">
        <PageHeader
          icon={Send}
          title="Apply"
          description="career-ops reads the real application form on your machine and re-renders it here in plain language, pre-filled from your CV. You verify every answer — then it fills the real form behind the scenes and you submit it yourself. It never submits for you."
        />
        <div className="mt-6">
          <ApplyView />
        </div>
      </PageShell>
    </div>
  );
}
