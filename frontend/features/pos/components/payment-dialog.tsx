"use client";

import { XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LocalPaymentMethod } from "@/lib/db/schema";
import { add, compare, formatMoney, isValidDecimal, subtract, toBig, toMoneyString } from "@/lib/money";
import type { TenderInput } from "@/lib/pos/complete-sale";

import { DecimalInput } from "./money-input";

interface Props {
  open: boolean;
  total: string;
  currency: string;
  methods: LocalPaymentMethod[];
  busy: boolean;
  onCancel: () => void;
  onComplete: (tenders: TenderInput[]) => void;
}

/** Quick cash buttons: exact, then the next round notes above the amount due. */
export function quickTenders(due: string): string[] {
  const options = [toMoneyString(due)];
  for (const note of ["20", "50", "100", "200", "500", "1000"]) {
    if (compare(note, due) > 0 && options.length < 5) options.push(toMoneyString(note));
  }
  return options;
}

export function PaymentDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && !props.busy && props.onCancel()}>
      <DialogContent className="sm:max-w-lg">{props.open && <PaymentForm {...props} />}</DialogContent>
    </Dialog>
  );
}

function PaymentForm({ total, currency, methods, busy, onComplete }: Props) {
  const [tenders, setTenders] = useState<TenderInput[]>([]);
  const [method, setMethod] = useState<LocalPaymentMethod | undefined>(methods[0]);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  const paid = useMemo(() => toMoneyString(add(...tenders.map((t) => t.amount))), [tenders]);
  const remaining = toMoneyString(subtract(total, paid));
  const isCash = method?.kind === "CASH";
  const entered = amount === "" ? remaining : amount;

  const addTender = (value: string) => {
    if (!method) return;
    setError(null);
    if (!isValidDecimal(value) || compare(value, "0") <= 0) return setError("Enter an amount");
    if (method.requiresReference && !reference.trim()) return setError(`${method.name} needs a reference number`);
    let tender: TenderInput;
    if (isCash) {
      // Cash may exceed what's due: the excess is change.
      const applied = compare(value, remaining) > 0 ? remaining : toMoneyString(value);
      tender = { method, amount: applied, tendered: toMoneyString(value), referenceNo: null };
    } else {
      if (compare(value, remaining) > 0) return setError("Non-cash payments cannot exceed the amount due");
      tender = { method, amount: toMoneyString(value), tendered: null, referenceNo: reference.trim() || null };
    }
    const next = [...tenders, tender];
    setTenders(next);
    setAmount("");
    setReference("");
    if (compare(add(...next.map((t) => t.amount)), total) >= 0) onComplete(next);
  };

  const change = toMoneyString(
    add(...tenders.map((t) => (t.tendered ? subtract(t.tendered, t.amount) : toBig("0")))),
  );

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Payment</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted p-3">
        <div>
          <div className="text-xs text-muted-foreground">Total</div>
          <div className="text-2xl font-bold tabular-nums">{formatMoney(total, currency)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Remaining</div>
          <div className="text-2xl font-bold tabular-nums" data-testid="remaining">
            {formatMoney(remaining, currency)}
          </div>
        </div>
      </div>

      {tenders.length > 0 && (
        <ul className="space-y-1 text-sm" aria-label="Payments">
          {tenders.map((t, i) => (
            <li key={i} className="flex items-center justify-between rounded-md border px-3 py-1.5">
              <span>
                {t.method.name}
                {t.referenceNo ? ` · ${t.referenceNo}` : ""}
              </span>
              <span className="flex items-center gap-2 tabular-nums">
                {formatMoney(t.amount, currency)}
                <Button size="icon-sm" variant="ghost" aria-label="Remove payment" onClick={() => setTenders(tenders.filter((_, j) => j !== i))}>
                  <XIcon />
                </Button>
              </span>
            </li>
          ))}
          {compare(change, "0") > 0 && <li className="text-right font-semibold">Change {formatMoney(change, currency)}</li>}
        </ul>
      )}

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Payment method">
        {methods.map((m) => (
          <Button key={m.id} variant={method?.id === m.id ? "default" : "outline"} className="h-11" onClick={() => setMethod(m)}>
            {m.name}
          </Button>
        ))}
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          addTender(entered);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="tender-amount">{isCash ? "Cash received" : "Amount"}</Label>
          <DecimalInput
            id="tender-amount"
            placeholder={remaining}
            value={amount}
            onValueChange={setAmount}
            className="h-12 text-lg"
            autoFocus
            disabled={busy}
          />
        </div>
        {method?.requiresReference && (
          <div className="space-y-1.5">
            <Label htmlFor="tender-reference">Reference number</Label>
            <Input id="tender-reference" value={reference} onChange={(e) => setReference(e.target.value)} className="h-11" disabled={busy} />
          </div>
        )}
        {isCash && (
          <div className="flex flex-wrap gap-2">
            {quickTenders(remaining).map((q) => (
              <Button key={q} type="button" variant="secondary" className="h-11" disabled={busy} onClick={() => addTender(q)}>
                {formatMoney(q, currency)}
              </Button>
            ))}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="h-12 w-full" disabled={busy || compare(remaining, "0") <= 0}>
          {busy ? "Completing…" : `Add ${method?.name ?? "payment"}`}
        </Button>
      </form>
    </div>
  );
}
