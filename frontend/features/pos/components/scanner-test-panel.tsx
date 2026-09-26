"use client";

import { ScanBarcodeIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { barcodeCandidates, normalizeBarcode } from "@/lib/barcode/normalize";
import { detectSymbology } from "@/lib/barcode/symbology";

interface ScanRecord {
  code: string;
  symbology: string;
  candidates: string[];
  at: string;
}

/**
 * Phase 1 hardware check: scan anything and see what the POS receives. Lets a store verify its
 * scanner configuration (suffix, speed, AIM prefix) before the catalog exists.
 */
export function ScannerTestPanel() {
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const onScan = useCallback((raw: string) => {
    const code = normalizeBarcode(raw);
    if (!code) return;
    setScans((prev) =>
      [
        { code, symbology: detectSymbology(code), candidates: barcodeCandidates(raw), at: new Date().toLocaleTimeString() },
        ...prev,
      ].slice(0, 10),
    );
  }, []);
  useBarcodeScanner({ onScan });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScanBarcodeIcon className="size-5" /> Scanner test
        </CardTitle>
        <CardDescription>
          Scan a barcode anywhere on this screen, or type in the box and press Enter. Detection is local — no server
          involved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          data-barcode-input=""
          placeholder="Scan or type a code, then Enter"
          className="h-12 text-lg"
          aria-label="Barcode"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.currentTarget.value.trim()) {
              onScan(e.currentTarget.value);
              e.currentTarget.value = "";
            }
          }}
        />
        {scans.length === 0 ? (
          <p className="text-sm text-muted-foreground">No scans yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {scans.map((scan, i) => (
              <li key={`${scan.at}-${i}`} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="font-mono text-base font-semibold">{scan.code}</span>
                <Badge variant="secondary">{scan.symbology}</Badge>
                {scan.candidates.length > 1 && (
                  <span className="text-xs text-muted-foreground">also tries {scan.candidates.slice(1).join(", ")}</span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">{scan.at}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
