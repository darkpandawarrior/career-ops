// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

// @/lib/fonts pulls next/font/google (Inter/Instrument_Serif), which only runs
// under the Next build pipeline. The view just reads .className, so a plain stub
// object suffices (same pattern as cv-ingest.test.tsx).
vi.mock("@/lib/fonts", () => ({
  inter: { className: "inter", variable: "--font-inter" },
  instrumentSerif: { className: "instrument-serif", variable: "--font-instrument-serif" },
  instrumentSerifItalic: { className: "instrument-serif-italic", variable: "--font-instrument-serif-italic" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/explore",
  useSearchParams: () => new URLSearchParams(),
}));

// next/link renders an <a> in the real app; under jsdom we just want children +
// href through, so a thin passthrough keeps the BlockedCard/FailedCard links happy.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ExplorerView } from "./explorer-view";
import { ExploreProvider } from "./explore-provider";
import { DEFAULT_FILTERS, type ExploreFilters } from "@/lib/explore";

afterEach(cleanup);

// /api/cli is fetched on mount (active-profile CLI). Default: a configured Claude
// CLI, so the AI-search segment is unlocked and the "needs a CLI" hint is absent.
function stubCli(selected: string | null = "claude") {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/cli") return { ok: true, status: 200, json: async () => ({ selected }) };
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// A seed with a real positive role keyword — the "Roles to find" field renders it
// as an "inc" chip, and the "Seeded from your … — edit freely" hint appears.
const seed: { filters: ExploreFilters; seededFrom: string[] } = {
  filters: { ...DEFAULT_FILTERS, positive: ["Staff Engineer"] },
  seededFrom: ["CV"],
};

function renderView(overrides?: { rootExists?: boolean; selected?: string | null }) {
  stubCli(overrides?.selected ?? "claude");
  return render(
    <ExploreProvider>
      <ExplorerView
        seed={seed}
        inboxSnapshot={[]}
        appsSnapshot={[]}
        rootExists={overrides?.rootExists ?? true}
      />
    </ExploreProvider>,
  );
}

describe("ExplorerView — scan surface (seeded)", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("renders the Explore header and the Scan / AI search mode toggle", async () => {
    renderView();
    // Page heading — the editorial "Explore" title.
    expect(await screen.findByText("Explore")).toBeTruthy();
    // The mode toggle exposes both segments.
    expect(screen.getByText("Scan")).toBeTruthy();
    expect(screen.getByText("AI search")).toBeTruthy();
  });

  it("seeds the 'Roles to find' field from the seed prop", async () => {
    renderView();
    // The FilterBuilder label.
    expect(await screen.findByText("Roles to find")).toBeTruthy();
    // The seeded positive keyword renders as a chip in that field…
    expect(screen.getByText("Staff Engineer")).toBeTruthy();
    // …and a Remove control proves it's a live chip, not placeholder text.
    expect(screen.getByLabelText("Remove Staff Engineer")).toBeTruthy();
    // The "seeded from" provenance line appears (positive present + seededFrom set).
    expect(screen.getByText(/Seeded from your CV/)).toBeTruthy();
  });

  it("shows the Discover (free) action on the default (non-results) surface", async () => {
    renderView();
    expect(await screen.findByText("Discover (free)")).toBeTruthy();
    // Cost-honesty copy that rides alongside the Discover button.
    expect(screen.getByText(/Discovering never does/)).toBeTruthy();
  });

  it("waits for /api/cli on mount (active-profile CLI source of truth)", async () => {
    renderView();
    await screen.findByText("Roles to find");
    // The mount effect must have queried the per-profile CLI endpoint.
    await waitFor(() => {
      expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("/api/cli");
    });
  });

  it("surfaces the 'home isn't set up' notice when rootExists is false", async () => {
    renderView({ rootExists: false });
    expect(await screen.findByText(/career-ops home/i)).toBeTruthy();
  });

  it("does NOT show the rootExists notice when the home is set up", async () => {
    renderView({ rootExists: true });
    await screen.findByText("Roles to find");
    expect(screen.queryByText(/career-ops home isn/i)).toBeNull();
  });
});
