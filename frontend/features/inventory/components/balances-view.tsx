"use client";

import { BoxesIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { formatDateTime } from "@/lib/format";
import { qty } from "@/components/shared/formatters";
import { Pagination } from "@/components/shared/pagination";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { SearchInput } from "@/components/shared/search-input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { isNegative, toBig } from "@/lib/money";

import { useBalances, useLocationLabels } from "../api";
import { StockLocationSelect } from "./stock-location-select";

const PAGE_SIZE = 50;

export function BalancesView({ onShowMovements }: { onShowMovements: (variantId: string) => void }) {
  const [search, setSearch] = useState("");
  const [locationId, setLocationId] = useState("");
  const [low, setLow] = useState(false);
  const [negative, setNegative] = useState(false);
  const [offset, setOffset] = useState(0);
  const q = useDebouncedValue(search.trim());
  const labels = useLocationLabels();
  const { data, isPending, error, refetch, isPlaceholderData } = useBalances({
    q: q || undefined,
    stock_location_id: locationId || undefined,
    low_stock: low || undefined,
    negative: negative || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setOffset(0); }} placeholder="Search name or SKU" />
        <StockLocationSelect className="w-full lg:w-64" value={locationId} onChange={(v) => { setLocationId(v); setOffset(0); }} allowAll />
        <div className="flex items-center gap-2">
          <Switch id="low-stock" checked={low} onCheckedChange={(v) => { setLow(v); setOffset(0); }} />
          <Label htmlFor="low-stock">Low stock</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="negative-stock" checked={negative} onCheckedChange={(v) => { setNegative(v); setOffset(0); }} />
          <Label htmlFor="negative-stock">Negative</Label>
        </div>
      </div>
      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={BoxesIcon} title="No stock records" description="Stock appears after receiving goods or posting initial stock." />
      ) : (
        <div className={isPlaceholderData ? "opacity-60" : undefined}>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="hidden md:table-cell">Location</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Reorder at</TableHead>
                  <TableHead className="hidden lg:table-cell">Last movement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((b) => {
                  const lowStock = b.reorder_point !== null && toBig(b.quantity).lte(toBig(b.reorder_point));
                  return (
                    <TableRow key={`${b.stock_location_id}-${b.variant_id}`} className="h-11 cursor-pointer" onClick={() => onShowMovements(b.variant_id)}>
                      <TableCell>
                        <Link href={`/products/${b.product_id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                          {b.product_name}
                          {b.variant_name && ` · ${b.variant_name}`}
                        </Link>
                        <span className="ml-2 font-mono text-xs text-muted-foreground">{b.sku}</span>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{labels[b.stock_location_id] ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {isNegative(b.quantity) ? (
                          <Badge variant="destructive">{qty(b.quantity)}</Badge>
                        ) : lowStock ? (
                          <span className="text-amber-600">{qty(b.quantity)}</span>
                        ) : (
                          qty(b.quantity)
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{qty(b.reorder_point)}</TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDateTime(b.last_movement_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} shown={data.items.length} onChange={setOffset} />
        </div>
      )}
    </div>
  );
}
