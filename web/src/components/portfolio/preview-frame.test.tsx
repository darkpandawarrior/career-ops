// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PreviewFrame } from "./preview-frame";

afterEach(cleanup);

// The portfolio HTML is AI-generated → untrusted. It must be confined to a sandboxed
// iframe via srcDoc, never injected into the host document.
describe("PreviewFrame — sandboxed iframe isolation", () => {
  const HTML = "<h1>UNTRUSTED_PORTFOLIO_MARKUP</h1><script>window.x=1</script>";

  it("renders the html inside the iframe srcDoc, sandboxed, not in the document", () => {
    const { container } = render(<PreviewFrame html={HTML} />);

    const iframe = container.querySelector("iframe");
    expect(iframe).toBeTruthy();

    // sandbox is present and EMPTY (no allow-scripts) — scripts cannot run.
    expect(iframe!.getAttribute("sandbox")).toBe("");

    // The markup lives in srcDoc, the isolated boundary.
    expect(iframe!.getAttribute("srcdoc")).toBe(HTML);

    // Critically: the untrusted markup is NOT injected into the host DOM.
    expect(container.querySelector("h1")).toBeNull();
    expect(container.textContent).not.toContain("UNTRUSTED_PORTFOLIO_MARKUP");
  });

  it("starts in desktop width (w-full, not the mobile fixed width)", () => {
    const { container } = render(<PreviewFrame html={HTML} />);
    const iframe = container.querySelector("iframe")!;
    expect(iframe.className).toContain("w-full");
    expect(iframe.className).not.toContain("w-[390px]");
  });

  it("device toggle switches the iframe width to mobile and back", () => {
    const { container } = render(<PreviewFrame html={HTML} />);
    const iframe = container.querySelector("iframe")!;

    // Switch to mobile.
    fireEvent.click(screen.getByLabelText("Mobile preview"));
    expect(iframe.className).toContain("w-[390px]");
    expect(iframe.className).not.toContain("w-full");

    // Switch back to desktop.
    fireEvent.click(screen.getByLabelText("Desktop preview"));
    expect(iframe.className).toContain("w-full");
    expect(iframe.className).not.toContain("w-[390px]");
  });

  it("preserves the srcDoc html across a device toggle (no re-injection)", () => {
    const { container } = render(<PreviewFrame html={HTML} />);
    fireEvent.click(screen.getByLabelText("Mobile preview"));
    const iframe = container.querySelector("iframe")!;
    expect(iframe.getAttribute("srcdoc")).toBe(HTML);
    expect(iframe.getAttribute("sandbox")).toBe("");
  });
});
