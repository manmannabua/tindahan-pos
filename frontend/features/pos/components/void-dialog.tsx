"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDb, type LocalSale } from "@/lib/db/schema";
import { formatMoney } from "@/lib/money";
import { ReturnVoidError, voidSale } from "@/lib/pos/voids-returns";
import { triggerSync } from "@/lib/sync/service";
import { usePosSession } from "@/stores/pos-session-store";

import { requestAuthorization } from "../manager-auth";

/** Void a whole sale of the current shift (needs sales.void or a manager's approval). */
export function VoidDialog({ sale, onClose }: { sale: LocalSale | null; onClose: () => void }) {
  return (
    <Dialog open={sale !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">{sale && <VoidForm sale={sale} onDone={onClose} />}</DialogContent>
    </Dialog>
  );
}

function VoidForm({ sale, onDone }: { sale: LocalSale; onDone: () => void }) {
  const { context, cashier } = usePosSession();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!context || !cashier) return null;

  const submit = async () => {
    setBusy(true);
    try {
      const approver = await requestAuthorization("sales.void", `Void ${sale.receiptNumber} (${formatMoney(sale.total, context.company.currency)})`);
      if (!approver) return;
      await voidSale(getDb(), {
        saleId: sale.id,
        voidedById: cashier.id,
        authorizedById: approver,
        reason,
        deviceId: context.device.deviceId,
      });
      triggerSync();
      toast.success(`${sale.receiptNumber} voided`);
      onDone();
    } catch (error) {
      toast.error(error instanceof ReturnVoidError ? error.message : `Could not void: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>Void {sale.receiptNumber}</DialogTitle>
        <DialogDescription>
          The whole sale is cancelled and its items go back to stock. For items brought back later, use a return.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="void-reason">Reason</Label>
        <Input id="void-reason" autoFocus className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <Button type="submit" variant="destructive" className="h-11 w-full" disabled={busy || reason.trim().length < 3}>
        Void sale
      </Button>
    </form>
  );
}
