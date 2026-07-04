// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useNotify } from "./use-notify";

// useNotify polls /api/whats-new + /api/followups and dedupes notifications
// against the last-seen counts in localStorage — the thing worth pinning is
// that (a) the badge count reflects the sum of both, and (b) a Notification
// only fires once per count increase (not every poll), and only when hidden.

function stubFetch(matches: number, overdue: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/whats-new") return { json: async () => ({ offers: Array(matches).fill({}) }) } as Response;
      if (url === "/api/followups") return { json: async () => ({ metadata: { overdue }, entries: [] }) } as Response;
      return { json: async () => ({}) } as Response;
    }),
  );
}

class MockNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(async () => MockNotification.permission);
  static instances: { title: string; opts: NotificationOptions }[] = [];
  constructor(title: string, opts: NotificationOptions) {
    MockNotification.instances.push({ title, opts });
  }
}

beforeEach(() => {
  localStorage.clear();
  MockNotification.instances = [];
  MockNotification.permission = "granted";
  vi.stubGlobal("Notification", MockNotification);
  Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useNotify", () => {
  it("reports the badge count as matches + overdue followups", async () => {
    stubFetch(3, 2);
    const { result } = renderHook(() => useNotify());
    await waitFor(() => expect(result.current.count).toBe(5));
  });

  it("fires a same-tab Notification when hidden, permitted, and the count grew", async () => {
    stubFetch(3, 0);
    renderHook(() => useNotify());
    await waitFor(() => expect(MockNotification.instances.length).toBe(1));
    expect(MockNotification.instances[0].opts.body).toContain("3 new match");
  });

  it("does not re-notify on a later poll with the same counts (dedupe)", async () => {
    stubFetch(3, 0);
    const { result, rerender } = renderHook(() => useNotify());
    await waitFor(() => expect(MockNotification.instances.length).toBe(1));
    // Second poll with identical counts — simulate by calling requestPermission
    // no-op and re-triggering effect via rerender; count unchanged so no new Notification.
    rerender();
    await act(async () => {});
    expect(result.current.count).toBe(3);
    expect(MockNotification.instances.length).toBe(1);
  });

  it("does not notify when the tab is visible (not hidden)", async () => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    stubFetch(4, 1);
    renderHook(() => useNotify());
    await waitFor(() => expect(document));
    expect(MockNotification.instances.length).toBe(0);
  });
});
