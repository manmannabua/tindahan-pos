"use client";

import { SelectField, TextAreaField, TextField } from "@/components/shared/form-fields";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCategories, useReference } from "@/features/catalog/api";
import { flattenCategories } from "@/features/catalog/category-tree";

export const NONE = "__none__";

export interface GeneralValues {
  name: string;
  description: string;
  categoryId: string;
  brandId: string;
  baseUnitId: string;
  taxRateId: string;
  trackInventory: boolean;
  /** Senior citizen / PWD discount applies (e.g. medicines). */
  scPwdEligible: boolean;
  /** Listed in the public online catalog. */
  showOnline: boolean;
  isActive: boolean;
}

export const emptyGeneral: GeneralValues = {
  name: "",
  description: "",
  categoryId: NONE,
  brandId: NONE,
  baseUnitId: "",
  taxRateId: NONE,
  trackInventory: true,
  scPwdEligible: false,
  showOnline: false,
  isActive: true,
};

interface Props {
  value: GeneralValues;
  onChange: (value: GeneralValues) => void;
  /** Base unit can't change after creation (stock is stored in it). */
  mode: "create" | "edit";
  nameError?: string;
}

export function ProductGeneralFields({ value, onChange, mode, nameError }: Props) {
  const { data: categories } = useCategories();
  const { data: brands } = useReference("brands");
  const { data: units } = useReference("units");
  const { data: taxes } = useReference("tax-rates");
  const set = <K extends keyof GeneralValues>(key: K, v: GeneralValues[K]) => onChange({ ...value, [key]: v });

  return (
    <div className="grid gap-4">
      <TextField label="Name" value={value.name} onChange={(e) => set("name", e.target.value)} error={nameError} />
      <TextAreaField label="Description" rows={2} value={value.description} onChange={(e) => set("description", e.target.value)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Category"
          value={value.categoryId}
          onChange={(v) => set("categoryId", v)}
          options={[
            { value: NONE, label: "— None —" },
            ...flattenCategories((categories ?? []).filter((c) => c.is_active)).map((n) => ({ value: n.category.id, label: n.path })),
          ]}
        />
        <SelectField
          label="Brand"
          value={value.brandId}
          onChange={(v) => set("brandId", v)}
          options={[{ value: NONE, label: "— None —" }, ...(brands ?? []).filter((b) => b.is_active).map((b) => ({ value: b.id, label: b.name }))]}
        />
        {mode === "create" && (
          <SelectField
            label="Base unit (stock is counted in this unit)"
            value={value.baseUnitId}
            onChange={(v) => set("baseUnitId", v)}
            placeholder="Select unit"
            options={(units ?? []).filter((u) => u.is_active).map((u) => ({ value: u.id, label: `${u.code} · ${u.name}` }))}
          />
        )}
        <SelectField
          label="Tax"
          value={value.taxRateId}
          onChange={(v) => set("taxRateId", v)}
          options={[
            ...(mode === "create" ? [{ value: NONE, label: "Company default" }] : []),
            ...(taxes ?? []).filter((t) => t.is_active).map((t) => ({ value: t.id, label: `${t.name} (${t.rate}%)` })),
          ]}
        />
      </div>
      <div className="flex flex-wrap gap-6">
        <div className="flex items-center gap-2">
          <Switch id="track-inventory" checked={value.trackInventory} onCheckedChange={(v) => set("trackInventory", v)} />
          <Label htmlFor="track-inventory">Track inventory</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="sc-pwd-eligible" checked={value.scPwdEligible} onCheckedChange={(v) => set("scPwdEligible", v)} />
          <Label htmlFor="sc-pwd-eligible">Senior citizen / PWD discount applies</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="show-online" checked={value.showOnline} onCheckedChange={(v) => set("showOnline", v)} />
          <Label htmlFor="show-online">Show in online catalog</Label>
        </div>
        {mode === "edit" && (
          <div className="flex items-center gap-2">
            <Switch id="product-active" checked={value.isActive} onCheckedChange={(v) => set("isActive", v)} />
            <Label htmlFor="product-active">Active (sellable)</Label>
          </div>
        )}
      </div>
    </div>
  );
}

export function optionalId(value: string): string | null {
  return value === NONE || value === "" ? null : value;
}
