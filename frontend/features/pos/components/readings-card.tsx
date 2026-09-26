"use client";

import { FileTextIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/lib/db/schema";
import { xReading, zReading } from "@/lib/pos/readings";
import { buildReadingDocument } from "@/lib/printing/reading";
import { usePosSession } from "@/stores/pos-session-store";

import { requestAuthorization } from "../manager-auth";
import { printWithFeedback } from "../print";

/**
 * BIR-style readings from this terminal's own data (works offline).
 * X-reading: the current shift, changes nothing. Z-reading: end of day since the last Z-reading;
 * needs a manager and advances the Z counter.
 */
export function ReadingsCard({ shiftStart }: { shiftStart: string | null }) {
  const { context, cashier } = usePosSession();
  const [busy, setBusy] = useState(false);
  if (!context || !cashier) return null;

  const print = async (kind: "X" | "Z") => {
    setBusy(true);
    try {
      if (kind === "Z") {
        const approver = await requestAuthorization("cash.manage", "End-of-day Z-reading");
        if (!approver) return;
      }
      const reading = kind === "Z" ? await zReading(getDb()) : await xReading(getDb(), shiftStart);
      await printWithFeedback(
        buildReadingDocument(reading, {
          company: context.company,
          branch: context.branch,
          terminalCode: context.device.terminalCode,
          deviceBir: context.deviceBir,
          printedBy: cashier.fullName,
          width: context.settings.receiptWidth,
        }),
        context,
      );
      if (kind === "Z") toast.success(`Z-reading #${reading.zNumber} printed`);
    } catch (error) {
      toast.error(`Could not print the reading: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileTextIcon className="size-5" /> Terminal readings
        </CardTitle>
        <CardDescription>X-reading for this shift; Z-reading at the end of the day.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11" disabled={busy} onClick={() => void print("X")}>
          X-reading
        </Button>
        <Button variant="outline" className="h-11" disabled={busy} onClick={() => void print("Z")}>
          Z-reading
        </Button>
      </CardContent>
    </Card>
  );
}
