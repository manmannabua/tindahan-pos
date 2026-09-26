"use client";

import { DownloadIcon, PackageIcon, PlusIcon, PrinterIcon, UploadIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { SimpleSelect } from "@/components/shared/form-fields";
import { money } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { SearchInput } from "@/components/shared/search-input";
import { ActiveBadge } from "@/components/shared/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermissionInAnyScope } from "@/features/auth/hooks";
import { useCategories, useProducts, useReference } from "@/features/catalog/api";
import { flattenCategories } from "@/features/catalog/category-tree";
import { downloadAuthed } from "@/features/shell/download";
import { ADMIN_PERM } from "@/features/shell/permissions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/api/errors";

const PAGE_SIZE = 25;
const ALL = "__all__";

export default function ProductsPage() {
  const router = useRouter();
  const canWrite = usePermissionInAnyScope(ADMIN_PERM.PRODUCTS_WRITE);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState(ALL);
  const [brandId, setBrandId] = useState(ALL);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [offset, setOffset] = useState(0);
  const q = useDebouncedValue(search.trim());
  const { data: categories } = useCategories();
  const { data: brands } = useReference("brands");
  const { data, isPending, error, refetch, isPlaceholderData } = useProducts({
    q: q || undefined,
    category_id: categoryId === ALL ? undefined : categoryId,
    brand_id: brandId === ALL ? undefined : brandId,
    include_inactive: includeInactive,
    limit: PAGE_SIZE,
    offset,
  });
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setOffset(0);
  };

  return (
    <>
      <PageHeader
        title="Products"
        description="Search by name, SKU or barcode."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => downloadAuthed("/exports/products.csv", "products.csv").catch((e: unknown) => toast.error(errorMessage(e)))}
            >
              <DownloadIcon /> Export CSV
            </Button>
            <Link href="/products/labels" className={buttonVariants({ variant: "outline" })}>
              <PrinterIcon /> Labels
            </Link>
            {canWrite && (
              <>
                <Link href="/products/import" className={buttonVariants({ variant: "outline" })}>
                  <UploadIcon /> Import
                </Link>
                <Link href="/products/new" className={buttonVariants()}>
                  <PlusIcon /> New product
                </Link>
              </>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchInput value={search} onChange={resetPage(setSearch)} placeholder="Search name, SKU or barcode" />
        <SimpleSelect
          aria-label="Category"
          className="w-full lg:w-52"
          value={categoryId}
          onChange={resetPage(setCategoryId)}
          options={[{ value: ALL, label: "All categories" }, ...flattenCategories(categories ?? []).map((n) => ({ value: n.category.id, label: n.path }))]}
        />
        <SimpleSelect
          aria-label="Brand"
          className="w-full lg:w-44"
          value={brandId}
          onChange={resetPage(setBrandId)}
          options={[{ value: ALL, label: "All brands" }, ...(brands ?? []).map((b) => ({ value: b.id, label: b.name }))]}
        />
        <div className="flex items-center gap-2">
          <Switch id="inactive-products" checked={includeInactive} onCheckedChange={resetPage(setIncludeInactive)} />
          <Label htmlFor="inactive-products">Show inactive</Label>
        </div>
      </div>

      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={PackageIcon} title="No products found" description={q ? "Try a different search." : "Create or import your first product."} />
      ) : (
        <div className={isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">SKU</TableHead>
                  <TableHead className="hidden lg:table-cell">Barcode</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="hidden w-20 text-right sm:table-cell">Variants</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((p) => (
                  <TableRow key={p.id} className="h-12 cursor-pointer" onClick={() => router.push(`/products/${p.id}`)}>
                    <TableCell className="font-medium">
                      {p.name}
                      {!p.track_inventory && <span className="ml-2 text-xs text-muted-foreground">(not stocked)</span>}
                    </TableCell>
                    <TableCell className="hidden font-mono text-sm md:table-cell">{p.sku ?? "—"}</TableCell>
                    <TableCell className="hidden font-mono text-sm lg:table-cell">{p.barcode ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(p.price)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{p.variant_count}</TableCell>
                    <TableCell>
                      <ActiveBadge active={p.is_active} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} shown={data.items.length} onChange={setOffset} />
        </div>
      )}
    </>
  );
}
