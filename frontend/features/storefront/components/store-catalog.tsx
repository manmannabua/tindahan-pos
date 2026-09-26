"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ClockIcon, MapPinIcon, MessageCircleIcon, PhoneIcon, SearchXIcon, StoreIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { SimpleSelect } from "@/components/shared/form-fields";
import { QueryError } from "@/components/shared/query-state";
import { SearchInput } from "@/components/shared/search-input";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cn } from "@/lib/utils";
import type { PublicProduct, PublicProductPage, PublicStore } from "@/types/api-public";

import {
  type CatalogQuery,
  catalogSearch,
  fetchPublic,
  PAGE_SIZE,
  productsPath,
  REFRESH_MS,
  timeAgo,
} from "../public-api";
import { ProductCard, ProductDetailDialog } from "./public-product";

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function StoreHeader({ store, branchId }: { store: PublicStore; branchId: string }) {
  const branch = store.branches.find((b) => b.id === branchId) ?? store.branches[0];
  const phone = store.phone ?? branch?.phone;
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-5">
        <div className="bg-primary text-primary-foreground flex size-11 shrink-0 items-center justify-center rounded-xl">
          <StoreIcon className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{store.name}</h1>
          {store.about && <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{store.about}</p>}
          <ul className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {branch?.address && (
              <li className="flex items-center gap-1.5">
                <MapPinIcon className="size-4" aria-hidden />
                {branch.address}
              </li>
            )}
            {store.hours && (
              <li className="flex items-center gap-1.5">
                <ClockIcon className="size-4" aria-hidden />
                {store.hours}
              </li>
            )}
            {phone && (
              <li>
                <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="hover:text-foreground flex items-center gap-1.5">
                  <PhoneIcon className="size-4" aria-hidden />
                  {phone}
                </a>
              </li>
            )}
            {store.messenger_url && (
              <li>
                <a href={store.messenger_url} target="_blank" rel="noopener noreferrer nofollow" className="hover:text-foreground flex items-center gap-1.5">
                  <MessageCircleIcon className="size-4" aria-hidden />
                  Message us
                </a>
              </li>
            )}
          </ul>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}

export function StoreCatalog({
  slug,
  store,
  initialQuery,
  initialPage,
}: {
  slug: string;
  store: PublicStore;
  initialQuery: CatalogQuery;
  initialPage: PublicProductPage;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(initialQuery.q);
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState<PublicProduct | null>(null);
  const debouncedSearch = useDebouncedValue(search, 350);
  const now = useNow(30_000);
  // The typed search only applies once the shopper pauses (debounced).
  const effective: CatalogQuery = debouncedSearch === query.q ? query : { ...query, q: debouncedSearch, page: 1 };
  const isInitial = catalogSearch(effective) === catalogSearch(initialQuery);

  const products = useQuery({
    queryKey: ["public", slug, "products", effective],
    queryFn: ({ signal }) => fetchPublic<PublicProductPage>(productsPath(slug, effective), signal),
    initialData: isInitial ? initialPage : undefined,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    // Stock is "live": refresh while the page is open and visible (not in background tabs).
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });

  // Keep the address bar shareable, without adding history entries while typing.
  const search_ = catalogSearch(effective);
  useEffect(() => {
    if (search_ !== window.location.search) router.replace(`${window.location.pathname}${search_}`, { scroll: false });
  }, [router, search_]);

  const update = (patch: Partial<CatalogQuery>) => {
    setQuery({ ...effective, page: 1, ...patch });
    if (patch.page) window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const page = products.data;
  const branchId = page?.branch_id ?? effective.branch ?? store.branches[0]?.id ?? "";
  const pages = page ? Math.max(1, Math.ceil(page.total / PAGE_SIZE)) : 1;
  const synced = page?.synced_at;

  return (
    <div className="min-h-svh">
      <StoreHeader store={store} branchId={branchId} />
      <main className="mx-auto max-w-6xl px-4 py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Search products" className="sm:w-96" />
          {store.branches.length > 1 && (
            <SimpleSelect
              aria-label="Branch"
              className="w-full sm:w-56"
              value={branchId}
              onChange={(branch) => update({ branch })}
              options={store.branches.map((b) => ({ value: b.id, label: b.name }))}
            />
          )}
          {store.stock_display !== "HIDDEN" && (
            <div className="flex items-center gap-2">
              <Switch id="in-stock-only" checked={effective.inStock} onCheckedChange={(inStock) => update({ inStock })} />
              <Label htmlFor="in-stock-only">In stock only</Label>
            </div>
          )}
        </div>

        {store.categories.length > 0 && (
          <nav aria-label="Categories" className="scrollbar-on-hover -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {[{ id: null, name: "All" }, ...store.categories].map((c) => {
              const active = effective.category === c.id;
              return (
                <button
                  key={c.id ?? "all"}
                  type="button"
                  aria-pressed={active}
                  onClick={() => update({ category: c.id })}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-sm transition-colors",
                    active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
                  )}
                >
                  {c.name}
                </button>
              );
            })}
          </nav>
        )}

        <div className="text-muted-foreground mt-4 mb-3 flex flex-wrap items-center justify-between gap-2 text-sm" aria-live="polite">
          <span>{page ? `${page.total} product${page.total === 1 ? "" : "s"}` : "Loading…"}</span>
          {store.stock_display !== "HIDDEN" && (
            <span>{synced ? `Stock updated ${timeAgo(synced, now)}` : "Stock updates when the store syncs"}</span>
          )}
        </div>

        {products.error && !page ? (
          <QueryError error={products.error} onRetry={() => void products.refetch()} />
        ) : page && page.items.length === 0 ? (
          <EmptyState
            icon={SearchXIcon}
            title="No products found"
            description={effective.q || effective.category || effective.inStock ? "Try another search or category." : "Check back soon."}
          />
        ) : (
          <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4", products.isPlaceholderData && "opacity-60 transition-opacity")}>
            {page?.items.map((p) => <ProductCard key={p.id} product={p} onOpen={() => setOpen(p)} />)}
          </div>
        )}

        {page && pages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-3 text-sm">
            <Button variant="outline" disabled={effective.page <= 1} onClick={() => update({ page: effective.page - 1 })}>
              Previous
            </Button>
            <span className="text-muted-foreground tabular-nums">
              Page {effective.page} of {pages}
            </span>
            <Button variant="outline" disabled={effective.page >= pages} onClick={() => update({ page: effective.page + 1 })}>
              Next
            </Button>
          </div>
        )}

        <footer className="text-muted-foreground mt-10 border-t pt-4 pb-8 text-center text-xs">
          Prices and stock can change during the day. This catalog is for browsing only — visit or message the store to buy.
        </footer>
      </main>
      <ProductDetailDialog slug={slug} branch={effective.branch} product={open} onClose={() => setOpen(null)} />
    </div>
  );
}
