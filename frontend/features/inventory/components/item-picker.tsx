"use client";

import { ScanBarcodeIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { qty } from "@/components/shared/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lookupBarcode, useProducts } from "@/features/catalog/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/api/errors";
import type { Product, ProductUnit } from "@/types/api-admin";

export interface PickedItem {
  variantId: string;
  productId: string;
  name: string;
  sku: string;
  units: ProductUnit[];
  /** units.id of the scanned barcode's unit, when picked by barcode. */
  unitId: string | null;
  averageCost: string | null;
}

function pickedFrom(product: Product, variantId: string, unitId: string | null = null): PickedItem | null {
  const variant = product.variants.find((v) => v.id === variantId);
  if (!variant) return null;
  return {
    variantId,
    productId: product.id,
    name: variant.name ? `${product.name} · ${variant.name}` : product.name,
    sku: variant.sku,
    units: product.units.filter((u) => u.is_active),
    unitId,
    averageCost: variant.average_cost,
  };
}

/**
 * Find an item by typing a name/SKU or scanning/typing a barcode + Enter.
 * USB scanners type the code and press Enter, so they work in this field directly.
 */
export function ItemPicker({ onPick, placeholder = "Search or scan an item" }: { onPick: (item: PickedItem) => void; placeholder?: string }) {
  const [text, setText] = useState("");
  const q = useDebouncedValue(text.trim());
  const results = useProducts({ q: q || undefined, limit: 8, offset: 0 });
  const [busy, setBusy] = useState(false);

  const pickProduct = async (productId: string, variantId?: string, unitId: string | null = null) => {
    setBusy(true);
    try {
      const product = await api.get<Product>(`/products/${productId}`);
      const variants = product.variants.filter((v) => v.is_active);
      const target = variantId ?? (variants.length === 1 ? variants[0].id : null);
      if (target) {
        const picked = pickedFrom(product, target, unitId);
        if (picked) onPick(picked);
      } else {
        // Several variants: pick each explicitly from the list below.
        for (const v of variants) {
          const picked = pickedFrom(product, v.id);
          if (picked) onPick(picked);
        }
      }
      setText("");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    const code = text.trim();
    if (!code) return;
    setBusy(true);
    try {
      const found = await lookupBarcode(code);
      const product = await api.get<Product>(`/products/${found.product_id}`);
      const unit = product.units.find((u) => u.id === found.barcode.product_unit_id);
      const picked = pickedFrom(product, found.barcode.variant_id, unit && !unit.is_base ? unit.unit_id : null);
      if (picked) onPick(picked);
      setText("");
    } catch {
      // Not a barcode: fall back to the first search result.
      const first = results.data?.items[0];
      if (first) await pickProduct(first.id);
      else toast.error(`No item matches "${code}"`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <ScanBarcodeIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label={placeholder}
          placeholder={placeholder}
          className="h-10 pl-8"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void scan();
            }
          }}
        />
      </div>
      {q && (results.data?.items.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2">
          {results.data?.items.map((p) => (
            <Button key={p.id} type="button" size="sm" variant="outline" disabled={busy} onClick={() => void pickProduct(p.id)}>
              {p.name} {p.variant_count > 1 && <span className="text-muted-foreground">({p.variant_count})</span>}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Select value for "the base unit" (select values can't be empty). */
export const BASE_UNIT = "__base__";

/** Unit options for a picked item: value = units.id, or BASE_UNIT. */
export function unitOptions(item: PickedItem): { value: string; label: string }[] {
  return item.units.map((u) => ({
    value: u.is_base ? BASE_UNIT : u.unit_id,
    label: u.is_base ? `${u.unit_code} (base)` : `${u.unit_code} ×${qty(u.factor)}`,
  }));
}

/** Request value for a unit select: null means the base unit. */
export function unitIdOrNull(value: string): string | null {
  return value === BASE_UNIT || value === "" ? null : value;
}
