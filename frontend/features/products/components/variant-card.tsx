"use client";

import { SparklesIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SimpleSelect, TextField } from "@/components/shared/form-fields";
import { money, qty } from "@/components/shared/formatters";
import { ActiveBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useAddBarcode,
  useGenerateBarcode,
  useReference,
  useSetPrices,
  useUpdateBarcode,
  useUpdateVariant,
} from "@/features/catalog/api";
import { errorMessage } from "@/lib/api/errors";
import type { Product, Variant } from "@/types/api-admin";

import { fromPrices, type PriceRow, toPriceIn } from "../price-rows";
import { PriceListEditor, type UnitOption } from "./price-list-editor";

interface Props {
  product: Product;
  variant: Variant;
  canEdit: boolean;
  canEditPrices: boolean;
}

const BASE = "__base__";

export function VariantCard({ product, variant, canEdit, canEditPrices }: Props) {
  const { data: levels } = useReference("price-levels");
  const defaultLevelId = levels?.find((l) => l.is_default)?.id;
  const updateVariant = useUpdateVariant();
  const setPrices = useSetPrices(product.id);
  const addBarcode = useAddBarcode(product.id);
  const generate = useGenerateBarcode(product.id);
  const updateBarcode = useUpdateBarcode(product.id);

  const [sku, setSku] = useState(variant.sku);
  const [name, setName] = useState(variant.name ?? "");
  const [reorder, setReorder] = useState(variant.reorder_point ? qty(variant.reorder_point) : "");
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});
  const [code, setCode] = useState("");
  const [codeUnit, setCodeUnit] = useState(BASE);

  // Reset the editors when a new version of the variant loads (e.g. after saving).
  const [syncedVariant, setSyncedVariant] = useState(variant);
  if (variant !== syncedVariant) {
    setSyncedVariant(variant);
    setSku(variant.sku);
    setName(variant.name ?? "");
    setReorder(variant.reorder_point ? qty(variant.reorder_point) : "");
  }
  const priceSource = `${defaultLevelId ?? ""}|${JSON.stringify(variant.prices)}|${product.units.map((u) => u.id).join(",")}`;
  const [syncedPrices, setSyncedPrices] = useState<string | null>(null);
  if (priceSource !== syncedPrices) {
    setSyncedPrices(priceSource);
    setRows(fromPrices(variant.prices, product.units, defaultLevelId));
    setPriceErrors({});
  }

  const unitCode = new Map(product.units.map((u) => [u.id, u.unit_code]));
  const unitOptions: UnitOption[] = product.units
    .filter((u) => u.is_active)
    .map((u) => ({ value: u.is_base ? "" : u.unit_id, label: u.is_base ? `${u.unit_code} (base)` : `${u.unit_code} (×${qty(u.factor)})` }));
  const onError = (e: unknown) => toast.error(errorMessage(e));

  const saveDetails = () =>
    updateVariant.mutate(
      { id: variant.id, data: { sku: sku.trim(), name: name.trim() || null, reorder_point: reorder.trim() || null } },
      { onSuccess: () => toast.success("Variant saved"), onError },
    );
  const savePrices = () => {
    const { prices, errors } = toPriceIn(rows);
    setPriceErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setPrices.mutate({ variantId: variant.id, prices }, { onSuccess: () => toast.success("Prices saved"), onError });
  };
  const barcodeUnitId = codeUnit === BASE ? null : codeUnit;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <span className="font-mono">{variant.sku}</span>
            {variant.name && <span>· {variant.name}</span>}
            {variant.is_default && <Badge variant="secondary">Default</Badge>}
            <ActiveBadge active={variant.is_active} />
          </CardTitle>
          {variant.average_cost !== null && (
            <CardDescription>
              Average cost {money(variant.average_cost)} · last cost {money(variant.last_cost)}
            </CardDescription>
          )}
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-4">
            {!variant.is_default && variant.is_active && (
              <Button size="sm" variant="outline" onClick={() => updateVariant.mutate({ id: variant.id, data: { is_default: true } }, { onError })}>
                Make default
              </Button>
            )}
            {!variant.is_default && (
              <div className="flex items-center gap-2">
                <Switch
                  id={`active-${variant.id}`}
                  checked={variant.is_active}
                  onCheckedChange={(v) => updateVariant.mutate({ id: variant.id, data: { is_active: v } }, { onError })}
                />
                <Label htmlFor={`active-${variant.id}`}>Active</Label>
              </div>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_10rem_auto]">
          <TextField label="SKU" value={sku} disabled={!canEdit} onChange={(e) => setSku(e.target.value)} />
          <TextField label="Variant name" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
          <TextField label="Reorder point" inputMode="decimal" value={reorder} disabled={!canEdit} onChange={(e) => setReorder(e.target.value)} />
          {canEdit && (
            <Button variant="outline" onClick={saveDetails} disabled={updateVariant.isPending}>
              Save
            </Button>
          )}
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Barcodes</h3>
          {variant.barcodes.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead className="hidden sm:table-cell">Type</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  {canEdit && <TableHead className="w-44" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {variant.barcodes.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono">
                      {b.code} {b.is_primary && <Badge variant="secondary">Primary</Badge>}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{b.symbology}</TableCell>
                    <TableCell>{unitCode.get(b.product_unit_id) ?? "—"}</TableCell>
                    <TableCell>
                      <ActiveBadge active={b.is_active} />
                    </TableCell>
                    {canEdit && (
                      <TableCell className="space-x-1 text-right">
                        {b.is_active && !b.is_primary && (
                          <Button size="sm" variant="ghost" onClick={() => updateBarcode.mutate({ id: b.id, data: { is_primary: true } }, { onError })}>
                            Primary
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => updateBarcode.mutate({ id: b.id, data: { is_active: !b.is_active } }, { onError })}>
                          {b.is_active ? "Remove" : "Restore"}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {canEdit && (
            <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto_auto]">
              <Input aria-label="New barcode" placeholder="Scan or type a barcode" value={code} onChange={(e) => setCode(e.target.value)} />
              <SimpleSelect
                aria-label="Barcode unit"
                value={codeUnit}
                onChange={setCodeUnit}
                options={product.units.filter((u) => u.is_active).map((u) => ({ value: u.is_base ? BASE : u.unit_id, label: u.unit_code }))}
              />
              <Button
                variant="outline"
                disabled={!code.trim() || addBarcode.isPending}
                onClick={() =>
                  addBarcode.mutate(
                    { variantId: variant.id, code: code.trim(), unitId: barcodeUnitId },
                    { onSuccess: () => setCode(""), onError },
                  )
                }
              >
                Add
              </Button>
              <Button variant="ghost" disabled={generate.isPending} onClick={() => generate.mutate({ variantId: variant.id, unitId: barcodeUnitId }, { onError })}>
                <SparklesIcon /> Generate
              </Button>
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Prices</h3>
          <PriceListEditor rows={rows} onChange={setRows} units={unitOptions} errors={priceErrors} disabled={!canEditPrices} />
          {canEditPrices && (
            <div className="flex justify-end">
              <Button onClick={savePrices} disabled={setPrices.isPending}>
                {setPrices.isPending ? "Saving…" : "Save prices"}
              </Button>
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
