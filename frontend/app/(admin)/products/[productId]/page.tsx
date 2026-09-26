"use client";

import { ArrowLeftIcon, PlusIcon, PrinterIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { usePermissionInAnyScope } from "@/features/auth/hooks";
import { useProduct } from "@/features/catalog/api";
import { AddVariantDialog } from "@/features/products/components/add-variant-dialog";
import { ProductGeneralCard } from "@/features/products/components/product-general-card";
import { ProductUnitsCard } from "@/features/products/components/product-units-card";
import { VariantCard } from "@/features/products/components/variant-card";
import { ADMIN_PERM } from "@/features/shell/permissions";

export default function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const { data: product, isPending, error, refetch } = useProduct(productId);
  const canEdit = usePermissionInAnyScope(ADMIN_PERM.PRODUCTS_WRITE);
  const canEditPrices = usePermissionInAnyScope(ADMIN_PERM.PRICES_WRITE);
  const [adding, setAdding] = useState(false);

  if (isPending) return <TableSkeleton />;
  if (error) return <QueryError error={error} onRetry={() => void refetch()} />;

  return (
    <>
      <Link href="/products" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Products
      </Link>
      <PageHeader
        title={product.name}
        actions={
          <>
            <Link href={`/products/labels?product=${product.id}`} className={buttonVariants({ variant: "outline" })}>
              <PrinterIcon /> Print labels
            </Link>
            {canEdit && (
              <Button variant="outline" onClick={() => setAdding(true)}>
                <PlusIcon /> Add variant
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-6">
        <ProductGeneralCard product={product} canEdit={canEdit} />
        <ProductUnitsCard product={product} canEdit={canEdit} />
        {product.variants.map((v) => (
          <VariantCard key={v.id} product={product} variant={v} canEdit={canEdit} canEditPrices={canEditPrices} />
        ))}
      </div>
      <AddVariantDialog productId={product.id} open={adding} onOpenChange={setAdding} />
    </>
  );
}
