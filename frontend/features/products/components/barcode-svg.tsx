"use client";

import JsBarcode from "jsbarcode";
import { useEffect, useRef } from "react";

import type { LabelFormat } from "../labels";

/** Renders a barcode as SVG (crisp at any printer resolution). Falls back to CODE128. */
export function BarcodeSvg({ code, format, height = 32 }: { code: string; format: LabelFormat; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const options = { height, width: 1.4, fontSize: 11, margin: 0, displayValue: true };
    try {
      JsBarcode(ref.current, code, { ...options, format });
    } catch {
      JsBarcode(ref.current, code, { ...options, format: "CODE128" });
    }
  }, [code, format, height]);
  return <svg ref={ref} role="img" aria-label={`Barcode ${code}`} className="max-w-full" />;
}
