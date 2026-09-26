"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  BoxesIcon,
  FlagIcon,
  MonitorSmartphoneIcon,
  RadioIcon,
  ReceiptTextIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";

import { humanize, money, qty } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermissionInAnyScope, useSession } from "@/features/auth/hooks";
import { type RealtimeMessage, useRealtime } from "@/features/dashboard/realtime";
import { useDashboard } from "@/features/reports/api";
import { SeriesChart } from "@/features/reports/components/series-chart";
import { chartPoints } from "@/features/reports/present";
import { ADMIN_PERM } from "@/features/shell/permissions";
import { subtract } from "@/lib/money";

type Summary = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

function delta(today: Summary, yesterday: Summary, key: string): string | null {
  const a = str(today[key]);
  const b = str(yesterday[key]);
  if (!a || !b) return null;
  const d = subtract(a, b);
  return `${d.gte("0") ? "+" : "−"}${money(d.abs().toFixed(2))} vs yesterday`;
}

export default function DashboardPage() {
  const { user } = useSession();
  const canReports = usePermissionInAnyScope(ADMIN_PERM.REPORTS_VIEW);
  const queryClient = useQueryClient();
  const onEvent = useCallback(
    (m: RealtimeMessage) => {
      if (m.event === "sync.applied") void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    [queryClient],
  );
  const live = useRealtime({ onEvent });
  const { data, isPending, error, refetch } = useDashboard();

  const header = (
    <PageHeader
      title={`Welcome${user ? `, ${user.full_name.split(" ")[0]}` : ""}`}
      description={user ? `${user.company.name} · ${user.company.timezone}` : undefined}
      actions={
        canReports && (
          <Badge variant={live === "live" ? "secondary" : "outline"} className="gap-1">
            <RadioIcon className="size-3" /> {live === "live" ? "Live" : "Auto-refresh"}
          </Badge>
        )
      }
    />
  );
  if (!canReports) {
    return (
      <>
        {header}
        <p className="text-sm text-muted-foreground">Use the menu to get started.</p>
      </>
    );
  }
  if (isPending) return (<>{header}<TableSkeleton /></>);
  if (error) return (<>{header}<QueryError error={error} onRetry={() => void refetch()} /></>);

  const today = data.today;
  const yesterday = data.yesterday;
  const flags = Object.entries(data.open_flags);
  const openFlags = flags.reduce((n, [, c]) => n + c, 0);
  const top = data.top_products_today as Summary[];

  return (
    <>
      {header}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Sales today" icon={ReceiptTextIcon} value={money(str(today.sales))} hint={delta(today, yesterday, "sales")} />
        <StatCard label="Transactions" value={String(today.transactions ?? 0)} hint={`Average ${money(str(today.average_ticket))}`} />
        {"gross_profit" in today ? (
          <StatCard
            label="Gross profit"
            icon={WalletIcon}
            value={money(str(today.gross_profit))}
            hint={today.gross_margin_pct ? `${String(today.gross_margin_pct)}% margin` : undefined}
          />
        ) : (
          <StatCard label="Discounts" value={money(str(today.discounts))} />
        )}
        <StatCard
          label="Returns / voids"
          value={`${money(str(today.returns))} · ${String(today.voids_count ?? 0)}`}
          tone={Number(today.voids_count ?? 0) > 0 ? "warning" : "default"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Last 7 days</CardTitle>
          </CardHeader>
          <CardContent>
            <SeriesChart points={chartPoints(data.last_7_days as Summary[], "period", "sales")} height={220} />
          </CardContent>
        </Card>
        <div className="grid content-start gap-3">
          <Link href="/reports/low-stock">
            <StatCard
              label="Stock alerts"
              icon={BoxesIcon}
              value={`${data.stock.low ?? 0} low · ${data.stock.out ?? 0} out`}
              hint={data.stock.negative ? `${data.stock.negative} negative` : "No negative stock"}
              tone={data.stock.negative ? "danger" : data.stock.low ? "warning" : "default"}
            />
          </Link>
          <Link href="/review-flags">
            <StatCard
              label="Open review flags"
              icon={FlagIcon}
              value={openFlags}
              hint={flags.map(([t, n]) => `${n} ${humanize(t).toLowerCase()}`).join(", ") || "Nothing to review"}
              tone={openFlags ? "warning" : "success"}
            />
          </Link>
          <Link href="/sync-monitor">
            <StatCard
              label="Terminals"
              icon={MonitorSmartphoneIcon}
              value={`${data.devices.online ?? 0} / ${data.devices.active ?? 0} online`}
              hint={`${data.devices.pending_operations ?? 0} pending · ${data.devices.stale ?? 0} not synced for 1h+`}
              tone={data.devices.stale ? "warning" : "default"}
            />
          </Link>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Top products today</CardTitle>
        </CardHeader>
        <CardContent>
          {top.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangleIcon className="size-4" /> No sales yet today.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top.map((p) => (
                  <TableRow key={String(p.variant_id)}>
                    <TableCell>
                      {String(p.product_name)}
                      {p.variant_name ? ` · ${String(p.variant_name)}` : ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{qty(str(p.quantity))}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(str(p.sales))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
