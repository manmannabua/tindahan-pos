"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { LocalDiscount } from "@/lib/db/schema";
import { compare, isValidDecimal } from "@/lib/money";

import { DecimalInput } from "./money-input";

interface Props {
  open: boolean;
  current: LocalDiscount | null;
  onClose: () => void;
  /** null removes the discount. */
  onApply: (discount: LocalDiscount | null) => void;
}

export function OrderDiscountDialog({ open, current, onClose, onApply }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">{open && <Form current={current} onApply={onApply} />}</DialogContent>
    </Dialog>
  );
}

function Form({ current, onApply }: Pick<Props, "current" | "onApply">) {
  const [kind, setKind] = useState<LocalDiscount["kind"]>(current?.kind ?? "PERCENT");
  const [value, setValue] = useState(current?.value ?? "");
  const [reason, setReason] = useState(current?.reason ?? "");
  const valid = isValidDecimal(value) && compare(value, "0") > 0;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onApply({ kind, value, reason: reason.trim() || null, authorizedById: null });
      }}
    >
      <DialogHeader>
        <DialogTitle>Order discount</DialogTitle>
      </DialogHeader>
      <div className="flex gap-2">
        <Button type="button" variant={kind === "PERCENT" ? "default" : "outline"} onClick={() => setKind("PERCENT")}>
          %
        </Button>
        <Button type="button" variant={kind === "AMOUNT" ? "default" : "outline"} onClick={() => setKind("AMOUNT")}>
          Amount
        </Button>
        <DecimalInput aria-label="Discount value" value={value} onValueChange={setValue} className="h-10" autoFocus />
      </div>
      <Input aria-label="Reason" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <DialogFooter className="gap-2">
        {current && (
          <Button type="button" variant="outline" onClick={() => onApply(null)}>
            Remove discount
          </Button>
        )}
        <Button type="submit" disabled={!valid}>
          Apply
        </Button>
      </DialogFooter>
    </form>
  );
}
