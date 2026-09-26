"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LocalDiscount } from "@/lib/db/schema";
import { compare, isValidDecimal, multiply, percentOf, toMoneyString } from "@/lib/money";
import { isStatutoryLine, unitPrice, type CartLine } from "@/lib/pos/cart";
import { useCartStore } from "@/stores/cart-store";
import { hasPermission, usePosSession } from "@/stores/pos-session-store";

import { requestAuthorization } from "../manager-auth";
import { DecimalInput } from "./money-input";

/** Discounts up to this percent of the amount need only `sales.discount`. */
export const CASHIER_DISCOUNT_LIMIT_PERCENT = "10";

/**
 * Who may apply `discount` on `base`? Returns the authorizer id (null = no approval needed),
 * or undefined if approval was refused/cancelled.
 */
export async function authorizeDiscount(discount: LocalDiscount, base: string): Promise<string | null | undefined> {
  const cashier = usePosSession.getState().cashier;
  const amount = discount.kind === "PERCENT" ? percentOf(base, discount.value) : discount.value;
  const withinLimit = compare(amount, percentOf(base, CASHIER_DISCOUNT_LIMIT_PERCENT)) <= 0;
  if (withinLimit && hasPermission(cashier, "sales.discount")) return null;
  const approver = await requestAuthorization("sales.discount.override", `Discount of ${toMoneyString(amount)}`);
  return approver ?? undefined;
}

interface Props {
  line: CartLine | null;
  onClose: () => void;
}

export function LineEditDialog({ line, onClose }: Props) {
  return (
    <Dialog open={line !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">{line && <LineEditForm key={line.id} line={line} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function LineEditForm({ line, onClose }: { line: CartLine; onClose: () => void }) {
  const cart = useCartStore();
  const statutory = isStatutoryLine(cart, line);
  const decimals = line.item.allowsDecimal ? 3 : 0;
  const [quantity, setQuantity] = useState(line.quantity);
  const [price, setPrice] = useState(unitPrice(line) ?? "");
  const [kind, setKind] = useState<LocalDiscount["kind"]>(line.discount?.kind ?? "PERCENT");
  const [value, setValue] = useState(line.discount?.value ?? "");
  const [reason, setReason] = useState(line.discount?.reason ?? "");

  const save = async () => {
    if (!isValidDecimal(quantity) || compare(quantity, "0") <= 0) return toast.error("Enter a quantity");
    cart.setQuantity(line.id, quantity);

    const currentPrice = unitPrice(line);
    if (price && isValidDecimal(price) && price !== currentPrice) {
      const approver = await requestAuthorization("sales.price.override", `Change price of ${line.item.productName} to ${price}`);
      if (!approver) return;
      cart.overridePrice(line.id, { price: toMoneyString(price), authorizedById: approver });
    }

    if (statutory) {
      // Senior citizen / PWD lines take no other discount.
    } else if (value && isValidDecimal(value) && compare(value, "0") > 0) {
      const discount: LocalDiscount = { kind, value, reason: reason.trim() || null, authorizedById: null };
      const base = toMoneyString(multiply(unitPrice(line) ?? "0", quantity));
      const approver = await authorizeDiscount(discount, base);
      if (approver === undefined) return;
      cart.setLineDiscount(line.id, { ...discount, authorizedById: approver });
    } else if (line.discount) {
      cart.setLineDiscount(line.id, null);
    }
    onClose();
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <DialogHeader>
        <DialogTitle>{line.item.productName}</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="line-qty">Quantity ({line.item.unitCode})</Label>
          <DecimalInput id="line-qty" decimals={decimals} value={quantity} onValueChange={setQuantity} className="h-11" autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="line-price">Unit price</Label>
          <DecimalInput id="line-price" value={price} onValueChange={setPrice} className="h-11" />
        </div>
      </div>
      {statutory ? (
        <p className="rounded-md bg-sky-50 p-2 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-100">
          Senior citizen / PWD discount applies to this item; other discounts are not allowed.
        </p>
      ) : (
      <div className="space-y-1.5">
        <Label>Discount</Label>
        <div className="flex gap-2">
          <Button type="button" variant={kind === "PERCENT" ? "default" : "outline"} onClick={() => setKind("PERCENT")}>
            %
          </Button>
          <Button type="button" variant={kind === "AMOUNT" ? "default" : "outline"} onClick={() => setKind("AMOUNT")}>
            Amount
          </Button>
          <DecimalInput aria-label="Discount value" value={value} onValueChange={setValue} className="h-10" />
        </div>
        <Input aria-label="Discount reason" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      )}
      <DialogFooter className="gap-2">
        <Button type="button" variant="destructive" onClick={() => {
          cart.remove(line.id);
          onClose();
        }}>
          Remove line
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  );
}
