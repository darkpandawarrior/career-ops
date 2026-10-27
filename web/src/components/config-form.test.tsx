// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { ConfigForm } from "./config-form";

// ConfigForm now renders CadenceSettings, which calls useRouter() and needs a mounted app router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

const cliResponse = {
  clis: [
    { id: "claude", name: "Claude Code", run: "claude -p", url: "x", installed: true, path: "/bin/claude" },
    { id: "codex", name: "Codex", run: "codex exec", url: "y", installed: false, path: null },
  ],
  selected: "claude",
};

describe("ConfigForm — per-profile CLI via /api/cli", () => {
  it("loads detected CLIs + the profile's selected CLI from /api/cli on mount", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => cliResponse }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ConfigForm />);

    // Assert on the unique run-command text (the display name appears twice — once
    // as the row label, once in the "Best on Claude Code" recommendation).
    expect(await screen.findByText("claude -p")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/cli");
    // The detected-but-uninstalled CLI is still listed (with an Install link).
    expect(screen.getByText("codex exec")).toBeTruthy();
  });

  it("persists the chosen CLI to the server (POST /api/cli) on Save", async () => {
    const calls: { url: string; opts?: { method?: string; body?: string } }[] = [];
    const fetchMock = vi.fn(async (url: string, opts?: { method?: string; body?: string }) => {
      calls.push({ url, opts });
      if (url === "/api/cli" && !opts) return { ok: true, json: async () => cliResponse };
      return { ok: true, json: async () => ({ ok: true }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ConfigForm />);
    await screen.findByText("claude -p");

    fireEvent.click(screen.getByText("Save config"));

    await waitFor(() => {
      const post = calls.find((c) => c.url === "/api/cli" && c.opts?.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(post!.opts!.body!)).toEqual({ cliId: "claude" });
    });
  });

  it("survives an /api/cli fetch failure without crashing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<ConfigForm />);
    // The static engine heading still renders even when detection fails.
    expect(await screen.findByText("Config")).toBeTruthy();
  });
});
