"use client";

import { BarChart3Icon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { formatCell, present } from "../present";

/** Renders any report payload: KPI cards for summaries, a table for lists. */
export function ReportView({ data }: { data: unknown }) {
  const p = present(data);
  if (p.type === "empty") return <EmptyState icon={BarChart3Icon} title="No data for this period" />;
  if (p.type === "kpis") {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {p.items.map((item) => (
          <StatCard key={item.key} label={item.label} value={item.value} />
        ))}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            {p.columns.map((c) => (
              <TableHead key={c.key} className={cn(c.numeric && "text-right")}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {p.rows.map((row, i) => (
            <TableRow key={i} className="h-10">
              {p.columns.map((c) => (
                <TableCell key={c.key} className={cn(c.numeric && "text-right tabular-nums", "whitespace-nowrap")}>
                  {formatCell(row[c.key], c.kind)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
