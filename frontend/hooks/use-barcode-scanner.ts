"use client";

import { useEffect, useRef } from "react";

import {
  ScannerDetector,
  type ScannerDetectorOptions,
} from "@/lib/barcode/scanner-detector";

export interface UseBarcodeScannerOptions {
  onScan: (code: string) => void;
  enabled?: boolean;
  detector?: Partial<ScannerDetectorOptions>;
}

const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "number", "password", "tel", "url", ""]);

function isEditable(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type);
}

/** Remove the scanned characters that the browser already typed into a barcode input. */
function stripScannedSuffix(input: HTMLInputElement, code: string): void {
  if (!input.value.endsWith(code)) return;
  // Use the native setter so React's controlled-input tracking sees the change.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, input.value.slice(0, -code.length));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Listen for HID barcode-scanner input anywhere on the page. See docs/BARCODE_SCANNER.md §3.
 *
 * - Focus outside editable elements: scanner keystrokes are captured and their default action
 *   prevented (so e.g. Enter doesn't activate a focused button).
 * - Focus in a normal editable element: the hook stays out of the way.
 * - Focus in an element marked `data-barcode-input`: scans are detected there too; the scanned
 *   text is removed from the input and delivered to `onScan`.
 */
export function useBarcodeScanner({ onScan, enabled = true, detector: options }: UseBarcodeScannerOptions): void {
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const minLength = options?.minLength;
  const maxInterKeyMs = options?.maxInterKeyMs;
  const maxAvgInterKeyMs = options?.maxAvgInterKeyMs;
  const idleTimeoutMs = options?.idleTimeoutMs;

  useEffect(() => {
    if (!enabled) return;
    let lastTarget: EventTarget | null = null;

    const detector = new ScannerDetector(
      (code) => {
        if (lastTarget instanceof HTMLInputElement && lastTarget.closest("[data-barcode-input]")) {
          stripScannedSuffix(lastTarget, code);
        }
        onScanRef.current(code);
      },
      Object.fromEntries(
        Object.entries({ minLength, maxInterKeyMs, maxAvgInterKeyMs, idleTimeoutMs }).filter(
          ([, v]) => v !== undefined,
        ),
      ),
    );

    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
      const target = event.target;
      const barcodeInput = target instanceof HTMLElement && target.closest("[data-barcode-input]");
      if (isEditable(target) && !barcodeInput) return;

      lastTarget = target;
      const result = detector.handleKey(event.key, event.timeStamp);
      const suppress = barcodeInput
        ? result === "scan"
        : result === "scan" || (result === "buffered" && detector.isLikelyScanning());
      if (suppress) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("keydown", handler, { capture: true });
    return () => {
      window.removeEventListener("keydown", handler, { capture: true });
      detector.dispose();
    };
  }, [enabled, minLength, maxInterKeyMs, maxAvgInterKeyMs, idleTimeoutMs]);
}
