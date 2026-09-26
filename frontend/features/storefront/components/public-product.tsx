"use client";

import { useQuery } from "@tanstack/react-query";

import { money, qty } from "@/components/shared/formatters";
import { ProductThumb } from "@/components/shared/product-thumb";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import type { Availability, PublicProduct, PublicProductDetail } from "@/types/api-public";

import { fetchPublic, productPath } from "../public-api";

const AVAILABILITY: Record<Availability, { label: string; className: string }> = {
  IN_STOCK: { label: "In stock", className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  LOW_STOCK: { label: "Low stock", className: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  OUT_OF_STOCK: { label: "Out of stock", className: "bg-muted text-muted-foreground" },
};

export function AvailabilityBadge({ availability, quantity }: { availability: Availability; quantity?: string | null }) {
  const { label, className } = AVAILABILITY[availability];
  const text = quantity != null && availability !== "OUT_OF_STOCK" ? `${qty(quantity)} left` : label;
  return (
    <Badge variant="secondary" className={className}>
      {text}
    </Badge>
  );
}

/** "₱52.00", "₱52.00 / kilogram", "from ₱75.00". The unit is omitted for plain pieces. */
export function priceText(price: string, unit: string, varies: boolean): string {
  const perUnit = unit && !["piece", "pc", "pcs", "pieces"].includes(unit.toLowerCase()) ? ` / ${unit.toLowerCase()}` : "";
  return `${varies ? "from " : ""}${money(price)}${perUnit}`;
}

export function ProductCard({ product, onOpen }: { product: PublicProduct; onOpen: () => void }) {
  const out = product.availability === "OUT_OF_STOCK";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="bg-card hover:border-primary/40 focus-visible:ring-ring/50 flex flex-col overflow-hidden rounded-xl border text-left transition-colors outline-none focus-visible:ring-3"
    >
      <ProductThumb
        src={product.image_url}
        alt=""
        className={cn("aspect-square size-auto w-full rounded-none border-0 border-b", out && "opacity-60")}
      />
      <div className="flex flex-1 flex-col gap-1 p-3">
        {product.brand && <span className="text-muted-foreground text-xs">{product.brand}</span>}
        <span className="line-clamp-2 text-sm leading-snug font-medium">{product.name}</span>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
          {product.price != null && (
            <span className="text-sm font-semibold tabular-nums">{priceText(product.price, product.unit, product.price_varies)}</span>
          )}
          {product.availability && <AvailabilityBadge availability={product.availability} quantity={product.quantity} />}
        </div>
      </div>
    </button>
  );
}

export function ProductDetailDialog({
  slug,
  branch,
  product,
  onClose,
}: {
  slug: string;
  branch: string | null;
  product: PublicProduct | null;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: ["public", slug, "product", product?.id, branch],
    queryFn: ({ signal }) => fetchPublic<PublicProductDetail>(productPath(slug, product!.id, branch), signal),
    enabled: product !== null,
  });
  const data = detail.data;
  return (
    <Dialog open={product !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {product && (
          <>
            <ProductThumb src={product.image_url} alt={product.name} className="mx-auto aspect-square size-auto w-full max-w-72" />
            <DialogHeader>
              {product.brand && <span className="text-muted-foreground text-sm">{product.brand}</span>}
              <DialogTitle className="text-lg">{product.name}</DialogTitle>
              <DialogDescription render={<div />}>
                {detail.isPending ? (
                  <Skeleton className="h-4 w-2/3" />
                ) : detail.error ? (
                  errorMessage(detail.error)
                ) : (
                  data?.description ?? (product.category ? `Category: ${product.category}` : null)
                )}
              </DialogDescription>
            </DialogHeader>
            {data && (
              <ul className="divide-y rounded-lg border">
                {data.variants.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span>{v.name ?? (data.variants.length === 1 ? "Price" : "Regular")}</span>
                    <span className="flex items-center gap-2">
                      {v.price != null && (
                        <span className="font-semibold tabular-nums">{priceText(v.price, data.unit, false)}</span>
                      )}
                      {v.availability && <AvailabilityBadge availability={v.availability} quantity={v.quantity} />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
