import { render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useBarcodeScanner } from "./use-barcode-scanner";

/** Dispatch keydown events with controlled timestamps (jsdom's timeStamp is read-only). */
function scan(target: EventTarget, text: string, gapMs = 5, terminator = "Enter"): KeyboardEvent[] {
  const events: KeyboardEvent[] = [];
  let t = 1000;
  for (const key of [...text, terminator]) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    Object.defineProperty(event, "timeStamp", { value: t });
    t += gapMs;
    target.dispatchEvent(event);
    events.push(event);
  }
  return events;
}

describe("useBarcodeScanner", () => {
  it("delivers scans typed while focus is on the page body", () => {
    const onScan = vi.fn();
    renderHook(() => useBarcodeScanner({ onScan }));
    const events = scan(document.body, "4800361419117");
    expect(onScan).toHaveBeenCalledWith("4800361419117");
    // The terminating Enter must not reach focused buttons.
    expect(events[events.length - 1].defaultPrevented).toBe(true);
  });

  it("ignores scanner-speed input inside ordinary inputs", () => {
    const onScan = vi.fn();
    renderHook(() => useBarcodeScanner({ onScan }));
    const { getByRole } = render(<input aria-label="notes" />);
    scan(getByRole("textbox"), "4800361419117");
    expect(onScan).not.toHaveBeenCalled();
  });

  it("captures scans in inputs marked data-barcode-input", () => {
    const onScan = vi.fn();
    renderHook(() => useBarcodeScanner({ onScan }));
    const { getByRole } = render(<input aria-label="search" data-barcode-input="" />);
    const input = getByRole("textbox") as HTMLInputElement;
    input.value = "4800361419117"; // what the browser would have typed
    scan(input, "4800361419117");
    expect(onScan).toHaveBeenCalledWith("4800361419117");
    expect(input.value).toBe("");
  });

  it("does nothing when disabled", () => {
    const onScan = vi.fn();
    renderHook(() => useBarcodeScanner({ onScan, enabled: false }));
    scan(document.body, "4800361419117");
    expect(onScan).not.toHaveBeenCalled();
  });

  it("ignores slow typing on the page", () => {
    const onScan = vi.fn();
    renderHook(() => useBarcodeScanner({ onScan }));
    scan(document.body, "12345678", 200);
    expect(onScan).not.toHaveBeenCalled();
  });
});
