"use client";

import { BarChart3Icon, LockIcon } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { useReportCatalogue } from "@/features/reports/api";

const GROUPS: [string, (name: string) => boolean][] = [
  ["Sales", (n) => n.startsWith("sales") || ["best-sellers", "slow-movers", "no-sales", "returns", "voids"].includes(n)],
  ["Inventory", (n) => ["inventory-valuation", "low-stock", "out-of-stock", "negative-inventory", "inventory-movements", "stock-count-variance"].includes(n)],
  ["Purchasing & cash", (n) => ["purchases-by-supplier", "cash-drawer", "expenses"].includes(n)],
];

export default function ReportsPage() {
  const { data, isPending, error, refetch } = useReportCatalogue();
  return (
    <>
      <PageHeader title="Reports" description="Figures are computed in PostgreSQL in the company's time zone." />
      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="space-y-8">
          {GROUPS.map(([group, match]) => {
            const reports = data.filter((r) => match(r.name));
            if (reports.length === 0) return null;
            return (
              <section key={group}>
                <h2 className="mb-3 text-sm font-medium text-muted-foreground">{group}</h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {reports.map((r) => (
                    <Link key={r.name} href={`/reports/${r.name}`} className="rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                      <Card size="sm" className="h-full transition-colors hover:bg-muted/40">
                        <CardHeader className="flex flex-row items-center justify-between">
                          <CardTitle className="flex items-center gap-2">
                            <BarChart3Icon className="size-4 text-primary" /> {r.title}
                          </CardTitle>
                          {r.has_financial_fields && <LockIcon className="size-3.5 text-muted-foreground" aria-label="Includes cost figures" />}
                        </CardHeader>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
