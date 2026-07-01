// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { OnboardingBanner } from "./onboarding-banner";

afterEach(cleanup);

// The banner fires two fetches on mount: /api/cli (per-profile CLI selection) and
// /api/doctor (onboarding state). We route by URL so each test controls both.
function stubFetch(routes: { cli?: unknown; doctor?: unknown; cliThrows?: boolean }) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/cli") {
      if (routes.cliThrows) throw new Error("offline");
      return { ok: true, json: async () => routes.cli ?? {} };
    }
    if (url === "/api/doctor") return { ok: true, json: async () => routes.doctor ?? {} };
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const onboardingDoctor = {
  available: true,
  onboardingNeeded: true,
  missing: ["cv.md"],
  warnings: [],
};

describe("OnboardingBanner — per-profile CLI + doctor on mount", () => {
  it("fetches both /api/cli and /api/doctor on mount", async () => {
    const fetchMock = stubFetch({ cli: { selected: "claude" }, doctor: onboardingDoctor });
    render(<OnboardingBanner />);
    await screen.findByText("Let's finish setting you up");
    expect(fetchMock).toHaveBeenCalledWith("/api/cli");
    expect(fetchMock).toHaveBeenCalledWith("/api/doctor");
  });

  it("shows the assistant CTA when onboarding is needed AND a CLI is selected", async () => {
    stubFetch({ cli: { selected: "claude" }, doctor: onboardingDoctor });
    render(<OnboardingBanner />);
    // selected CLI present -> conversational kickoff button, NOT the connect link.
    expect(await screen.findByText("Set me up with the assistant")).toBeTruthy();
    expect(screen.queryByText("Connect your AI CLI to get started")).toBeNull();
  });

  it("shows the 'Connect your AI CLI' link when no CLI is selected (selected null)", async () => {
    stubFetch({ cli: { selected: null }, doctor: onboardingDoctor });
    render(<OnboardingBanner />);
    // No selected CLI -> the assistant can't run, so route them to /config first.
    const link = await screen.findByText("Connect your AI CLI to get started");
    expect(link).toBeTruthy();
    expect(link.closest("a")?.getAttribute("href")).toBe("/config");
    expect(screen.queryByText("Set me up with the assistant")).toBeNull();
  });

  it("renders the missing-files copy from doctor.missing", async () => {
    stubFetch({ cli: { selected: "claude" }, doctor: onboardingDoctor });
    render(<OnboardingBanner />);
    // "cv.md" maps to the friendly label "your CV".
    expect(await screen.findByText(/your CV/)).toBeTruthy();
  });

  it("renders nothing when onboarding is not needed", async () => {
    stubFetch({
      cli: { selected: "claude" },
      doctor: { available: true, onboardingNeeded: false, missing: [], warnings: [] },
    });
    const { container } = render(<OnboardingBanner />);
    // Give the mounted fetches a chance to resolve, then assert empty render.
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("/api/doctor"));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("h2")).toBeNull();
  });

  it("survives an /api/cli fetch failure without crashing (still shows banner from doctor)", async () => {
    // cli throws -> cli stays at its optimistic default (true) -> assistant CTA shown.
    stubFetch({ cliThrows: true, doctor: onboardingDoctor });
    render(<OnboardingBanner />);
    expect(await screen.findByText("Let's finish setting you up")).toBeTruthy();
  });
});
