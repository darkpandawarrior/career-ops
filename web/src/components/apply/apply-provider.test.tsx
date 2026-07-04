// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";

import { ApplyProvider, useApply } from "./apply-provider";

afterEach(cleanup);

// A single hidden component that exposes the context + a couple of trigger
// buttons — cheaper than a full ApplyView render for exercising queue-only
// state transitions in the provider.
function Probe() {
  const a = useApply();
  return (
    <div>
      <span data-testid="status">{a.status}</span>
      <span data-testid="queue-pos">{a.queue.length ? `${a.queueIndex + 1}/${a.queue.length}` : "none"}</span>
      <span data-testid="company">{a.company}</span>
      <span data-testid="submit-detected">{String(a.submitDetected)}</span>
      <button onClick={() => void a.startQueue([
        { n: "1", url: "https://ex.co/a", title: "Role A", company: "Acme" },
        { n: "2", url: "https://ex.co/b", title: "Role B", company: "Beta" },
      ])}>
        start
      </button>
      <button onClick={() => void a.queueNext()}>next</button>
      <button onClick={a.stopQueue}>stop</button>
    </div>
  );
}

function fetchMock() {
  let sessionN = 0;
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/cli") return { ok: true, status: 200, json: async () => ({ selected: "claude" }) };
    if (url === "/api/apply/session") {
      sessionN += 1;
      const body = JSON.parse(String(init?.body ?? "{}"));
      return { ok: true, status: 200, json: async () => ({ id: `sess-${sessionN}`, title: `Form for ${body.url}`, fields: [], issues: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

function renderProbe() {
  const fm = fetchMock();
  vi.stubGlobal("fetch", fm);
  const utils = render(
    <ApplyProvider>
      <Probe />
    </ApplyProvider>,
  );
  return { fm, ...utils };
}

describe("ApplyProvider — batch queue (additive to the single-job flow)", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("opens the FIRST queued item via the existing /api/apply/session path", async () => {
    renderProbe();
    await act(async () => {
      screen.getByText("start").click();
    });
    await waitFor(() => expect(screen.getByTestId("queue-pos").textContent).toBe("1/2"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
    expect(screen.getByTestId("company").textContent).toBe("Acme");
  });

  it("queueNext advances to the SECOND item and re-opens a session for it", async () => {
    renderProbe();
    await act(async () => {
      screen.getByText("start").click();
    });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));

    await act(async () => {
      screen.getByText("next").click();
    });
    await waitFor(() => expect(screen.getByTestId("queue-pos").textContent).toBe("2/2"));
    await waitFor(() => expect(screen.getByTestId("company").textContent).toBe("Beta"));
  });

  it("queueNext past the last item stops advancing (index still increments for UI, no further open)", async () => {
    const { fm } = renderProbe();
    await act(async () => {
      screen.getByText("start").click();
    });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
    await act(async () => {
      screen.getByText("next").click();
    });
    await waitFor(() => expect(screen.getByTestId("queue-pos").textContent).toBe("2/2"));
    const callsBefore = fm.mock.calls.filter((c) => c[0] === "/api/apply/session").length;
    await act(async () => {
      screen.getByText("next").click();
    });
    // no 3rd item exists → no additional /api/apply/session call
    const callsAfter = fm.mock.calls.filter((c) => c[0] === "/api/apply/session").length;
    expect(callsAfter).toBe(callsBefore);
  });

  it("stopQueue clears the queue without touching the current session", async () => {
    renderProbe();
    await act(async () => {
      screen.getByText("start").click();
    });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
    await act(async () => {
      screen.getByText("stop").click();
    });
    expect(screen.getByTestId("queue-pos").textContent).toBe("none");
    // the open session's fields/status are untouched by leaving queue mode
    expect(screen.getByTestId("status").textContent).toBe("ready");
  });

  it("submitDetected starts false and is never set without a page-url poll signal", async () => {
    renderProbe();
    expect(screen.getByTestId("submit-detected").textContent).toBe("false");
  });
});
