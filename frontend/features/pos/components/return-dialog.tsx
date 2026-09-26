"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDb } from "@/lib/db/schema";
import { add, compare, formatMoney, isValidDecimal, toMoneyString } from "@/lib/money";
import {
  computeRefunds,
  createReturn,
  remoteReturnableLines,
  returnableLines,
  ReturnVoidError,
  type RemoteSale,
  type ReturnableLine,
} from "@/lib/pos/voids-returns";
import { buildReturnReceipt } from "@/lib/printing/return-receipt";
import { triggerSync } from "@/lib/sync/service";
import { usePosSession } from "@/stores/pos-session-store";

import { requestAuthorization } from "../manager-auth";
import { printWithFeedback } from "../print";
import { DecimalInput } from "./money-input";

/** A sale to return: one stored on this terminal, or one found online on another terminal. */
export interface ReturnTarget {
  saleId: string;
  receiptNumber: string;
  remote: RemoteSale | null;
}

/** Return items of a sale and refund the customer (needs returns.create or approval). */
export function ReturnDialog({ target, onClose }: { target: ReturnTarget | null; onClose: () => void }) {
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">{target && <ReturnForm sale={target} onDone={onClose} />}</DialogContent>
    </Dialog>
  );
}

interface Pick {
  quantity: string;
  restock: boolean;
}

function ReturnForm({ sale, onDone }: { sale: ReturnTarget; onDone: () => void }) {
  const { context, cashier, cashSession } = usePosSession();
  const [lines, setLines] = useState<ReturnableLine[] | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [reason, setReason] = useState("");
  const [methodId, setMethodId] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = sale.remote ? remoteReturnableLines(getDb(), sale.remote) : returnableLines(getDb(), sale.saleId);
    void load.then(setLines);
  }, [sale.saleId, sale.remote]);

  const requested = useMemo(
    () =>
      Object.entries(picks)
        .filter(([, p]) => isValidDecimal(p.quantity) && compare(p.quantity, "0") > 0)
        .map(([saleItemId, p]) => ({ saleItemId, quantity: p.quantity, restock: p.restock })),
    [picks],
  );
  const preview = useMemo(() => {
    if (!lines || requested.length === 0) return { total: "0.00", error: null as string | null };
    try {
      return { total: toMoneyString(add(...computeRefunds(lines, requested))), error: null };
    } catch (error) {
      return { total: "0.00", error: error instanceof Error ? error.message : String(error) };
    }
  }, [lines, requested]);

  if (!context || !cashier || !lines) return null;
  const methods = context.paymentMethods;
  const method = methods.find((m) => m.id === methodId) ?? methods.find((m) => m.kind === "CASH") ?? methods[0];
  const currency = context.company.currency;

  const submit = async () => {
    if (!method) return;
    setBusy(true);
    try {
      const approver = await requestAuthorization("returns.create", `Refund ${formatMoney(preview.total, currency)} on ${sale.receiptNumber}`);
      if (!approver) return;
      const created = await createReturn(getDb(), {
        saleId: sale.saleId,
        remote: sale.remote,
        restockLocationId: context.device.defaultStockLocationId,
        lines: requested,
        refunds: [{ method, amount: preview.total, referenceNo: reference || null }],
        cashier: { id: cashier.id, name: cashier.fullName },
        authorizedById: approver,
        reason,
        cashSessionId: cashSession?.id ?? null,
        deviceId: context.device.deviceId,
        receiptPrefix: context.device.receiptPrefix,
      });
      triggerSync();
      toast.success(`Return ${created.ret.returnNumber}: refund ${formatMoney(created.ret.refundTotal, currency)}`);
      void printWithFeedback(
        buildReturnReceipt({
          ...created,
          originalReceipt: sale.receiptNumber,
          company: context.company,
          branch: context.branch,
          terminalCode: context.device.terminalCode,
          width: context.settings.receiptWidth,
          deviceBir: context.deviceBir,
        }),
        context,
      );
      onDone();
    } catch (error) {
      toast.error(error instanceof ReturnVoidError ? error.message : `Could not process the return: ${String(error)}`);
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
        <DialogTitle>Return items · {sale.receiptNumber}</DialogTitle>
        <DialogDescription>
          Refunds are the price actually paid for each item, after discounts.
          {sale.remote && " This sale was made on another terminal (looked up online)."}
        </DialogDescription>
      </DialogHeader>
      <ul className="max-h-72 divide-y overflow-auto rounded-lg border" aria-label="Returnable items">
        {lines.map(({ item, remainingQuantity }) => {
          const pick = picks[item.id] ?? { quantity: "", restock: true };
          const setPick = (patch: Partial<Pick>) => setPicks({ ...picks, [item.id]: { ...pick, ...patch } });
          const none = compare(remainingQuantity, "0") <= 0;
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid="return-line">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{item.productName}</div>
                <div className="text-xs text-muted-foreground">
                  Sold {item.quantity} {item.unitCode} · {formatMoney(item.total, currency)} · returnable {remainingQuantity}
                </div>
              </div>
              <DecimalInput
                aria-label={`Return quantity ${item.productName}`}
                className="h-10 w-20"
                decimals={3}
                disabled={none}
                placeholder="0"
                value={pick.quantity}
                onValueChange={(quantity) => setPick({ quantity })}
              />
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox checked={pick.restock} disabled={none} onCheckedChange={(c) => setPick({ restock: c === true })} />
                Restock
              </label>
            </li>
          );
        })}
      </ul>
      <div className="space-y-1.5">
        <Label htmlFor="return-reason">Reason</Label>
        <Input id="return-reason" className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Refund method">
        {methods.map((m) => (
          <Button key={m.id} type="button" variant={method?.id === m.id ? "default" : "outline"} className="h-10" onClick={() => setMethodId(m.id)}>
            {m.name}
          </Button>
        ))}
      </div>
      {method?.requiresReference && (
        <div className="space-y-1.5">
          <Label htmlFor="refund-reference">Refund reference number</Label>
          <Input id="refund-reference" className="h-11" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
      )}
      {preview.error && <p className="text-sm font-medium text-destructive">{preview.error}</p>}
      <Button
        type="submit"
        className="h-12 w-full"
        disabled={busy || requested.length === 0 || preview.error !== null || reason.trim().length < 3}
      >
        Refund {formatMoney(preview.total, currency)}
      </Button>
    </form>
  );
}
