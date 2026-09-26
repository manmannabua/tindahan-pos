"use client";

import JsBarcode from "jsbarcode";
import { useEffect, useRef } from "react";

import { layoutReceipt, type ReceiptDocument } from "@/lib/printing/receipt";
import { cn } from "@/lib/utils";

function ReceiptBarcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, { format: "CODE128", height: 36, width: 1.3, fontSize: 11, margin: 0, background: "transparent" });
    } catch {
      // Not encodable: the number is still printed as text above.
    }
  }, [value]);
  return <svg ref={ref} role="img" aria-label={`Barcode ${value}`} className="mx-auto mt-2 max-w-full" />;
}

/**
 * A receipt on screen, laid out exactly like the printed one (same fixed-width layout as the
 * thermal printer: 32 columns on 58 mm, 48 on 80 mm), on a paper-like white strip.
 */
export function VirtualReceipt({ doc, className, label }: { doc: ReceiptDocument; className?: string; label?: string }) {
  const rows = layoutReceipt(doc);
  const columns = doc.width === 58 ? 32 : 48;
  return (
    <figure
      aria-label={label ?? "Receipt"}
      className={cn(
        "mx-auto rounded-sm bg-white px-3 py-4 font-mono text-[11px] leading-[1.35] text-black shadow-md ring-1 ring-black/10",
        className,
      )}
      style={{ width: `calc(${columns}ch + 1.5rem)` }}
    >
      {rows.map((row, i) =>
        row.barcode ? (
          <ReceiptBarcode key={i} value={row.barcode} />
        ) : (
          <div key={i} className={cn("whitespace-pre", row.bold && "font-bold")}>
            {row.text || " "}
          </div>
        ),
      )}
    </figure>
  );
}
