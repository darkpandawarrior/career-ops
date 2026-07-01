import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

export const dynamic = "force-dynamic";

// Resume onboarding — paste resume text → the real inference engine drafts a
// profile → review → activate writes the canonical user files into the active
// profile root. Multi-step, streaming-free (the inference is fast + deterministic).
export default function OnboardingPage() {
  return <OnboardingFlow />;
}
