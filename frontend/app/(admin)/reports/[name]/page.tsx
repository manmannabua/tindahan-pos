"use client";

import { ArrowLeftIcon, DownloadIcon, Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { SimpleSelect, TextField } from "@/components/shared/form-fields";
import { daysAgo, isoDate } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useBranches } from "@/features/branches/api";
import { CHARTS, POINT_IN_TIME, type ReportParams, useExportStatus, useReport, useReportCatalogue, useStartExport } from "@/features/reports/api";
import { ReportView } from "@/features/reports/components/report-view";
import { SeriesChart } from "@/features/reports/components/series-chart";
import { chartPoints } from "@/features/reports/present";
import { downloadAuthed } from "@/features/shell/download";
import { errorMessage } from "@/lib/api/errors";

const ALL = "__all__";

export default function ReportRunnerPage() {
  const { name } = useParams<{ name: string }>();
  const catalogue = useReportCatalogue();
  const info = catalogue.data?.find((r) => r.name === name);
  const { data: branches } = useBranches();
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(isoDate(new Date()));
  const [branchId, setBranchId] = useState(ALL);
  const [granularity, setGranularity] = useState<"day" | "week" | "month">("day");
  const [limit, setLimit] = useState("");
  const [exportId, setExportId] = useState<string | null>(null);

  const params: ReportParams = {
    date_from: POINT_IN_TIME.has(name) ? undefined : from,
    date_to: POINT_IN_TIME.has(name) ? undefined : to,
    branch_id: branchId === ALL ? undefined : branchId,
    granularity: name === "sales-trend" ? granularity : undefined,
    limit: Number.parseInt(limit, 10) || undefined,
  };
  const { data, isPending, error, refetch, isFetching } = useReport(name, params);
  const startExport = useStartExport(name);
  const exportStatus = useExportStatus(exportId);
  const chart = CHARTS[name];
  const rows = Array.isArray(data?.data) ? (data.data as Record<string, unknown>[]) : [];
  const exporting = exportId !== null && exportStatus.data?.status !== "DONE" && exportStatus.data?.status !== "FAILED";

  const onExport = () =>
    startExport.mutate(params, {
      onSuccess: (e) => setExportId(e.id),
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <>
      <Link href="/reports" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Reports
      </Link>
      <PageHeader
        title={data?.title ?? info?.title ?? "Report"}
        description={
          data
            ? `${POINT_IN_TIME.has(name) ? "Current" : `${data.date_from} → ${data.date_to}`} · ${data.timezone}${data.financial ? "" : " · cost figures hidden"}`
            : undefined
        }
        actions={
          <>
            {exportStatus.data?.status === "DONE" && exportId && (
              <Button
                variant="outline"
                onClick={() => downloadAuthed(`/reports/exports/${exportId}/download`, `${name}.csv`).catch((e: unknown) => toast.error(errorMessage(e)))}
              >
                <DownloadIcon /> Download CSV
              </Button>
            )}
            {exportStatus.data?.status === "FAILED" && <span className="text-sm text-destructive">Export failed</span>}
            <Button variant="outline" onClick={onExport} disabled={startExport.isPending || exporting}>
              {exporting ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} Export CSV
            </Button>
          </>
        }
      />
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end">
        {!POINT_IN_TIME.has(name) && (
          <>
            <div className="w-40">
              <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="w-40">
              <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </>
        )}
        <SimpleSelect
          aria-label="Branch"
          className="w-full lg:w-52"
          value={branchId}
          onChange={setBranchId}
          options={[{ value: ALL, label: "All branches" }, ...(branches ?? []).map((b) => ({ value: b.id, label: b.name }))]}
        />
        {name === "sales-trend" && (
          <SimpleSelect
            aria-label="Granularity"
            className="w-full lg:w-36"
            value={granularity}
            onChange={(v) => setGranularity(v as "day" | "week" | "month")}
            options={[
              { value: "day", label: "Daily" },
              { value: "week", label: "Weekly" },
              { value: "month", label: "Monthly" },
            ]}
          />
        )}
        {["sales-by-product", "best-sellers", "slow-movers"].includes(name) && (
          <div className="w-28">
            <TextField label="Top N" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </div>
        )}
        {isFetching && <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label="Refreshing" />}
      </div>
      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="space-y-6">
          {chart && rows.length > 0 && (
            <Card>
              <CardContent>
                <SeriesChart points={chartPoints(rows, chart[0], chart[1])} />
              </CardContent>
            </Card>
          )}
          <ReportView data={data.data} />
        </div>
      )}
    </>
  );
}
