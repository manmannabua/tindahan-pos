"use client";

import { MinusIcon, PlusIcon, ShoppingCartIcon, TagIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { add, compare, formatMoney, subtract, toQuantityString } from "@/lib/money";
import { unitPrice, type CartLine } from "@/lib/pos/cart";
import type { LineResult } from "@/lib/money/sale-calculation";
import { cn } from "@/lib/utils";
import { useCartStore } from "@/stores/cart-store";

import { LineEditDialog } from "./line-edit-dialog";

function PromotionBadge({ line }: { line: CartLine }) {
  const setDisabled = useCartStore((s) => s.setPromotionsDisabled);
  if (line.promotion) {
    return (
      <span
        data-testid="promo-badge"
        className="inline-flex max-w-40 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      >
        <TagIcon className="size-3 shrink-0" />
        <span className="truncate">{line.promotion.name}</span>
        <button
          type="button"
          aria-label={`Remove promotion ${line.promotion.name}`}
          className="rounded-full p-0.5 hover:bg-emerald-200 dark:hover:bg-emerald-900"
          onClick={() => setDisabled(line.id, true)}
        >
          <XIcon className="size-3" />
        </button>
      </span>
    );
  }
  if (line.promotionsDisabled) {
    return (
      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setDisabled(line.id, false)}>
        Restore promos
      </button>
    );
  }
  return null;
}

export function CartTable({ lineResults, currency }: { lineResults: LineResult[] | null; currency: string }) {
  const lines = useCartStore((s) => s.lines);
  const activeLineId = useCartStore((s) => s.activeLineId);
  const [editing, setEditing] = useState<CartLine | null>(null);

  if (lines.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
        <ShoppingCartIcon className="size-10" />
        <p>Scan an item to start a sale</p>
      </div>
    );
  }

  return (
    <>
      <ul aria-label="Cart" className="divide-y overflow-auto">
        {lines.map((line, i) => {
          const result = lineResults?.[i];
          const price = unitPrice(line);
          return (
            <li
              key={line.id}
              data-testid="cart-line"
              className={cn("flex items-center gap-3 px-3 py-2.5", line.id === activeLineId && "bg-primary/5")}
            >
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(line)}>
                <div className="truncate font-medium">
                  {line.item.productName}
                  {line.item.variantName ? ` · ${line.item.variantName}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  {price === null ? (
                    <span className="font-medium text-destructive">No price</span>
                  ) : (
                    <>
                      {formatMoney(price, currency)} / {line.item.unitCode}
                      {line.override && " (price changed)"}
                    </>
                  )}
                  {result && compare(result.lineDiscount, "0") > 0 && ` · discount −${formatMoney(result.lineDiscount, currency)}`}
                </div>
              </button>
              <PromotionBadge line={line} />
              <div className="flex items-center gap-1">
                <Button
                  size="icon-lg"
                  variant="outline"
                  aria-label="Decrease quantity"
                  onClick={() => useCartStore.getState().setQuantity(line.id, toQuantityString(subtract(line.quantity, "1")))}
                >
                  <MinusIcon />
                </Button>
                <span className="w-12 text-center font-semibold tabular-nums" data-testid="cart-qty">
                  {line.quantity}
                </span>
                <Button
                  size="icon-lg"
                  variant="outline"
                  aria-label="Increase quantity"
                  onClick={() => useCartStore.getState().setQuantity(line.id, toQuantityString(add(line.quantity, "1")))}
                >
                  <PlusIcon />
                </Button>
              </div>
              <div className="w-24 text-right font-semibold tabular-nums">{result ? formatMoney(result.total, currency) : "—"}</div>
            </li>
          );
        })}
      </ul>
      <LineEditDialog line={editing} onClose={() => setEditing(null)} />
    </>
  );
}
