"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { TextAreaField, TextField } from "@/components/shared/form-fields";
import { money } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { unitIdOrNull } from "@/features/inventory/components/item-picker";
import { type ItemLine, ItemLinesEditor, validateQuantities } from "@/features/inventory/components/item-lines-editor";
import { StockLocationSelect } from "@/features/inventory/components/stock-location-select";
import { useCreatePurchaseOrder } from "@/features/purchasing/api";
import { SupplierSelect } from "@/features/purchasing/components/supplier-select";
import { errorMessage } from "@/lib/api/errors";
import { add, isValidDecimal, multiply, roundMoney } from "@/lib/money";

const COST = /^\d+(\.\d{1,4})?$/;

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const create = useCreatePurchaseOrder();
  const [supplierId, setSupplierId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ItemLine[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const total = add(
    ...lines
      .filter((l) => isValidDecimal(l.quantity) && isValidDecimal(l.extra.cost ?? ""))
      .map((l) => roundMoney(multiply(l.quantity, l.extra.cost))),
  );

  const submit = async () => {
    let invalid = !supplierId ? "Choose a supplier." : !locationId ? "Choose the delivery location." : validateQuantities(lines);
    const badCost = lines.find((l) => !COST.test((l.extra.cost ?? "").trim()));
    if (!invalid && badCost) invalid = `Enter a unit cost for ${badCost.item.name}.`;
    setProblem(invalid);
    if (invalid) return;
    try {
      const po = await create.mutateAsync({
        supplier_id: supplierId,
        stock_location_id: locationId,
        expected_date: expected || null,
        notes: notes.trim() || null,
        lines: lines.map((l) => ({
          variant_id: l.item.variantId,
          unit_id: unitIdOrNull(l.unit),
          quantity: l.quantity.trim(),
          unit_cost: l.extra.cost.trim(),
        })),
      });
      router.push(`/purchase-orders/${po.id}`);
    } catch (e) {
      setProblem(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader title="New purchase order" description="Saved as a draft; approve it before receiving goods." />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Order</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>Supplier</Label>
              <SupplierSelect value={supplierId} onChange={setSupplierId} />
            </div>
            <div className="grid gap-2">
              <Label>Deliver to</Label>
              <StockLocationSelect value={locationId} onChange={setLocationId} />
            </div>
            <TextField label="Expected date" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
            <div className="sm:col-span-3">
              <TextAreaField label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ItemLinesEditor
              lines={lines}
              onChange={setLines}
              extra={[{ key: "cost", label: "Unit cost", placeholder: "Cost / unit", currencyDecimals: 4 }]}
            />
            <div className="flex flex-wrap items-center justify-end gap-4">
              {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
              <p className="text-sm">
                Total <span className="text-lg font-semibold tabular-nums">{money(total.toFixed(2))}</span>
              </p>
              <Button onClick={() => void submit()} disabled={create.isPending}>
                Create draft
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
