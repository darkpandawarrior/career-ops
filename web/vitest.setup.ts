// Global test setup. jest-dom matchers (toBeInTheDocument, toBeDisabled, …) are
// registered for the jsdom component tests; they are inert in node-env tests.
import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

// jsdom under recent Node doesn't expose a usable Web Storage (Node's own
// experimental localStorage needs --localstorage-file and shadows jsdom's). Give
// component tests a real in-memory localStorage so storage reads/writes work.
if (typeof window !== "undefined") {
  class MemoryStorage implements Storage {
    private store = new Map<string, string>();
    get length() {
      return this.store.size;
    }
    clear() {
      this.store.clear();
    }
    getItem(key: string) {
      return this.store.has(key) ? this.store.get(key)! : null;
    }
    key(index: number) {
      return [...this.store.keys()][index] ?? null;
    }
    removeItem(key: string) {
      this.store.delete(key);
    }
    setItem(key: string, value: string) {
      this.store.set(key, String(value));
    }
  }
  const mem = new MemoryStorage();
  Object.defineProperty(window, "localStorage", { value: mem, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: mem, configurable: true });
  beforeEach(() => mem.clear());
}
