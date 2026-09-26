"use client";

import { useState } from "react";
import { toast } from "sonner";

import { TextField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAddVariant } from "@/features/catalog/api";
import { errorMessage } from "@/lib/api/errors";

import { parseCost } from "../price-rows";
import { splitCodes } from "./product-create-form";

export function AddVariantDialog({
  productId,
  open,
  onOpenChange,
}: {
  productId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const add = useAddVariant(productId);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [barcodes, setBarcodes] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Clear the form each time the dialog opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
    setSku("");
    setName("");
    setCost("");
    setBarcodes("");
    setPrice("");
    setError(null);
    }
  }

  const submit = async () => {
    const parsedCost = parseCost(cost);
    if (parsedCost === undefined) return setError("Cost must be an amount with up to 4 decimals.");
    if (price.trim() && !/^\d+(\.\d{1,2})?$/.test(price.trim())) return setError("Price must be an amount like 25.50.");
    try {
      await add.mutateAsync({
        sku: sku.trim() || null,
        name: name.trim() || null,
        attributes: {},
        cost: parsedCost,
        barcodes: splitCodes(barcodes).map((code, i) => ({ code, is_primary: i === 0 })),
        prices: price.trim() ? [{ price: price.trim(), min_quantity: "1" }] : [],
      });
      toast.success("Variant added");
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add variant</DialogTitle>
          <DialogDescription>More prices and barcodes can be added afterwards.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="SKU (optional)" value={sku} onChange={(e) => setSku(e.target.value)} />
            <TextField label="Name, e.g. Red / L" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField label="Unit cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
            <TextField label="Price (base unit)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <TextField label="Barcodes (space separated)" value={barcodes} onChange={(e) => setBarcodes(e.target.value)} />
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={add.isPending}>
            Add variant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
