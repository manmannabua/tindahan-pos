"use client";

import { CheckCircle2Icon, DownloadIcon, Loader2Icon, UploadIcon, XCircleIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IMPORT_COLUMNS, parseResult, TEMPLATE_CSV, useImportJob, useUploadImport } from "@/features/imports/api";
import { useFeature } from "@/features/auth/hooks";
import { StockLocationSelect } from "@/features/inventory/components/stock-location-select";
import { errorMessage } from "@/lib/api/errors";

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "products-template.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ImportProductsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [locationId, setLocationId] = useState("");
  const inventoryOn = useFeature("inventory");
  const [jobId, setJobId] = useState<string | null>(null);
  const upload = useUploadImport();
  const job = useImportJob(jobId);
  const result = parseResult(job.data);
  const running = jobId !== null && job.data?.status !== "DONE" && job.data?.status !== "FAILED";

  const submit = () => {
    if (!file) return;
    upload.mutate(
      { file, stockLocationId: locationId || null },
      { onSuccess: (j) => setJobId(j.id), onError: (e) => toast.error(errorMessage(e)) },
    );
  };

  return (
    <>
      <PageHeader
        title="Import products"
        description="Upload a CSV (UTF-8). Existing SKUs are updated; new ones are created."
        actions={
          <Button variant="outline" onClick={downloadTemplate}>
            <DownloadIcon /> Template
          </Button>
        }
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>File</CardTitle>
            <CardDescription>
              Columns: <span className="font-mono text-xs">{IMPORT_COLUMNS.join(", ")}</span>. Only name, unit and price are required.
              Opening stock is posted for new products only.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-[1fr_16rem_auto] sm:items-end">
            <div className="grid gap-2">
              <Label htmlFor="csv-file">CSV file</Label>
              <Input id="csv-file" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            {inventoryOn && (
              <div className="grid gap-2">
                <Label>Opening stock location</Label>
                <StockLocationSelect value={locationId} onChange={setLocationId} allowDefault />
              </div>
            )}
            <Button onClick={submit} disabled={!file || upload.isPending || running}>
              <UploadIcon /> Import
            </Button>
          </CardContent>
        </Card>

        {jobId && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {running && <Loader2Icon className="size-4 animate-spin" />}
                {job.data?.status === "DONE" && <CheckCircle2Icon className="size-4 text-emerald-600" />}
                {job.data?.status === "FAILED" && <XCircleIcon className="size-4 text-destructive" />}
                {running ? "Importing…" : job.data?.status === "FAILED" ? "Import failed" : "Import finished"}
              </CardTitle>
              {job.data?.error && <CardDescription className="text-destructive">{job.data.error}</CardDescription>}
            </CardHeader>
            {result && (
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-4">
                  <StatCard label="Created" value={result.created} tone="success" />
                  <StatCard label="Updated" value={result.updated} />
                  <StatCard label="Opening stock lines" value={result.opening_stock_lines} />
                  <StatCard label="Rows with errors" value={result.error_count} tone={result.error_count ? "danger" : "default"} />
                </div>
                {result.errors.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Row</TableHead>
                        <TableHead>Problem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.errors.map((e) => (
                        <TableRow key={e.row}>
                          <TableCell className="tabular-nums">{e.row}</TableCell>
                          <TableCell>{e.errors.join("; ")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
