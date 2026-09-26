"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SimpleSelect, TextField } from "@/components/shared/form-fields";
import { money, qty } from "@/components/shared/formatters";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useReference } from "@/features/catalog/api";
import { newRowKey } from "@/features/products/price-rows";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { add, isValidDecimal, subtract, toBig } from "@/lib/money";
import type { SaleDetail } from "@/types/api-admin";

import { estimateRefund, useCreateReturn } from "../api";

interface RefundRow {
  key: string;
  methodId: string;
  amount: string;
  reference: string;
}

/** Mounted fresh for each open. Refund split must equal the refund total (checked by the server). */
export function ReturnDialog({ sale, onClose, onDone }: { sale: SaleDetail; onClose: () => void; onDone: (returnId: string) => void }) {
  const create = useCreateReturn();
  const { data: methods } = useReference("payment-methods");
  const cash = methods?.find((m) => m.code === "CASH");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [refunds, setRefunds] = useState<RefundRow[]>([{ key: newRowKey(), methodId: "", amount: "", reference: "" }]);
  const [problem, setProblem] = useState<string | null>(null);

  const items = sale.items.filter((i) => isValidDecimal(quantities[i.id] ?? "") && toBig(quantities[i.id]).gt("0"));
  const estimate = add(...items.map((i) => estimateRefund(i.total, i.quantity, quantities[i.id]))).toFixed(2);
  const refunded = add(...refunds.filter((r) => isValidDecimal(r.amount)).map((r) => r.amount)).toFixed(2);
  const setRow = (key: string, patch: Partial<RefundRow>) => setRefunds((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = async () => {
    let invalid: string | null = null;
    if (items.length === 0) invalid = "Enter a quantity for at least one item.";
    else if (reason.trim().length < 3) invalid = "Give a reason.";
    else if (refunds.some((r) => !(r.methodId || cash?.id) || !/^\d+(\.\d{1,2})?$/.test(r.amount.trim()))) invalid = "Every refund needs a method and an amount.";
    setProblem(invalid);
    if (invalid) return;
    try {
      const created = await create.mutateAsync({
        sale_id: sale.id,
        reason: reason.trim(),
        items: items.map((i) => ({ sale_item_id: i.id, quantity: toBig(quantities[i.id]).toString(), restock: restock[i.id] ?? true })),
        refunds: refunds.map((r) => ({ payment_method_id: r.methodId || cash!.id, amount: r.amount.trim(), reference_no: r.reference.trim() || null })),
      });
      toast.success(`Return ${created.return_number} recorded`);
      onDone(created.id);
    } catch (e) {
      if (e instanceof ApiError && e.code === "return.refund_mismatch" && typeof e.details.refund_total === "string") {
        setProblem(`The refund total is ${money(e.details.refund_total)}. Adjust the refund amounts.`);
        if (refunds.length === 1) setRow(refunds[0].key, { amount: e.details.refund_total });
      } else {
        setProblem(errorMessage(e));
      }
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Return items · {sale.receipt_number}</DialogTitle>
          <DialogDescription>Refunds are the paid share of each line. Unticked &quot;restock&quot; items are not returned to inventory.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">Line total</TableHead>
                <TableHead className="w-24 text-right">Return</TableHead>
                <TableHead className="w-20 text-center">Restock</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sale.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    {i.product_name}
                    {i.variant_name && ` · ${i.variant_name}`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {qty(i.quantity)} {i.unit_code}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(i.total)}</TableCell>
                  <TableCell>
                    <Input
                      aria-label={`Return quantity of ${i.product_name}`}
                      className="h-8 text-right"
                      inputMode="decimal"
                      placeholder="0"
                      value={quantities[i.id] ?? ""}
                      onChange={(e) => setQuantities({ ...quantities, [i.id]: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      aria-label="Restock"
                      checked={restock[i.id] ?? true}
                      onCheckedChange={(checked) => setRestock({ ...restock, [i.id]: Boolean(checked) })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Defective item" />
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Refund</span>
              <span>
                Estimated <span className="font-semibold tabular-nums">{money(estimate)}</span> · entered{" "}
                <span className={toBig(subtract(refunded, estimate)).eq("0") ? "tabular-nums" : "tabular-nums text-amber-600"}>{money(refunded)}</span>
              </span>
            </div>
            {refunds.map((r) => (
              <div key={r.key} className="grid gap-2 sm:grid-cols-[12rem_8rem_1fr_2rem]">
                <SimpleSelect
                  aria-label="Refund method"
                  value={r.methodId || cash?.id || ""}
                  onChange={(v) => setRow(r.key, { methodId: v })}
                  options={(methods ?? []).filter((m) => m.is_active).map((m) => ({ value: m.id, label: m.name }))}
                />
                <Input aria-label="Refund amount" inputMode="decimal" placeholder={estimate} value={r.amount} onChange={(e) => setRow(r.key, { amount: e.target.value })} />
                <Input aria-label="Reference" placeholder="Reference (e-wallet, card…)" value={r.reference} onChange={(e) => setRow(r.key, { reference: e.target.value })} />
                <Button variant="ghost" size="icon" aria-label="Remove refund" disabled={refunds.length === 1} onClick={() => setRefunds((rs) => rs.filter((x) => x.key !== r.key))}>
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setRefunds((rs) => [...rs, { key: newRowKey(), methodId: "", amount: "", reference: "" }])}>
                <PlusIcon /> Split refund
              </Button>
              {refunds.length === 1 && (
                <Button variant="ghost" size="sm" onClick={() => setRow(refunds[0].key, { amount: estimate })}>
                  Use estimate
                </Button>
              )}
            </div>
          </div>
          {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={create.isPending}>
            Record return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
