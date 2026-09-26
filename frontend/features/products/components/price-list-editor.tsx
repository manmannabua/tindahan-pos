"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";

import { SimpleSelect } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBranches } from "@/features/branches/api";
import { useReference } from "@/features/catalog/api";

import { emptyPriceRow, type PriceRow } from "../price-rows";

export interface UnitOption {
  /** units.id, "" = base unit */
  value: string;
  label: string;
}

interface PriceListEditorProps {
  rows: PriceRow[];
  onChange: (rows: PriceRow[]) => void;
  units: UnitOption[];
  errors?: Record<string, string>;
  disabled?: boolean;
}

/** Select values can't be "", so blank choices (base unit, default level, all branches) use a sentinel. */
const NONE = "__none__";
const enc = (v: string) => v || NONE;
const dec = (v: string) => (v === NONE ? "" : v);
const encOptions = (options: { value: string; label: string }[]) => options.map((o) => ({ ...o, value: enc(o.value) }));

/** Editable price tiers: unit × price level × branch × minimum quantity → price. */
export function PriceListEditor({ rows, onChange, units, errors = {}, disabled }: PriceListEditorProps) {
  const { data: levels } = useReference("price-levels");
  const { data: branches } = useBranches();
  const levelOptions = [
    { value: "", label: "Default level" },
    ...(levels ?? []).filter((l) => !l.is_default).map((l) => ({ value: l.id, label: l.name })),
  ];
  const branchOptions = [{ value: "", label: "All branches" }, ...(branches ?? []).map((b) => ({ value: b.id, label: b.name }))];
  const update = (key: string, patch: Partial<PriceRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <div className="hidden grid-cols-[1fr_1fr_1fr_6rem_7rem_2rem] gap-2 px-1 text-xs text-muted-foreground md:grid">
          <span>Unit</span>
          <span>Price level</span>
          <span>Branch</span>
          <span>Min qty</span>
          <span>Price</span>
          <span />
        </div>
      )}
      {rows.map((row) => (
        <div key={row.key} className="space-y-1">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-[1fr_1fr_1fr_6rem_7rem_2rem]">
            <SimpleSelect aria-label="Unit" value={enc(row.unitId)} onChange={(v) => update(row.key, { unitId: dec(v) })} options={encOptions(units)} disabled={disabled} />
            <SimpleSelect aria-label="Price level" value={enc(row.levelId)} onChange={(v) => update(row.key, { levelId: dec(v) })} options={encOptions(levelOptions)} disabled={disabled} />
            <SimpleSelect aria-label="Branch" value={enc(row.branchId)} onChange={(v) => update(row.key, { branchId: dec(v) })} options={encOptions(branchOptions)} disabled={disabled} />
            <Input
              aria-label="Minimum quantity"
              inputMode="decimal"
              value={row.minQuantity}
              onChange={(e) => update(row.key, { minQuantity: e.target.value })}
              disabled={disabled}
            />
            <Input
              aria-label="Price"
              inputMode="decimal"
              placeholder="0.00"
              className="tabular-nums"
              value={row.price}
              aria-invalid={errors[row.key] ? true : undefined}
              onChange={(e) => update(row.key, { price: e.target.value })}
              disabled={disabled}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove price"
              disabled={disabled}
              onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
            >
              <Trash2Icon />
            </Button>
          </div>
          {errors[row.key] && <p className="text-xs text-destructive">{errors[row.key]}</p>}
        </div>
      ))}
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => onChange([...rows, emptyPriceRow()])}>
        <PlusIcon /> Add price
      </Button>
    </div>
  );
}
