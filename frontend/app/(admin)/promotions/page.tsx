"use client";

import { PencilIcon, PercentIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { ActiveBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermissionInAnyScope } from "@/features/auth/hooks";
import { describePromotion, describeSchedule, usePromotions } from "@/features/promotions/api";
import { PromotionDialog } from "@/features/promotions/components/promotion-dialog";
import { ADMIN_PERM } from "@/features/shell/permissions";
import { formatDateTime } from "@/lib/format";
import type { Promotion } from "@/types/api-admin";

const PAGE_SIZE = 25;

export default function PromotionsPage() {
  const canManage = usePermissionInAnyScope(ADMIN_PERM.PROMOTIONS_MANAGE);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Promotion | "new" | null>(null);
  const { data, isPending, error, refetch } = usePromotions({ include_inactive: includeInactive, limit: PAGE_SIZE, offset });

  return (
    <>
      <PageHeader
        title="Promotions"
        description="Evaluated on each terminal, so they work offline. Terminals receive changes on their next sync."
        actions={
          canManage && (
            <Button onClick={() => setEditing("new")}>
              <PlusIcon /> New promotion
            </Button>
          )
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <Switch id="inactive-promos" checked={includeInactive} onCheckedChange={(v) => { setIncludeInactive(v); setOffset(0); }} />
        <Label htmlFor="inactive-promos">Show inactive</Label>
      </div>
      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={PercentIcon} title="No promotions" />
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Offer</TableHead>
                  <TableHead className="hidden md:table-cell">Schedule</TableHead>
                  <TableHead className="hidden lg:table-cell">Period</TableHead>
                  <TableHead className="hidden w-20 text-right sm:table-cell">Priority</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  {canManage && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((p) => (
                  <TableRow key={p.id} className="h-11">
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{describePromotion(p)}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{describeSchedule(p)}</TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {p.starts_at || p.ends_at ? `${formatDateTime(p.starts_at)} → ${formatDateTime(p.ends_at)}` : "Always"}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{p.priority}</TableCell>
                    <TableCell>
                      <ActiveBadge active={p.is_active} />
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <Button variant="ghost" size="icon-sm" aria-label="Edit promotion" onClick={() => setEditing(p)}>
                          <PencilIcon />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} shown={data.items.length} onChange={setOffset} />
        </>
      )}
      {editing !== null && (
        <PromotionDialog
          key={editing === "new" ? "new" : editing.id}
          promotion={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
