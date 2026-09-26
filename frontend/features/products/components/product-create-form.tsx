"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { SimpleSelect, TextAreaField, TextField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCreateProduct, useReference } from "@/features/catalog/api";
import { errorMessage } from "@/lib/api/errors";
import type { ProductCreate, VariantIn } from "@/types/api-admin";

import { emptyPriceRow, newRowKey, parseCost, type PriceRow, toPriceIn } from "../price-rows";
import { emptyGeneral, type GeneralValues, optionalId, ProductGeneralFields } from "./product-general-fields";
import { PriceListEditor, type UnitOption } from "./price-list-editor";

interface ExtraUnit {
  key: string;
  unitId: string;
  factor: string;
}

interface VariantDraft {
  key: string;
  sku: string;
  name: string;
  cost: string;
  reorderPoint: string;
  barcodes: string;
  prices: PriceRow[];
}

const newVariant = (): VariantDraft => ({
  key: newRowKey(),
  sku: "",
  name: "",
  cost: "",
  reorderPoint: "",
  barcodes: "",
  prices: [emptyPriceRow()],
});

export function splitCodes(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean))];
}

export function ProductCreateForm() {
  const router = useRouter();
  const create = useCreateProduct();
  const { data: units } = useReference("units");
  const [general, setGeneral] = useState<GeneralValues>(emptyGeneral);
  const [extraUnits, setExtraUnits] = useState<ExtraUnit[]>([]);
  const [variants, setVariants] = useState<VariantDraft[]>([newVariant()]);
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const unitCode = (id: string) => units?.find((u) => u.id === id)?.code ?? "?";
  const unitOptions: UnitOption[] = [
    { value: "", label: general.baseUnitId ? `${unitCode(general.baseUnitId)} (base)` : "Base unit" },
    ...extraUnits.filter((u) => u.unitId).map((u) => ({ value: u.unitId, label: `${unitCode(u.unitId)} (×${u.factor || "?"})` })),
  ];
  const updateVariant = (key: string, patch: Partial<VariantDraft>) =>
    setVariants((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch } : v)));

  const submit = async () => {
    setFormError(null);
    if (general.name.trim() === "") return setFormError("Name is required.");
    if (!general.baseUnitId) return setFormError("Choose a base unit.");
    const unitsIn = extraUnits.filter((u) => u.unitId);
    if (unitsIn.some((u) => !/^\d+(\.\d{1,6})?$/.test(u.factor.trim()) || Number(u.factor) <= 0)) {
      return setFormError("Every extra unit needs a factor greater than 0 (how many base units it contains).");
    }
    const allErrors: Record<string, string> = {};
    const variantsIn: VariantIn[] = [];
    for (const v of variants) {
      const { prices, errors } = toPriceIn(v.prices);
      Object.assign(allErrors, errors);
      const cost = parseCost(v.cost);
      if (cost === undefined) return setFormError("Cost must be an amount with up to 4 decimals.");
      variantsIn.push({
        sku: v.sku.trim() || null,
        name: v.name.trim() || null,
        attributes: {},
        cost,
        reorder_point: v.reorderPoint.trim() || null,
        barcodes: splitCodes(v.barcodes).map((code, i) => ({ code, is_primary: i === 0 })),
        prices,
      });
    }
    setPriceErrors(allErrors);
    if (Object.keys(allErrors).length > 0) return setFormError("Fix the highlighted prices.");

    const body: ProductCreate = {
      name: general.name.trim(),
      description: general.description.trim() || null,
      category_id: optionalId(general.categoryId),
      brand_id: optionalId(general.brandId),
      base_unit_id: general.baseUnitId,
      tax_rate_id: optionalId(general.taxRateId),
      track_inventory: general.trackInventory,
      sc_pwd_eligible: general.scPwdEligible,
      units: unitsIn.map((u) => ({ unit_id: u.unitId, factor: u.factor.trim() })),
      variants: variantsIn,
    };
    try {
      const product = await create.mutateAsync(body);
      toast.success(`${product.name} created`);
      router.push(`/products/${product.id}`);
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductGeneralFields value={general} onChange={setGeneral} mode="create" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Other units</CardTitle>
          <CardDescription>E.g. BOX = 12 × PC. Prices and barcodes can be set per unit.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {extraUnits.map((u) => (
            <div key={u.key} className="grid grid-cols-[1fr_8rem_2rem] gap-2">
              <SimpleSelect
                aria-label="Unit"
                value={u.unitId}
                placeholder="Select unit"
                onChange={(v) => setExtraUnits((list) => list.map((x) => (x.key === u.key ? { ...x, unitId: v } : x)))}
                options={(units ?? [])
                  .filter((x) => x.is_active && x.id !== general.baseUnitId)
                  .map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }))}
              />
              <Input
                aria-label="Factor"
                placeholder="Factor"
                inputMode="decimal"
                value={u.factor}
                onChange={(e) => setExtraUnits((list) => list.map((x) => (x.key === u.key ? { ...x, factor: e.target.value } : x)))}
              />
              <Button variant="ghost" size="icon" aria-label="Remove unit" onClick={() => setExtraUnits((list) => list.filter((x) => x.key !== u.key))}>
                <Trash2Icon />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setExtraUnits((l) => [...l, { key: newRowKey(), unitId: "", factor: "" }])}>
            <PlusIcon /> Add unit
          </Button>
        </CardContent>
      </Card>

      {variants.map((v, index) => (
        <Card key={v.key}>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle>{variants.length > 1 ? `Variant ${index + 1}` : "Item details"}</CardTitle>
              <CardDescription>SKU is generated when left blank.</CardDescription>
            </div>
            {variants.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => setVariants((vs) => vs.filter((x) => x.key !== v.key))}>
                Remove
              </Button>
            )}
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <TextField label="SKU" value={v.sku} onChange={(e) => updateVariant(v.key, { sku: e.target.value })} />
              <TextField
                label="Variant name"
                placeholder={variants.length > 1 ? "e.g. Red / L" : "(optional)"}
                value={v.name}
                onChange={(e) => updateVariant(v.key, { name: e.target.value })}
              />
              <TextField label="Unit cost" inputMode="decimal" value={v.cost} onChange={(e) => updateVariant(v.key, { cost: e.target.value })} />
              <TextField
                label="Reorder point"
                inputMode="decimal"
                value={v.reorderPoint}
                onChange={(e) => updateVariant(v.key, { reorderPoint: e.target.value })}
              />
            </div>
            <TextAreaField
              label="Barcodes (base unit; one per line — the first is primary)"
              rows={2}
              value={v.barcodes}
              onChange={(e) => updateVariant(v.key, { barcodes: e.target.value })}
            />
            <div className="space-y-2">
              <p className="text-sm font-medium">Prices</p>
              <PriceListEditor rows={v.prices} onChange={(prices) => updateVariant(v.key, { prices })} units={unitOptions} errors={priceErrors} />
            </div>
          </CardContent>
        </Card>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => setVariants((vs) => [...vs, newVariant()])}>
          <PlusIcon /> Add variant
        </Button>
        <div className="ml-auto flex items-center gap-3">
          {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
          <Button onClick={() => void submit()} disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create product"}
          </Button>
        </div>
      </div>
    </div>
  );
}
