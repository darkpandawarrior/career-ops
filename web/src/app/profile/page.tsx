import { UserRound } from "lucide-react";
import { ProfileView } from "@/components/profile/profile-view";
import { PageShell, PageHeader } from "@/components/ui/page-shell";

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  return (
    <PageShell maxWidth="4xl">
      <PageHeader
        icon={UserRound}
        title="Profile"
        description={
          <>
            What the AI currently believes about you — the full <code className="text-foreground">config/profile.yml</code>{" "}
            schema plus the narrative content in <code className="text-foreground">modes/_profile.md</code> (archetypes,
            comp tiers, negotiation scripts, known gaps). Read-only for now — edit those files directly, or ask the
            assistant to update them.
          </>
        }
      />
      <div className="mt-6">
        <ProfileView />
      </div>
    </PageShell>
  );
}
