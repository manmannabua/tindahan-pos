"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useUpdateProduct } from "@/features/catalog/api";
import { errorMessage } from "@/lib/api/errors";
import type { Product } from "@/types/api-admin";

import { type GeneralValues, NONE, optionalId, ProductGeneralFields } from "./product-general-fields";
import { ProductPhotoEditor } from "./product-photo";

function toValues(p: Product): GeneralValues {
  return {
    name: p.name,
    description: p.description ?? "",
    categoryId: p.category_id ?? NONE,
    brandId: p.brand_id ?? NONE,
    baseUnitId: p.base_unit_id,
    taxRateId: p.tax_rate_id,
    trackInventory: p.track_inventory,
    scPwdEligible: p.sc_pwd_eligible,
    isActive: p.is_active,
  };
}

export function ProductGeneralCard({ product, canEdit }: { product: Product; canEdit: boolean }) {
  const update = useUpdateProduct(product.id);
  const [values, setValues] = useState(() => toValues(product));
  // Reset the form when a new version of the product is loaded (e.g. after saving).
  const [syncedFrom, setSyncedFrom] = useState(product);
  if (product !== syncedFrom) {
    setSyncedFrom(product);
    setValues(toValues(product));
  }

  const save = async () => {
    try {
      await update.mutateAsync({
        name: values.name.trim(),
        description: values.description.trim() || null,
        category_id: optionalId(values.categoryId),
        brand_id: optionalId(values.brandId),
        tax_rate_id: values.taxRateId,
        track_inventory: values.trackInventory,
        sc_pwd_eligible: values.scPwdEligible,
        is_active: values.isActive,
      });
      toast.success("Product saved");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          General
          {product.sc_pwd_eligible && <Badge variant="secondary">SC/PWD eligible</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ProductPhotoEditor
          productId={product.id}
          name={product.name}
          imageUrl={product.image_url ?? null}
          canEdit={canEdit}
        />
        <fieldset disabled={!canEdit} className="contents">
          <ProductGeneralFields value={values} onChange={setValues} mode="edit" />
        </fieldset>
        {canEdit && (
          <div className="flex justify-end">
            <Button onClick={() => void save()} disabled={update.isPending || values.name.trim() === ""}>
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
