"use client";

import { Trash2Icon } from "lucide-react";

import { SimpleSelect } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { newRowKey } from "@/features/products/price-rows";

import { BASE_UNIT, ItemPicker, type PickedItem, unitOptions } from "./item-picker";

export interface ItemLine {
  key: string;
  item: PickedItem;
  /** Unit select value (BASE_UNIT or units.id). */
  unit: string;
  quantity: string;
  extra: Record<string, string>;
}

export interface ExtraColumn {
  key: string;
  label: string;
  width?: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
  initial?: (item: PickedItem) => string;
}

interface Props {
  lines: ItemLine[];
  onChange: (lines: ItemLine[]) => void;
  /** Hide the unit column (e.g. initial stock is entered in base units). */
  baseUnitOnly?: boolean;
  extra?: ExtraColumn[];
  quantityLabel?: string;
  /** Scanning an item already listed adds 1 to its quantity instead of a new line. */
  mergeScans?: boolean;
}

export function newLine(item: PickedItem, extra: ExtraColumn[] = []): ItemLine {
  return {
    key: newRowKey(),
    item,
    unit: item.unitId ?? BASE_UNIT,
    quantity: "1",
    extra: Object.fromEntries(extra.map((c) => [c.key, c.initial?.(item) ?? c.options?.[0]?.value ?? ""])),
  };
}

export function ItemLinesEditor({ lines, onChange, baseUnitOnly, extra = [], quantityLabel = "Qty", mergeScans = true }: Props) {
  const update = (key: string, patch: Partial<ItemLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = (item: PickedItem) => {
    const unit = baseUnitOnly ? BASE_UNIT : (item.unitId ?? BASE_UNIT);
    const existing = mergeScans ? lines.find((l) => l.item.variantId === item.variantId && l.unit === unit) : undefined;
    if (existing && /^\d+$/.test(existing.quantity)) {
      update(existing.key, { quantity: String(Number.parseInt(existing.quantity, 10) + 1) });
    } else {
      onChange([...lines, { ...newLine(item, extra), unit }]);
    }
  };

  return (
    <div className="space-y-3">
      <ItemPicker onPick={add} />
      {lines.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {lines.map((line) => (
            <li key={line.key} className="grid gap-2 p-2 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{line.item.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{line.item.sku}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!baseUnitOnly && (
                  <SimpleSelect
                    aria-label="Unit"
                    className="w-32"
                    value={line.unit}
                    onChange={(v) => update(line.key, { unit: v })}
                    options={unitOptions(line.item)}
                  />
                )}
                <Input
                  aria-label={quantityLabel}
                  title={quantityLabel}
                  inputMode="decimal"
                  className="w-24 tabular-nums"
                  value={line.quantity}
                  onChange={(e) => update(line.key, { quantity: e.target.value })}
                />
                {extra.map((col) =>
                  col.options ? (
                    <SimpleSelect
                      key={col.key}
                      aria-label={col.label}
                      className={col.width ?? "w-36"}
                      value={line.extra[col.key] ?? ""}
                      onChange={(v) => update(line.key, { extra: { ...line.extra, [col.key]: v } })}
                      options={col.options}
                    />
                  ) : (
                    <Input
                      key={col.key}
                      aria-label={col.label}
                      title={col.label}
                      placeholder={col.placeholder ?? col.label}
                      inputMode="decimal"
                      className={col.width ?? "w-28"}
                      value={line.extra[col.key] ?? ""}
                      onChange={(e) => update(line.key, { extra: { ...line.extra, [col.key]: e.target.value } })}
                    />
                  ),
                )}
                <Button variant="ghost" size="icon" aria-label="Remove line" onClick={() => onChange(lines.filter((l) => l.key !== line.key))}>
                  <Trash2Icon />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const QTY = /^\d+(\.\d{1,3})?$/;

/** Returns an error message for the first invalid quantity, or null. */
export function validateQuantities(lines: ItemLine[], allowZero = false): string | null {
  if (lines.length === 0) return "Add at least one item.";
  for (const line of lines) {
    const q = line.quantity.trim();
    if (!QTY.test(q) || (!allowZero && Number(q) === 0)) return `Invalid quantity for ${line.item.name}.`;
  }
  return null;
}
