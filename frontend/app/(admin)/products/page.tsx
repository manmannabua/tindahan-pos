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
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFeature, usePermissionInAnyScope } from "@/features/auth/hooks";
import { useCategories, useProducts, useReference } from "@/features/catalog/api";
import { flattenCategories } from "@/features/catalog/category-tree";
import { ProductThumb } from "@/components/shared/product-thumb";
import { downloadAuthed } from "@/features/shell/download";
import { FilterOnlineMenu, SelectedOnlineActions } from "@/features/storefront/components/online-bulk-actions";
import { ADMIN_PERM } from "@/features/shell/permissions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/api/errors";

const PAGE_SIZE = 25;
const ALL = "__all__";

export default function ProductsPage() {
  const router = useRouter();
  const canWrite = usePermissionInAnyScope(ADMIN_PERM.PRODUCTS_WRITE);
  const onlineCatalog = useFeature("online_catalog");
  const scPwd = useFeature("sc_pwd");
  // Row selection only serves the online-catalog bulk actions.
  const canSelect = canWrite && onlineCatalog;
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState(ALL);
  const [brandId, setBrandId] = useState(ALL);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [online, setOnline] = useState(ALL);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const q = useDebouncedValue(search.trim());
  const { data: categories } = useCategories();
  const { data: brands } = useReference("brands");
  const filter = {
    q: q || undefined,
    category_id: categoryId === ALL ? undefined : categoryId,
    brand_id: brandId === ALL ? undefined : brandId,
    include_inactive: includeInactive,
    online: online === ALL ? undefined : online === "yes",
  };
  const { data, isPending, error, refetch, isPlaceholderData } = useProducts({
    ...filter,
    limit: PAGE_SIZE,
    offset,
  });
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setOffset(0);
    setSelected(new Set());
  };
  const pageIds = data?.items.map((p) => p.id) ?? [];
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const togglePage = (on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of pageIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

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
                {onlineCatalog && <FilterOnlineMenu filter={filter} total={data?.total ?? 0} />}
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
        {onlineCatalog && (
        <SimpleSelect
          aria-label="Online"
          className="w-full lg:w-40"
          value={online}
          onChange={resetPage(setOnline)}
          options={[
            { value: ALL, label: "Online: any" },
            { value: "yes", label: "Shown online" },
            { value: "no", label: "Not shown online" },
          ]}
        />
        )}
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
          {selected.size > 0 && <SelectedOnlineActions ids={[...selected]} onDone={() => setSelected(new Set())} />}
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  {canSelect && (
                    <TableHead className="w-10">
                      <Checkbox aria-label="Select all on this page" checked={allOnPageSelected} onCheckedChange={togglePage} />
                    </TableHead>
                  )}
                  <TableHead className="w-14">
                    <span className="sr-only">Photo</span>
                  </TableHead>
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
                  <TableRow key={p.id} className="h-14 cursor-pointer" onClick={() => router.push(`/products/${p.id}`)}>
                    {canSelect && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox aria-label={`Select ${p.name}`} checked={selected.has(p.id)} onCheckedChange={(on) => toggle(p.id, on)} />
                      </TableCell>
                    )}
                    <TableCell className="py-1.5">
                      <ProductThumb src={p.image_url} alt="" />
                    </TableCell>
                    <TableCell className="font-medium">
                      {p.name}
                      {!p.track_inventory && <span className="ml-2 text-xs text-muted-foreground">(not stocked)</span>}
                    </TableCell>
                    <TableCell className="hidden font-mono text-sm md:table-cell">{p.sku ?? "—"}</TableCell>
                    <TableCell className="hidden font-mono text-sm lg:table-cell">{p.barcode ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(p.price)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{p.variant_count}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <ActiveBadge active={p.is_active} />
                        {scPwd && p.sc_pwd_eligible && <Badge variant="secondary">SC/PWD</Badge>}
                        {onlineCatalog && p.show_online && <Badge variant="outline">Online</Badge>}
                      </div>
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
