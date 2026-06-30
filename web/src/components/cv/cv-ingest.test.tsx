// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

// useRouter() throws without a Next router context — stub it so the component mounts.
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// @/lib/fonts pulls next/font/google (Inter/Instrument_Serif), which only runs under
// the Next build pipeline. cv-ingest just reads .className, so a stub object suffices.
vi.mock("@/lib/fonts", () => ({
  inter: { className: "inter", variable: "--font-inter" },
  instrumentSerif: { className: "instrument-serif", variable: "--font-instrument-serif" },
  instrumentSerifItalic: { className: "instrument-serif-italic", variable: "--font-instrument-serif-italic" },
}));

import { CvIngest } from "./cv-ingest";

afterEach(cleanup);
beforeEach(() => push.mockClear());

// A streamable Response body: one chunk carrying a full <<cv:start>>…<<cv:end>>
// envelope so a POST that reaches the network parses cleanly into the review phase.
function streamResponse(text: string, status = 200) {
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  const reader = {
    read: async () => (sent ? { value: undefined, done: true } : ((sent = true), { value: bytes, done: false })),
  };
  return { status, ok: status >= 200 && status < 300, body: { getReader: () => reader }, json: async () => ({}) };
}

// Route by URL. /api/cli feeds the per-profile CLI selection on mount; the POST to
// /api/cv/ingest is captured so we can assert method + body (the cliId fix).
function stubFetch(opts: { selected: string | null; ingest?: ReturnType<typeof streamResponse> }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/api/cli") return { ok: true, status: 200, json: async () => ({ selected: opts.selected }) };
    if (url === "/api/cv/ingest") return opts.ingest ?? streamResponse("<<cv:start>>\n# Jane Dev\n<<cv:end>>");
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

describe("CvIngest — per-profile cliId routing", () => {
  it("fetches /api/cli on mount", async () => {
    const { fetchMock } = stubFetch({ selected: "claude" });
    render(<CvIngest />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/cli"));
  });

  it("shows the needs-cli error and does NOT POST when no CLI is selected", async () => {
    const { fetchMock, calls } = stubFetch({ selected: null });
    render(<CvIngest />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/cli"));

    const textarea = screen.getByPlaceholderText(/Paste your CV here/);
    fireEvent.change(textarea, { target: { value: "Senior Android Engineer, 5 years" } });
    fireEvent.click(screen.getByText("Read my CV"));

    // needs-cli error copy renders; no ingest POST was made. Query the unique
    // sentence (the link's "Connect your AI CLI" text appears separately too).
    expect(await screen.findByText(/To read a PDF, connect your AI CLI/i)).toBeTruthy();
    expect(calls.some((c) => c.url === "/api/cv/ingest")).toBe(false);
  });

  it("POSTs to /api/cv/ingest with the per-profile cliId when a CLI is selected", async () => {
    const { fetchMock, calls } = stubFetch({ selected: "claude" });
    render(<CvIngest />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/cli"));

    const textarea = screen.getByPlaceholderText(/Paste your CV here/);
    fireEvent.change(textarea, { target: { value: "Senior Android Engineer" } });
    fireEvent.click(screen.getByText("Read my CV"));

    await waitFor(() => expect(calls.some((c) => c.url === "/api/cv/ingest")).toBe(true));
    const post = calls.find((c) => c.url === "/api/cv/ingest")!;
    expect(post.init?.method).toBe("POST");
    expect(post.init?.headers).toMatchObject({ "Content-Type": "application/json" });
    const body = JSON.parse(post.init!.body as string);
    expect(body.cliId).toBe("claude");
    expect(body.text).toBe("Senior Android Engineer");
  });

  it("does not POST ingest when the paste is empty (button disabled)", async () => {
    const { fetchMock, calls } = stubFetch({ selected: "claude" });
    render(<CvIngest />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/cli"));

    // Read my CV is disabled until there's trimmed paste text.
    fireEvent.click(screen.getByText("Read my CV"));
    expect(calls.some((c) => c.url === "/api/cv/ingest")).toBe(false);
  });

  it("renders the friendly 404 message when ingest returns 404 (no CLI on server)", async () => {
    const { fetchMock } = stubFetch({ selected: "claude", ingest: streamResponse("", 404) });
    render(<CvIngest />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/cli"));

    fireEvent.change(screen.getByPlaceholderText(/Paste your CV here/), { target: { value: "some cv text" } });
    fireEvent.click(screen.getByText("Read my CV"));

    expect(await screen.findByText(/Connect an AI CLI in Config first/i)).toBeTruthy();
  });
});
