// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PortfolioView } from "./portfolio-view";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Build a ReadableStream of UTF-8 bytes from ndjson lines — exactly what the
// /api/portfolio/generate route streams and the view parses line-by-line.
function ndjsonStream(lines: object[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(body));
      controller.close();
    },
  });
}

// fetch router: /api/cli returns the selected CLI; /api/portfolio/generate streams
// the supplied ndjson; everything else returns an empty json object.
function stubFetch(opts: {
  selected?: string | null;
  generate?: object[];
  generateOk?: boolean;
}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/api/cli") {
      return { ok: true, json: async () => ({ selected: opts.selected ?? null }) };
    }
    if (url === "/api/portfolio/generate") {
      if (opts.generateOk === false) {
        return { ok: false, body: null, json: async () => ({ error: "boom" }) };
      }
      return { ok: true, body: ndjsonStream(opts.generate ?? []) };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

describe("PortfolioView — gating states", () => {
  it("with hasCv=false shows the 'Add your CV first' gate", async () => {
    stubFetch({ selected: "claude" });
    render(<PortfolioView hasCv={false} initialHtml="" initialExists={false} />);
    expect(await screen.findByText("Add your CV first")).toBeTruthy();
  });

  it("with no CLI selected shows the 'Connect an AI CLI' gate", async () => {
    stubFetch({ selected: null });
    render(<PortfolioView hasCv={true} initialHtml="" initialExists={false} />);
    expect(await screen.findByText("Connect an AI CLI")).toBeTruthy();
  });

  it("with hasCv + a CLI + no draft shows the Generate portfolio CTA", async () => {
    stubFetch({ selected: "claude" });
    render(<PortfolioView hasCv={true} initialHtml="" initialExists={false} />);
    expect(await screen.findByText("Generate portfolio")).toBeTruthy();
  });
});

describe("PortfolioView — generate → preview flow", () => {
  it("streams generate, then shows the preview iframe and Export ZIP", async () => {
    const { fetchMock, calls } = stubFetch({
      selected: "claude",
      generate: [{ kind: "done", html: "<x>HELLO</x>", data: { name: "A" } }],
    });

    const { container } = render(
      <PortfolioView hasCv={true} initialHtml="" initialExists={false} />,
    );

    // Wait for the CLI to load → the Generate CTA appears.
    const cta = await screen.findByText("Generate portfolio");

    fireEvent.click(cta);

    // The preview action bar appears once the stream's done line is parsed.
    expect(await screen.findByText("Export ZIP")).toBeTruthy();

    // The generate endpoint was POSTed with the resolved cliId.
    const gen = calls.find((c) => c.url === "/api/portfolio/generate");
    expect(gen).toBeTruthy();
    expect(gen!.init?.method).toBe("POST");
    expect(JSON.parse(gen!.init!.body as string).cliId).toBe("claude");

    // The streamed html lands in the sandboxed preview iframe's srcDoc.
    await waitFor(() => {
      const iframe = container.querySelector("iframe");
      expect(iframe).toBeTruthy();
      expect(iframe!.getAttribute("srcdoc")).toBe("<x>HELLO</x>");
      expect(iframe!.getAttribute("sandbox")).toBe("");
    });

    // Export ZIP links to the export route.
    const exportLink = screen.getByText("Export ZIP").closest("a");
    expect(exportLink?.getAttribute("href")).toBe("/api/portfolio/export");

    expect(fetchMock).toHaveBeenCalledWith("/api/cli");
  });

  it("reflects a status line in the generating trace before completing", async () => {
    stubFetch({
      selected: "claude",
      generate: [
        { kind: "status", label: "Reading your CV…" },
        { kind: "done", html: "<x>DONE</x>", data: { name: "A" } },
      ],
    });

    render(<PortfolioView hasCv={true} initialHtml="" initialExists={false} />);
    const cta = await screen.findByText("Generate portfolio");
    fireEvent.click(cta);

    // Lands on preview after the done line.
    expect(await screen.findByText("Export ZIP")).toBeTruthy();
  });

  it("shows the error state when generate responds not-ok", async () => {
    stubFetch({ selected: "claude", generateOk: false });

    render(<PortfolioView hasCv={true} initialHtml="" initialExists={false} />);
    const cta = await screen.findByText("Generate portfolio");
    fireEvent.click(cta);

    expect(await screen.findByText("That didn't work")).toBeTruthy();
    expect(screen.getByText("boom")).toBeTruthy();
  });
});

describe("PortfolioView — existing draft", () => {
  it("with initialExists=true renders the preview immediately with the initial html", async () => {
    stubFetch({ selected: "claude" });
    const { container } = render(
      <PortfolioView hasCv={true} initialHtml="<x>SAVED</x>" initialExists={true} />,
    );

    expect(await screen.findByText("Export ZIP")).toBeTruthy();
    const iframe = container.querySelector("iframe")!;
    expect(iframe.getAttribute("srcdoc")).toBe("<x>SAVED</x>");
  });
});
