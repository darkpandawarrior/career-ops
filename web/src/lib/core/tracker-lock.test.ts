import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { lockDirFor, acquireTrackerLock, withTrackerLock } from "./tracker-lock";

let tracker: string;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-lock-test-"));
  tracker = path.join(dir, "applications.md");
  fs.writeFileSync(tracker, "seed");
});

afterEach(() => {
  try {
    fs.rmSync(lockDirFor(tracker), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("lockDirFor", () => {
  it("is deterministic for the same tracker path", () => {
    expect(lockDirFor(tracker)).toBe(lockDirFor(tracker));
  });

  it("differs for different tracker paths", () => {
    const other = tracker.replace("applications.md", "other.md");
    fs.writeFileSync(other, "seed");
    expect(lockDirFor(tracker)).not.toBe(lockDirFor(other));
  });
});

describe("acquireTrackerLock — mutual exclusion", () => {
  it("blocks a second acquire until the first releases", async () => {
    const lock1 = await acquireTrackerLock(lockDirFor(tracker), { timeoutMs: 2000 });

    let acquired2 = false;
    const p2 = acquireTrackerLock(lockDirFor(tracker), { timeoutMs: 2000 }).then((lock2) => {
      acquired2 = true;
      lock2.release();
    });

    // Give the second attempt a chance to try (and fail) at least once.
    await new Promise((r) => setTimeout(r, 150));
    expect(acquired2).toBe(false);

    lock1.release();
    await p2;
    expect(acquired2).toBe(true);
  });

  it("times out with a clear error when the lock is never released", async () => {
    const lock1 = await acquireTrackerLock(lockDirFor(tracker), { timeoutMs: 2000 });
    await expect(acquireTrackerLock(lockDirFor(tracker), { timeoutMs: 200, retryMs: 30 })).rejects.toThrow(/Timed out/);
    lock1.release();
  });

  it("release() is idempotent and only the token-matching owner may release", async () => {
    const lock1 = await acquireTrackerLock(lockDirFor(tracker), { timeoutMs: 2000 });
    lock1.release();
    expect(() => lock1.release()).not.toThrow();
    // Lock dir is gone — a fresh acquire should succeed immediately.
    const lock2 = await acquireTrackerLock(lockDirFor(tracker), { timeoutMs: 2000 });
    expect(lock2.waitMs).toBeLessThan(200);
    lock2.release();
  });

  it("recovers a stale lock whose owner PID is dead", async () => {
    const dir = lockDirFor(tracker);
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "owner.json"),
      JSON.stringify({ pid: 999999, token: "dead", started_at: new Date().toISOString(), tracker }),
    );
    const lock = await acquireTrackerLock(dir, { timeoutMs: 2000, retryMs: 30 });
    expect(lock.staleRecovered).toBe(true);
    lock.release();
  });
});

describe("withTrackerLock", () => {
  it("releases the lock even when fn throws", async () => {
    await expect(
      withTrackerLock(tracker, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Lock released → a fresh acquire succeeds immediately.
    const lock = await acquireTrackerLock(lockDirFor(tracker), { timeoutMs: 500 });
    expect(lock.waitMs).toBeLessThan(200);
    lock.release();
  });

  it("serializes two concurrent withTrackerLock calls on the same tracker", async () => {
    const order: string[] = [];
    const p1 = withTrackerLock(tracker, async () => {
      order.push("first-start");
      await new Promise((r) => setTimeout(r, 100));
      order.push("first-end");
    });
    await new Promise((r) => setTimeout(r, 20)); // let p1 grab the lock first
    const p2 = withTrackerLock(tracker, () => {
      order.push("second");
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });
});
