"use client";

import { CameraIcon, ScanBarcodeIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLiveQuery } from "@/hooks/use-live-query";
import { searchCatalog, type SearchResult } from "@/lib/db/catalog";
import { getDb } from "@/lib/db/schema";
import { usePosSession } from "@/stores/pos-session-store";

import { useScanToCart } from "../hooks/use-scan-to-cart";
import { CameraDialog } from "./camera-dialog";

/**
 * Scanner input + product search.
 *
 * - Focus in this input (the default): the input owns the scan. Scanners type the code and press
 *   Enter, so Enter looks up the *whole* value — independent of keystroke timing, which a busy
 *   main thread can distort.
 * - Focus elsewhere: use-barcode-scanner detects scanner-speed typing anywhere on the page.
 */
export function ScanBar({ disabled }: { disabled?: boolean }) {
  const { scan, addVariant } = useScanToCart();
  const [text, setText] = useState("");
  const [camera, setCamera] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const query = useDebouncedValue(text, 150);
  const found = useLiveQuery<SearchResult[]>(
    async () => (query.trim().length < 2 ? [] : searchCatalog(getDb(), query)),
    [query],
    [],
  );
  // Hide stale results immediately when the input is cleared (the query is debounced).
  const results = text.trim().length < 2 ? [] : found;

  const settings = usePosSession((s) => s.context?.settings);
  useBarcodeScanner({
    onScan: (code) => void scan(code),
    enabled: !disabled,
    detector: settings && {
      minLength: settings.scannerMinLength,
      maxInterKeyMs: settings.scannerMaxInterKeyMs,
      maxAvgInterKeyMs: settings.scannerMaxAvgInterKeyMs,
    },
  });

  // Back to the scan input after payment/receipt dialogs close: ready for the next customer.
  useEffect(() => {
    if (!disabled) input.current?.focus();
  }, [disabled]);

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    const outcome = await scan(value);
    if (outcome === "added") setText("");
  };

  const pick = async (variantId: string) => {
    await addVariant(variantId);
    setText("");
    input.current?.focus();
  };

  return (
    <div className="relative">
      <div className="relative flex gap-2">
        <div className="relative flex-1">
        <ScanBarcodeIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={input}
          aria-label="Scan or search"
          placeholder="Scan barcode or type product name / SKU"
          value={text}
          disabled={disabled}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (results.length === 1 && !/^\S*\d{6,}\S*$/.test(text.trim())) void pick(results[0].variantId);
              else void submit();
            }
            if (e.key === "Escape") setText("");
          }}
          className="h-12 pl-10 text-base"
        />
        </div>
        <Button
          type="button"
          variant="outline"
          className="size-12"
          aria-label="Scan with camera"
          disabled={disabled}
          onClick={() => setCamera(true)}
        >
          <CameraIcon className="size-5" />
        </Button>
      </div>
      <CameraDialog open={camera} onClose={() => { setCamera(false); input.current?.focus(); }} onScan={(code) => void scan(code)} />
      {results.length > 0 && (
        <ul role="listbox" aria-label="Search results" className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-lg border bg-popover p-1 shadow-lg">
          {results.map((r) => (
            <li key={r.variantId}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm hover:bg-muted"
                onClick={() => void pick(r.variantId)}
              >
                <SearchIcon className="size-4 text-muted-foreground" />
                <span className="font-medium">
                  {r.productName}
                  {r.variantName ? ` · ${r.variantName}` : ""}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">{r.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
