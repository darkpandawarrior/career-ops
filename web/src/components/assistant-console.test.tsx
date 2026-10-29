// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────────────────
// AssistantConsole pulls in next/navigation, four context providers, react-markdown
// and lucide icons. None of that is the unit under test here — we only care about
// the CLI-selection wiring (/api/cli → "via <id>" header + input enabled state).
// Mock each dependency to a minimal inert shape so the console renders standalone
// and deterministically, with no real providers, network, or ESM markdown parser.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
}));

// next/link → plain anchor so the "Pick a CLI in Config" link renders in jsdom.
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

// react-markdown / remark-gfm are ESM-heavy and irrelevant to this test — render
// children as-is so any assistant text passes through untransformed.
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));

// CoMark pulls in next/font/google (src/lib/fonts.ts), which can't load in the
// test env. Stub the logo to a trivial element — it's purely decorative here.
vi.mock("@/components/co-mark", () => ({ CoMark: () => <span data-testid="co-mark" /> }));

// WorkerCard is only reached when a worker job renders inline; stub it out so the
// jobs subtree stays inert.
vi.mock("@/components/jobs/worker-card", () => ({ WorkerCard: () => <div /> }));

// Context hooks: return the minimal shape the console reads. Empty inbox +
// applications keeps the suggestion-chip logic quiet and deterministic.
vi.mock("@/components/jobs/job-store", () => ({
  useJobs: () => ({ jobs: [], startJob: vi.fn(), removeJob: vi.fn(), clearFinished: vi.fn() }),
}));
vi.mock("@/components/pipeline/pipeline-provider", () => ({
  usePipeline: () => ({ inbox: [], applications: [], loading: false, refetch: vi.fn() }),
}));
vi.mock("@/components/apply/apply-provider", () => ({
  useApply: () => ({ fields: [], answers: {}, meta: {}, setAnswer: vi.fn(), open: vi.fn() }),
}));
vi.mock("@/components/explore/explore-provider", () => ({
  useExplore: () => ({ applyPatch: vi.fn() }),
}));

import { AssistantConsole } from "./assistant-console";

// Stub fetch so the /api/cli read inside the open-effect resolves to a chosen CLI.
// `selected` is parameterised per test.
function stubCliFetch(selected: string | null) {
  const fetchMock = vi.fn(async (url: string) => {
    if (typeof url === "string" && url === "/api/cli") {
      return { ok: true, json: async () => ({ selected }) } as unknown as Response;
    }
    return { ok: true, json: async () => ({}) } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// The launcher renders a closed bubble first; the /api/cli read only fires once
// the panel is open (effect keyed on `open`). Click "Ask" to open it.
function openConsole() {
  fireEvent.click(screen.getByRole("button", { name: /Ask/ }));
}

// jsdom doesn't implement Element.scrollTo; the console scrolls its message list
// on every messages change. Polyfill it to a no-op so the effect doesn't throw.
beforeEach(() => {
  vi.clearAllMocks();
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => {};
  } else {
    vi.spyOn(Element.prototype, "scrollTo").mockImplementation(() => {});
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AssistantConsole — CLI selection wiring", () => {
  it("shows 'via <cli>' and enables the input when /api/cli returns a selected CLI", async () => {
    const fetchMock = stubCliFetch("claude");
    render(<AssistantConsole />);
    openConsole();

    // Header subtitle reflects the per-profile CLI returned by the server.
    expect(await screen.findByText("via claude")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/cli");

    // With a CLI configured, the composer textarea is enabled and the
    // "configure first" placeholder is gone.
    const textarea = screen.getByPlaceholderText("Ask anything…") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
  });

  it("shows 'no CLI configured' and disables the input when /api/cli returns selected:null", async () => {
    stubCliFetch(null);
    render(<AssistantConsole />);
    openConsole();

    // No CLI → the disabled-state subtitle and the Config nudge appear.
    expect(await screen.findByText("no CLI configured")).toBeTruthy();
    expect(screen.getByText(/Pick a CLI in Config to enable the assistant/)).toBeTruthy();

    // Composer is disabled and shows the "configure first" placeholder instead.
    const textarea = screen.getByPlaceholderText("Configure a CLI first") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it("falls back to localStorage cliId when the /api/cli fetch throws", async () => {
    // Server detection unavailable → the effect's catch falls back to the
    // CONFIG_KEY localStorage entry ("career-ops:config").
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    localStorage.setItem("career-ops:config", JSON.stringify({ cliId: "codex" }));

    render(<AssistantConsole />);
    openConsole();

    expect(await screen.findByText("via codex")).toBeTruthy();
  });

  it("shows 'no CLI configured' when fetch throws and localStorage is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    render(<AssistantConsole />);
    openConsole();

    expect(await screen.findByText("no CLI configured")).toBeTruthy();
  });

  it("renders the greeting message once the console opens", async () => {
    stubCliFetch("claude");
    render(<AssistantConsole />);
    openConsole();

    // The greeting seeds the first assistant message when opened with no history.
    expect(await screen.findByText(/I'm your career-ops assistant/)).toBeTruthy();
  });

  it("reads /api/cli on mount (the open-keyed effect also runs on first render)", async () => {
    // The CLI-read effect is keyed on `open`, but a keyed effect still runs once
    // on mount — so /api/cli is read immediately, while the console is still the
    // closed bubble. Asserting current behavior (the panel body is not yet shown).
    const fetchMock = stubCliFetch("claude");
    render(<AssistantConsole />);

    // Closed: only the "Ask" launcher is on screen (no header subtitle yet).
    expect(screen.getByRole("button", { name: /Ask/ })).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/cli"));
    expect(screen.queryByText("via claude")).toBeNull();

    // Opening then surfaces the header subtitle from the same selection.
    openConsole();
    expect(await screen.findByText("via claude")).toBeTruthy();
  });
});
