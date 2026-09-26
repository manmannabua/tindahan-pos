"use client";

import { HistoryIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { SimpleSelect } from "@/components/shared/form-fields";
import { humanize, money, qty } from "@/components/shared/formatters";
import { Pagination } from "@/components/shared/pagination";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { isNegative } from "@/lib/money";
import { cn } from "@/lib/utils";

import { useLocationLabels, useMovements } from "../api";
import { MOVEMENT_TYPES, referenceHref } from "../movement-types";
import { StockLocationSelect } from "./stock-location-select";

const PAGE_SIZE = 50;
const ALL = "__all__";

export function MovementsView({ variantId, onClearVariant }: { variantId: string | null; onClearVariant: () => void }) {
  const [locationId, setLocationId] = useState("");
  const [type, setType] = useState(ALL);
  const [offset, setOffset] = useState(0);
  const labels = useLocationLabels();
  const { data, isPending, error, refetch } = useMovements({
    variant_id: variantId ?? undefined,
    stock_location_id: locationId || undefined,
    movement_type: type === ALL ? undefined : type,
    limit: PAGE_SIZE,
    offset,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <StockLocationSelect className="w-full lg:w-64" value={locationId} onChange={(v) => { setLocationId(v); setOffset(0); }} allowAll />
        <SimpleSelect
          aria-label="Movement type"
          className="w-full lg:w-52"
          value={type}
          onChange={(v) => { setType(v); setOffset(0); }}
          options={[{ value: ALL, label: "All types" }, ...MOVEMENT_TYPES.map((t) => ({ value: t, label: humanize(t) }))]}
        />
        {variantId && (
          <Button variant="outline" size="sm" onClick={onClearVariant}>
            One item only <XIcon />
          </Button>
        )}
      </div>
      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="No movements" />
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden md:table-cell">Location</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Unit cost</TableHead>
                  <TableHead className="hidden lg:table-cell">Reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((m) => {
                  const href = referenceHref(m.reference_type, m.reference_id);
                  return (
                    <TableRow key={m.id} className="h-11">
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(m.occurred_at)}</TableCell>
                      <TableCell>{humanize(m.movement_type)}</TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{labels[m.stock_location_id] ?? "—"}</TableCell>
                      <TableCell className={cn("text-right font-medium tabular-nums", isNegative(m.signed_quantity) ? "text-destructive" : "text-emerald-600")}>
                        {isNegative(m.signed_quantity) ? "" : "+"}
                        {qty(m.signed_quantity)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">{money(m.unit_cost)}</TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">
                        {href ? (
                          <Link className="hover:underline" href={href}>
                            {humanize(m.reference_type ?? "")}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{m.note ?? humanize(m.reference_type ?? "—")}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} shown={data.items.length} onChange={setOffset} />
        </>
      )}
    </div>
  );
}
