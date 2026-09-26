"use client";

import { ArrowLeftIcon, CheckCircle2Icon, Loader2Icon, ScanBarcodeIcon, XCircleIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { humanize, qty } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lookupBarcode } from "@/features/catalog/api";
import { recordCountLine, useBalances, useCount, useCountAction, useLocationLabels } from "@/features/inventory/api";
import { countScanReducer, initialCountScan, summarize, variance } from "@/features/inventory/count-scan";
import { errorMessage } from "@/lib/api/errors";
import { isNegative, isZero } from "@/lib/money";
import { cn } from "@/lib/utils";

let scanSeq = 0;

export default function StockCountPage() {
  const { countId } = useParams<{ countId: string }>();
  const { data: count, isPending, error, refetch } = useCount(countId);
  const labels = useLocationLabels();
  const balances = useBalances({ stock_location_id: count?.stock_location_id, limit: 500, offset: 0 });
  const [state, dispatch] = useReducer(countScanReducer, initialCountScan);
  const [scannedNames, setScannedNames] = useState<Record<string, string>>({});
  const [code, setCode] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [setMode, setSetMode] = useState(false);
  const [confirm, setConfirm] = useState<"complete" | "cancel" | null>(null);
  const complete = useCountAction(countId, "complete");
  const cancel = useCountAction(countId, "cancel");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (count) dispatch({ type: "loaded", lines: count.lines });
  }, [count]);
  const names = useMemo(
    () => ({
      ...Object.fromEntries(
        (balances.data?.items ?? []).map((b) => [b.variant_id, `${b.product_name}${b.variant_name ? ` · ${b.variant_name}` : ""}`]),
      ),
      ...scannedNames,
    }),
    [balances.data, scannedNames],
  );

  const open = count?.status === "IN_PROGRESS";
  const rows = Object.values(state.rows).sort((a, b) => b.countedAt.localeCompare(a.countedAt));
  const summary = summarize(rows);

  const submitScan = async () => {
    const value = code.trim();
    if (!value || !open) return;
    const q = quantity.trim() || "1";
    const id = String((scanSeq += 1));
    setCode("");
    dispatch({ type: "scan-started", id, code: value });
    try {
      const line = await recordCountLine(countId, { barcode: value, quantity: q, mode: setMode ? "SET" : "ADD" });
      dispatch({ type: "scan-ok", id, line });
      if (!names[line.variant_id]) {
        lookupBarcode(value)
          .then((found) => setScannedNames((n) => ({ ...n, [line.variant_id]: found.product_name })))
          .catch(() => undefined);
      }
    } catch (e) {
      dispatch({ type: "scan-failed", id, message: errorMessage(e) });
    }
    input.current?.focus();
  };

  if (isPending) return <TableSkeleton />;
  if (error) return <QueryError error={error} onRetry={() => void refetch()} />;

  return (
    <>
      <Link href="/inventory/counts" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Stock counts
      </Link>
      <PageHeader
        title={`Count ${count.number}`}
        description={`${labels[count.stock_location_id] ?? ""}${count.is_full ? " · full count" : " · partial count"}`}
        actions={
          open ? (
            <>
              <Button variant="outline" onClick={() => setConfirm("cancel")}>
                Cancel count
              </Button>
              <Button onClick={() => setConfirm("complete")} disabled={rows.length === 0 && !count.is_full}>
                Complete count
              </Button>
            </>
          ) : (
            <Badge variant="secondary">{humanize(count.status)}</Badge>
          )
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <StatCard label="Items counted" value={summary.lines} />
        <StatCard label="Exact" value={summary.exact} tone="success" />
        <StatCard label="Over" value={summary.over} tone={summary.over ? "warning" : "default"} />
        <StatCard label="Short" value={summary.short} tone={summary.short ? "danger" : "default"} />
      </div>

      {open && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScanBarcodeIcon className="size-4" /> Scan
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-[1fr_7rem_auto] sm:items-center">
            <Input
              ref={input}
              autoFocus
              aria-label="Barcode"
              placeholder="Scan a barcode (or type it and press Enter)"
              className="h-12 text-lg"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitScan();
                }
              }}
            />
            <Input aria-label="Quantity per scan" inputMode="decimal" className="h-12" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            <div className="flex items-center gap-2">
              <Switch id="set-mode" checked={setMode} onCheckedChange={setSetMode} />
              <Label htmlFor="set-mode">{setMode ? "Replace count" : "Add to count"}</Label>
            </div>
            {state.log.length > 0 && (
              <ul className="space-y-1 text-sm sm:col-span-3">
                {state.log.slice(0, 5).map((entry) => (
                  <li key={entry.id} className="flex items-center gap-2">
                    {entry.status === "pending" && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
                    {entry.status === "ok" && <CheckCircle2Icon className="size-4 text-emerald-600" />}
                    {entry.status === "error" && <XCircleIcon className="size-4 text-destructive" />}
                    <span className="font-mono">{entry.code}</span>
                    <span className="truncate text-muted-foreground">
                      {entry.status === "error" ? entry.message : entry.variantId ? names[entry.variantId] : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">System</TableHead>
              <TableHead className="text-right">Counted</TableHead>
              <TableHead className="text-right">Variance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                  Nothing counted yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const diff = variance(row);
                return (
                  <TableRow key={row.variantId} className="h-11">
                    <TableCell>{names[row.variantId] ?? row.variantId.slice(0, 8)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{qty(row.system)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{qty(row.counted)}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        isZero(diff) ? "text-muted-foreground" : isNegative(diff) ? "text-destructive" : "text-amber-600",
                      )}
                    >
                      {isZero(diff) || isNegative(diff) ? "" : "+"}
                      {qty(diff)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={confirm === "complete"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title="Complete this count?"
        description={
          <>
            {summary.over + summary.short} item(s) differ from the system and will be adjusted.
            {count.is_full && " Items not counted at this location will be set to zero."} This cannot be undone.
          </>
        }
        confirmLabel="Complete and post"
        pending={complete.isPending}
        onConfirm={() =>
          complete.mutate(undefined, {
            onSuccess: () => {
              toast.success("Count completed");
              setConfirm(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
      <ConfirmDialog
        open={confirm === "cancel"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title="Cancel this count?"
        description="Nothing will be adjusted."
        confirmLabel="Cancel count"
        destructive
        pending={cancel.isPending}
        onConfirm={() => cancel.mutate(undefined, { onSuccess: () => setConfirm(null), onError: (e) => toast.error(errorMessage(e)) })}
      />
    </>
  );
}
