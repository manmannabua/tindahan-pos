"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LocalStatutory } from "@/lib/db/schema";

interface Props {
  open: boolean;
  current: LocalStatutory | null;
  onClose: () => void;
  /** null removes the senior citizen / PWD discount. */
  onApply: (statutory: LocalStatutory | null) => void;
}

/**
 * Senior citizen / PWD holder details (RA 9994 / RA 10754). The discount applies to every
 * product marked eligible; the holder name, ID number and TIN are printed on the receipt.
 */
export function StatutoryDialog({ open, current, onClose, onApply }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">{open && <Form current={current} onApply={onApply} />}</DialogContent>
    </Dialog>
  );
}

function Form({ current, onApply }: Pick<Props, "current" | "onApply">) {
  const [kind, setKind] = useState<LocalStatutory["kind"]>(current?.kind ?? "SENIOR");
  const [idNumber, setIdNumber] = useState(current?.idNumber ?? "");
  const [holderName, setHolderName] = useState(current?.holderName ?? "");
  const [holderTin, setHolderTin] = useState(current?.holderTin ?? "");
  const valid = idNumber.trim().length > 0 && holderName.trim().length >= 2;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onApply({ kind, idNumber: idNumber.trim(), holderName: holderName.trim(), holderTin: holderTin.trim() || null });
      }}
    >
      <DialogHeader>
        <DialogTitle>Senior citizen / PWD discount</DialogTitle>
        <DialogDescription>20% off and VAT-exempt on eligible items. Check the ID before applying.</DialogDescription>
      </DialogHeader>
      <div className="flex gap-2" role="radiogroup" aria-label="Discount type">
        <Button type="button" role="radio" aria-checked={kind === "SENIOR"} variant={kind === "SENIOR" ? "default" : "outline"} onClick={() => setKind("SENIOR")}>
          Senior citizen
        </Button>
        <Button type="button" role="radio" aria-checked={kind === "PWD"} variant={kind === "PWD" ? "default" : "outline"} onClick={() => setKind("PWD")}>
          PWD
        </Button>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sc-id">{kind === "SENIOR" ? "OSCA / Senior citizen ID no." : "PWD ID no."}</Label>
        <Input id="sc-id" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} maxLength={64} autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sc-name">Name of holder</Label>
        <Input id="sc-name" value={holderName} onChange={(e) => setHolderName(e.target.value)} maxLength={200} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sc-tin">TIN (optional)</Label>
        <Input id="sc-tin" value={holderTin} onChange={(e) => setHolderTin(e.target.value)} maxLength={32} />
      </div>
      <DialogFooter className="gap-2">
        {current && (
          <Button type="button" variant="outline" onClick={() => onApply(null)}>
            Remove discount
          </Button>
        )}
        <Button type="submit" disabled={!valid}>
          Apply
        </Button>
      </DialogFooter>
    </form>
  );
}
