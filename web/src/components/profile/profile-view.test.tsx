// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ProfileView } from "./profile-view";
import { emptyFullProfile, type FullProfile, type ProfileMdSection } from "@/lib/full-profile";

afterEach(cleanup);

function stubFetch(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body })),
  );
}

const fixtureProfile: FullProfile = {
  ...emptyFullProfile(),
  candidate: { ...emptyFullProfile().candidate, full_name: "Alex Doe", email: "alex@example.com" },
  target_roles: {
    primary: ["Senior Android Engineer"],
    archetypes: [{ name: "Senior/Lead Android", level: "Senior", fit: "primary" }],
  },
  narrative: {
    headline: "Android engineer targeting Lead",
    exit_story: "Owns a large production app end-to-end.",
    superpowers: ["Jetpack Compose", "Location Engineering"],
    proof_points: [{ name: "Crash reduction", url: "", hero_metric: "80% crash reduction" }],
  },
  compensation: { target_range: "45L-70L", currency: "INR", minimum: "35L", location_flexibility: "Remote preferred" },
};

const fixtureSections: ProfileMdSection[] = [
  { title: "Known Gaps", body: "DSA rounds are the structural risk." },
];

describe("ProfileView — loading & error states", () => {
  it("shows a loading indicator before the fetch resolves", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<ProfileView />);
    expect(screen.getByText(/Loading profile/i)).toBeTruthy();
  });

  it("shows an empty state when config/profile.yml does not exist", async () => {
    stubFetch({ exists: false, profile: emptyFullProfile(), sections: [] });
    render(<ProfileView />);
    expect(await screen.findByText(/No/i)).toBeTruthy();
    expect(screen.getByText(/config\/profile\.yml/)).toBeTruthy();
  });

  it("shows an error message when the fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    render(<ProfileView />);
    expect(await screen.findByText(/Couldn't load the profile/i)).toBeTruthy();
  });
});

describe("ProfileView — full profile render", () => {
  it("renders candidate, narrative, comp, and archetype fields without crashing", async () => {
    stubFetch({ exists: true, profile: fixtureProfile, sections: fixtureSections });
    render(<ProfileView />);

    expect(await screen.findByText("Alex Doe")).toBeTruthy();
    expect(screen.getByText("alex@example.com")).toBeTruthy();
    expect(screen.getByText("Android engineer targeting Lead")).toBeTruthy();
    expect(screen.getByText("Senior/Lead Android")).toBeTruthy();
    expect(screen.getByText("primary")).toBeTruthy();
    expect(screen.getByText("45L-70L")).toBeTruthy();
    expect(screen.getByText("Jetpack Compose")).toBeTruthy();
    expect(screen.getByText("Known Gaps")).toBeTruthy();
  });
});
