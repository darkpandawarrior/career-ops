import { ConfigForm } from "@/components/config-form";

// Per-profile content (the form fetches /api/cli for the active profile). Render
// at request time so a production build never serves one profile's cached shell
// to another — consistent with every other profile-aware page.
export const dynamic = "force-dynamic";

export default function ConfigPage() {
  return <ConfigForm />;
}
