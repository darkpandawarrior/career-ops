import { UserRound } from "lucide-react";
import { ProfileView } from "@/components/profile/profile-view";

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-center gap-3">
        <UserRound className="size-6 text-brand" />
        <h1 className="font-display text-2xl tracking-tight text-landing">Profile</h1>
      </div>
      <p className="mt-1.5 max-w-xl text-sm text-muted">
        What the AI currently believes about you — the full <code className="text-foreground">config/profile.yml</code>{" "}
        schema plus the narrative content in <code className="text-foreground">modes/_profile.md</code> (archetypes,
        comp tiers, negotiation scripts, known gaps). Read-only for now — edit those files directly, or ask the
        assistant to update them.
      </p>
      <div className="mt-6">
        <ProfileView />
      </div>
    </div>
  );
}
