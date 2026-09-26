"use client";

import { useState } from "react";
import { toast } from "sonner";

import { TextField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/api/errors";

import { usePostInitialStock } from "../api";
import { type ItemLine, ItemLinesEditor, validateQuantities } from "./item-lines-editor";
import { StockLocationSelect } from "./stock-location-select";

const COST = /^\d+(\.\d{1,4})?$/;

/** Opening balances (when starting to use the system). Quantities in base units. */
export function InitialStockForm() {
  const post = usePostInitialStock();
  const [locationId, setLocationId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<ItemLine[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    let invalid = !locationId ? "Choose a location." : validateQuantities(lines);
    const badCost = lines.find((l) => l.extra.cost && !COST.test(l.extra.cost.trim()));
    if (!invalid && badCost) invalid = `Invalid cost for ${badCost.item.name}.`;
    setProblem(invalid);
    if (invalid) return;
    try {
      const result = await post.mutateAsync({
        stock_location_id: locationId,
        note: note.trim() || null,
        lines: lines.map((l) => ({ variant_id: l.item.variantId, quantity: l.quantity.trim(), unit_cost: l.extra.cost?.trim() || null })),
      });
      toast.success(`Posted ${result.posted} line(s)${result.skipped_untracked ? `, ${result.skipped_untracked} not stock-tracked` : ""}`);
      setLines([]);
    } catch (e) {
      setProblem(errorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Initial stock</CardTitle>
        <CardDescription>Opening quantities in each item&apos;s base unit. The cost is used when an item has no cost yet.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>Location</Label>
            <StockLocationSelect value={locationId} onChange={setLocationId} />
          </div>
          <TextField label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <ItemLinesEditor
          lines={lines}
          onChange={setLines}
          baseUnitOnly
          quantityLabel="Quantity (base unit)"
          extra={[{ key: "cost", label: "Unit cost", initial: (item) => item.averageCost && Number(item.averageCost) > 0 ? item.averageCost : "" }]}
        />
        {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
        <div className="flex justify-end">
          <Button onClick={() => void submit()} disabled={post.isPending}>
            Post initial stock
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
