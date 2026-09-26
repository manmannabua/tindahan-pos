"use client";

import { BanknoteIcon, PrinterIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLiveQuery } from "@/hooks/use-live-query";
import type { CashMovementType } from "@/lib/db/schema";
import { getDb } from "@/lib/db/schema";
import { formatMoney, isValidDecimal, toMoneyString } from "@/lib/money";
import { closeCashSession, openCashSession, recordCashMovement, summarizeSession, type SessionSummary } from "@/lib/pos/cash-session";

import { buildZRead } from "@/lib/printing/z-read";
import { triggerSync } from "@/lib/sync/service";
import { usePosSession } from "@/stores/pos-session-store";

import { requestAuthorization } from "../manager-auth";
import { printWithFeedback } from "../print";
import { ReadingsCard } from "./readings-card";
import { DecimalInput } from "./money-input";
import { usePosFeature } from "../hooks/use-pos-feature";

export function OpenCashSession() {
  const { context, cashier } = usePosSession();
  const [float, setFloat] = useState("0.00");
  const [busy, setBusy] = useState(false);
  if (!context || !cashier) return null;

  const open = async () => {
    if (!isValidDecimal(float)) return;
    setBusy(true);
    try {
      const session = await openCashSession(getDb(), { deviceId: context.device.deviceId, userId: cashier.id, openingFloat: float });
      usePosSession.getState().setCashSession(session);
      triggerSync();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md p-4 sm:p-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BanknoteIcon className="size-5" /> Open cash drawer
          </CardTitle>
          <CardDescription>Count the starting cash (float) before the first sale.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void open();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="opening-float">Opening float</Label>
              <DecimalInput id="opening-float" value={float} onValueChange={setFloat} className="h-12 text-lg" autoFocus />
            </div>
            <Button type="submit" size="lg" className="h-12 w-full" disabled={busy || !isValidDecimal(float)}>
              Open session
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

const MOVEMENTS: { type: CashMovementType; label: string }[] = [
  { type: "CASH_IN", label: "Cash in" },
  { type: "CASH_OUT", label: "Cash out" },
  { type: "PICKUP", label: "Pickup (to safe)" },
];

export function CashView() {
  const birOn = usePosFeature("bir");
  const { context, cashier, cashSession } = usePosSession();
  const summary = useLiveQuery<SessionSummary | null>(
    async () => (cashSession ? summarizeSession(getDb(), cashSession.id) : null),
    [cashSession?.id],
    null,
  );
  const [type, setType] = useState<CashMovementType>("CASH_IN");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [counted, setCounted] = useState("");
  const [closed, setClosed] = useState<SessionSummary | null>(null);
  if (!context || !cashier) return null;
  const width = context.settings.receiptWidth;

  const printSummary = (s: SessionSummary) =>
    void printWithFeedback(buildZRead(s, { branchName: context.branch.name, terminalCode: context.device.terminalCode, cashierName: cashier.fullName, width }), context);

  if (closed) {
    return (
      <div className="mx-auto w-full max-w-lg space-y-4 p-4">
        <SummaryCard summary={closed} currency={context.company.currency} />
        <Button className="h-12 w-full" onClick={() => printSummary(closed)}>
          <PrinterIcon /> Print summary
        </Button>
        {birOn && <ReadingsCard shiftStart={closed.session.openedAt} />}
        <Button variant="outline" className="h-12 w-full" onClick={() => usePosSession.getState().setCashSession(null)}>
          Done
        </Button>
      </div>
    );
  }
  if (!cashSession || !summary) return <OpenCashSession />;

  const record = async () => {
    if (!isValidDecimal(amount) || toMoneyString(amount) === "0.00") return;
    const authorizedBy = await requestAuthorization("cash.manage", `${MOVEMENTS.find((m) => m.type === type)?.label}: ${formatMoney(amount)}`);
    if (!authorizedBy) return;
    await recordCashMovement(getDb(), {
      deviceId: context.device.deviceId,
      sessionId: cashSession.id,
      type,
      amount,
      reason: reason.trim() || null,
      userId: cashier.id,
      authorizedById: authorizedBy === cashier.id ? null : authorizedBy,
    });
    setAmount("");
    setReason("");
    toast.success("Recorded");
    triggerSync();
  };

  const close = async () => {
    if (!isValidDecimal(counted)) return;
    const result = await closeCashSession(getDb(), {
      deviceId: context.device.deviceId,
      sessionId: cashSession.id,
      userId: cashier.id,
      countedCash: counted,
      note: null,
    });
    setClosed(result);
    triggerSync();
  };

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 p-4 lg:grid-cols-2">
      <SummaryCard summary={summary} currency={context.company.currency} />
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Cash movement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {MOVEMENTS.map((m) => (
                <Button key={m.type} variant={type === m.type ? "default" : "outline"} onClick={() => setType(m.type)}>
                  {m.label}
                </Button>
              ))}
            </div>
            <DecimalInput aria-label="Amount" placeholder="Amount" value={amount} onValueChange={setAmount} className="h-11" />
            <Input aria-label="Reason" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className="h-11" />
            <Button className="h-11 w-full" onClick={() => void record()} disabled={!isValidDecimal(amount)}>
              Record
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Close session</CardTitle>
            <CardDescription>Count the drawer. Expected: {formatMoney(summary.expectedCash, context.company.currency)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <DecimalInput aria-label="Counted cash" placeholder="Counted cash" value={counted} onValueChange={setCounted} className="h-11" />
            <Button variant="destructive" className="h-11 w-full" onClick={() => void close()} disabled={!isValidDecimal(counted)}>
              Close session
            </Button>
            <Button variant="outline" className="h-11 w-full" onClick={() => printSummary(summary)}>
              <PrinterIcon /> Print cash summary
            </Button>
          </CardContent>
        </Card>
        {birOn && <ReadingsCard shiftStart={cashSession.openedAt} />}
      </div>
    </div>
  );
}

function SummaryCard({ summary, currency }: { summary: SessionSummary; currency: string }) {
  const rows: [string, string][] = [
    ["Opening float", summary.session.openingFloat],
    ["Cash sales", summary.cashSales],
    ["Cash in", summary.cashIn],
    ["Cash out", `-${summary.cashOut}`],
    ["Pickups", `-${summary.pickups}`],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Session {summary.session.status === "OPEN" ? "(open)" : "(closed)"}</CardTitle>
        <CardDescription>
          {summary.saleCount} sale{summary.saleCount === 1 ? "" : "s"} · {formatMoney(summary.salesTotal, currency)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {summary.byMethod.map((m) => (
          <div key={m.name} className="flex justify-between">
            <span>
              {m.name} ({m.count})
            </span>
            <span className="tabular-nums">{formatMoney(m.amount, currency)}</span>
          </div>
        ))}
        <hr />
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between">
            <span>{label}</span>
            <span className="tabular-nums">{value}</span>
          </div>
        ))}
        <div className="flex justify-between text-base font-semibold">
          <span>Expected cash</span>
          <span className="tabular-nums">{formatMoney(summary.expectedCash, currency)}</span>
        </div>
        {summary.session.overShort !== null && (
          <div className="flex justify-between text-base font-semibold">
            <span>Over / short</span>
            <span className="tabular-nums" data-testid="over-short">
              {summary.session.overShort}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
