"use client";

import { DownloadIcon, PrinterIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

const SIZE = 220;

/** Render the QR code for `url` as an SVG string (the encoder is loaded on demand). */
async function qrSvg(url: string): Promise<string> {
  const { BrowserQRCodeSvgWriter } = await import("@zxing/browser");
  const svg = new BrowserQRCodeSvgWriter().write(url, SIZE, SIZE);
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`);
  return new XMLSerializer().serializeToString(svg);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** QR code linking to the public catalog, with download and a printable counter sign. */
export function StoreQrCode({ url, storeName }: { url: string; storeName: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void qrSvg(url).then((markup) => {
      if (!cancelled) setSvg(markup);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    // The SVG is generated locally from our own URL (no user HTML), so injecting it is safe.
    if (holder.current && svg) holder.current.innerHTML = svg;
  }, [svg]);

  const download = () => {
    if (!svg) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    link.download = "online-catalog-qr.svg";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const print = () => {
    if (!svg) return;
    const win = window.open("", "_blank", "width=600,height=800");
    if (!win) return;
    win.document.write(`<!doctype html><title>${escapeHtml(storeName)}</title>
      <style>body{font-family:system-ui,sans-serif;text-align:center;padding:48px}
      h1{font-size:28px;margin:0 0 8px}p{font-size:18px;margin:8px 0}svg{width:320px;height:320px}</style>
      <h1>${escapeHtml(storeName)}</h1><p>Scan to see what's in stock</p>${svg}<p>${escapeHtml(url)}</p>`);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
      <div
        ref={holder}
        role="img"
        aria-label={`QR code for ${url}`}
        className="size-[140px] shrink-0 rounded-md border bg-white p-1 [&>svg]:size-full"
      />
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">Put this at your counter so customers can check stock from their phones.</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={!svg} onClick={print}>
            <PrinterIcon /> Print sign
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={!svg} onClick={download}>
            <DownloadIcon /> Download
          </Button>
        </div>
      </div>
    </div>
  );
}
