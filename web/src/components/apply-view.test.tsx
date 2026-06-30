// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

import { ApplyView } from "./apply-view";
import { ApplyProvider } from "@/components/apply/apply-provider";

afterEach(cleanup);

// ApplyProvider resolves the active-profile CLI from /api/cli on mount. Stub it so
// the provider mounts cleanly; the idle form shell never depends on the result.
function stubCli(selected: string | null = "claude") {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/cli") return { ok: true, status: 200, json: async () => ({ selected }) };
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderView(selected: string | null = "claude") {
  const fetchMock = stubCli(selected);
  const utils = render(
    <ApplyProvider>
      <ApplyView />
    </ApplyProvider>,
  );
  return { fetchMock, ...utils };
}

describe("ApplyView — idle form-proxy shell", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("renders the URL-input shell with the 'Read form' CTA at idle", async () => {
    renderView();
    // The primary entry CTA — paste a form URL, read it.
    expect(await screen.findByText("Read form")).toBeTruthy();
    // The URL input carries its guiding placeholder (ATS examples).
    expect(screen.getByPlaceholderText(/Paste an application form URL/i)).toBeTruthy();
  });

  it("resolves the active-profile CLI from /api/cli on mount", async () => {
    renderView();
    await screen.findByText("Read form");
    await waitFor(() => {
      expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("/api/cli");
    });
  });

  it("mounts cleanly even when no CLI is configured for the profile", async () => {
    renderView(null);
    // The idle shell is CLI-independent — the form-URL entry still renders.
    expect(await screen.findByText("Read form")).toBeTruthy();
    expect(screen.getByPlaceholderText(/Paste an application form URL/i)).toBeTruthy();
  });

  it("survives an /api/cli fetch failure without crashing the shell", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    render(
      <ApplyProvider>
        <ApplyView />
      </ApplyProvider>,
    );
    // The catch in the mount effect keeps the idle shell rendering.
    expect(await screen.findByText("Read form")).toBeTruthy();
  });
});
