import { describe, it, expect } from "vitest";
import { NAV_ITEMS, isActivePath, type NavItem } from "./nav-items";

// NAV_ITEMS is the single source of truth for primary destinations (shared by the
// desktop sidebar and mobile nav). isActivePath is the active-link matcher: the
// root "/" matches ONLY exactly, every other href matches by prefix.

describe("NAV_ITEMS registry shape", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(NAV_ITEMS)).toBe(true);
    expect(NAV_ITEMS.length).toBeGreaterThan(0);
  });

  it("every item has an href, a label, and a renderable icon", () => {
    for (const item of NAV_ITEMS as NavItem[]) {
      expect(typeof item.href).toBe("string");
      expect(item.href.startsWith("/")).toBe(true);
      expect(typeof item.label).toBe("string");
      expect(item.label.trim().length).toBeGreaterThan(0);
      // lucide icons are React components (function or forwardRef object)
      expect(["function", "object"]).toContain(typeof item.icon);
      expect(item.icon).toBeTruthy();
    }
  });

  it("hrefs are unique", () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("labels are unique", () => {
    const labels = NAV_ITEMS.map((i) => i.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("includes the home destination at '/'", () => {
    expect(NAV_ITEMS.some((i) => i.href === "/")).toBe(true);
  });

  it("only the items that opt in carry a chip (string when present)", () => {
    for (const item of NAV_ITEMS) {
      if (item.chip !== undefined) {
        expect(typeof item.chip).toBe("string");
        expect(item.chip.length).toBeGreaterThan(0);
      }
    }
    // the board entry is the documented "New" chip
    expect(NAV_ITEMS.find((i) => i.href === "/board")?.chip).toBe("New");
  });
});

describe("isActivePath — root '/'", () => {
  it("matches only the exact root path", () => {
    expect(isActivePath("/", "/")).toBe(true);
  });

  it("does NOT match any nested path (root is exact-only)", () => {
    expect(isActivePath("/", "/board")).toBe(false);
    expect(isActivePath("/", "/pipeline/123")).toBe(false);
    expect(isActivePath("/", "")).toBe(false);
  });
});

describe("isActivePath — non-root exact + nested matching", () => {
  it("matches the exact href", () => {
    expect(isActivePath("/board", "/board")).toBe(true);
    expect(isActivePath("/pipeline", "/pipeline")).toBe(true);
  });

  it("matches nested sub-routes via prefix", () => {
    expect(isActivePath("/pipeline", "/pipeline/abc")).toBe(true);
    expect(isActivePath("/board", "/board/123/edit")).toBe(true);
  });

  it("matches a trailing-slash variant of the href (still a prefix)", () => {
    expect(isActivePath("/board", "/board/")).toBe(true);
  });

  it("does NOT match an unrelated path", () => {
    expect(isActivePath("/board", "/pipeline")).toBe(false);
    expect(isActivePath("/intel", "/")).toBe(false);
  });

  it("KNOWN BEHAVIOR: startsWith causes sibling-prefix false positives", () => {
    // "/board" is a string-prefix of "/board-archive", so a non-nested sibling
    // route that merely shares the prefix is (incorrectly) reported active. This
    // is current behavior of the simple startsWith matcher — pinned, not endorsed.
    expect(isActivePath("/board", "/board-archive")).toBe(true);
  });
});

describe("isActivePath — every registered destination", () => {
  it("each nav href is active for its own exact pathname", () => {
    for (const item of NAV_ITEMS) {
      expect(isActivePath(item.href, item.href)).toBe(true);
    }
  });

  it("non-root items are active for a nested child of themselves", () => {
    for (const item of NAV_ITEMS) {
      if (item.href === "/") continue;
      expect(isActivePath(item.href, `${item.href}/child`)).toBe(true);
    }
  });
});
