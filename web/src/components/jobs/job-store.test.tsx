// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { JobsProvider, useJobs, type Job } from "./job-store";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Tiny consumer: fires startJob on click and renders the live job state so the
// test can observe how the worker dispatch resolves (CLI lookup -> /api/run).
function Harness({ kind = "evaluate" }: { kind?: string }) {
  const { jobs, startJob } = useJobs();
  const job: Job | undefined = jobs[0];
  return (
    <div>
      <button
        onClick={() => startJob({ title: "Evaluate Anthropic", kind, input: "https://job.example/anthropic" })}
      >
        run-job
      </button>
      {job ? (
        <div>
          <span data-testid="status">{job.status}</span>
          <span data-testid="last-step">{job.steps[job.steps.length - 1]?.label ?? ""}</span>
          <span data-testid="all-steps">{job.steps.map((s) => s.label).join("|")}</span>
          <span data-testid="text">{job.text}</span>
        </div>
      ) : (
        <span data-testid="status">none</span>
      )}
    </div>
  );
}

function renderHarness(kind?: string) {
  return render(
    <JobsProvider>
      <Harness kind={kind} />
    </JobsProvider>,
  );
}

// Build a /api/run-style streaming Response: NDJSON event lines fed through a
// ReadableStream, exactly what `res.body.getReader()` + TextDecoder expect.
function streamResponse(lines: string[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const line of lines) controller.enqueue(enc.encode(line + "\n"));
      controller.close();
    },
  });
  return { ok: true, body, json: async () => ({}) };
}

// Routes fetch() by URL so a single mock serves both endpoints the worker hits.
function mockFetch(opts: {
  selected: string | null;
  runLines?: string[];
  runOk?: boolean;
  runError?: string;
}) {
  const calls: { url: string; body?: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url === "/api/cli") {
      return { ok: true, json: async () => ({ selected: opts.selected }) };
    }
    if (url === "/api/run") {
      if (opts.runOk === false) {
        return { ok: false, body: null, json: async () => ({ error: opts.runError ?? "boom" }) };
      }
      return streamResponse(opts.runLines ?? []);
    }
    if (url === "/api/runs/save") {
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

describe("JobsProvider.startJob — per-profile worker dispatch", () => {
  it("with a profile CLI selected, does NOT immediately error with 'No CLI configured'", async () => {
    // /api/run streams a verdict so the job completes the happy path.
    const { fetchMock } = mockFetch({
      selected: "claude",
      runLines: [
        JSON.stringify({ type: "status", label: "Reading posting" }),
        JSON.stringify({ type: "text", text: "VERDICT: 4.3 / 5 — strong fit" }),
        JSON.stringify({ type: "done" }),
      ],
    });

    renderHarness();
    fireEvent.click(screen.getByText("run-job"));

    // It must resolve the CLI from /api/cli, never the 'No CLI configured' branch.
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("done"));

    const allSteps = screen.getByTestId("all-steps").textContent ?? "";
    expect(allSteps).not.toContain("No CLI configured");
    expect(fetchMock).toHaveBeenCalledWith("/api/cli");
    // The worker was actually dispatched to /api/run (the fix: it gets that far).
    expect(fetchMock).toHaveBeenCalledWith("/api/run", expect.anything());
  });

  it("forwards the resolved cliId to /api/run in the request body", async () => {
    const { calls } = mockFetch({
      selected: "claude",
      runLines: [JSON.stringify({ type: "done" })],
    });

    renderHarness();
    fireEvent.click(screen.getByText("run-job"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("done"));

    const runCall = calls.find((c) => c.url === "/api/run");
    expect(runCall).toBeTruthy();
    expect(runCall!.body).toMatchObject({ cliId: "claude", kind: "evaluate", input: "https://job.example/anthropic" });
  });

  it("with /api/cli selected:null, ends in error 'No CLI configured — open Config' and never calls /api/run", async () => {
    const { fetchMock } = mockFetch({ selected: null });

    renderHarness();
    fireEvent.click(screen.getByText("run-job"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
    expect(screen.getByTestId("last-step").textContent).toBe("No CLI configured — open Config");

    // The worker short-circuits before dispatch — /api/run is never reached.
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain("/api/cli");
    expect(urls).not.toContain("/api/run");
  });

  it("a thrown /api/cli fetch is treated as 'no CLI' and errors the same way", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/cli") throw new Error("offline");
      return { ok: true, body: null, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHarness();
    fireEvent.click(screen.getByText("run-job"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
    expect(screen.getByTestId("last-step").textContent).toBe("No CLI configured — open Config");
  });

  it("streams tool/status/text events from /api/run into the job before finishing", async () => {
    mockFetch({
      selected: "claude",
      runLines: [
        JSON.stringify({ type: "tool", name: "web_search" }),
        JSON.stringify({ type: "status", label: "Scoring" }),
        JSON.stringify({ type: "text", text: "partial output" }),
        JSON.stringify({ type: "done" }),
      ],
    });

    renderHarness();
    fireEvent.click(screen.getByText("run-job"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("done"));

    const allSteps = screen.getByTestId("all-steps").textContent ?? "";
    expect(allSteps).toContain("web_search"); // tool step
    expect(allSteps).toContain("Scoring"); // status step
    expect(allSteps.endsWith("Done")).toBe(true); // finish label
    expect(screen.getByTestId("text").textContent).toContain("partial output");
  });

  it("surfaces an /api/run non-ok response as a job error (after CLI resolves)", async () => {
    mockFetch({ selected: "claude", runOk: false, runError: "rate limited" });

    renderHarness();
    fireEvent.click(screen.getByText("run-job"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
    // This is the post-dispatch failure path, NOT the 'No CLI configured' branch.
    expect(screen.getByTestId("last-step").textContent).toBe("rate limited");
  });

  it("propagates an in-stream {type:'error'} event as a job error", async () => {
    mockFetch({
      selected: "claude",
      runLines: [
        JSON.stringify({ type: "status", label: "Working" }),
        JSON.stringify({ type: "error", msg: "model exploded" }),
      ],
    });

    renderHarness();
    fireEvent.click(screen.getByText("run-job"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
    expect(screen.getByTestId("last-step").textContent).toBe("model exploded");
  });
});
