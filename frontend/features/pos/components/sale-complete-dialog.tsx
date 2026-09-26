"use client";

import { CheckCircle2Icon, PrinterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/money";
import type { LocalSale } from "@/lib/db/schema";

interface Props {
  sale: LocalSale | null;
  currency: string;
  onPrint: () => void;
  onNext: () => void;
}

/** Shown after a sale: the change to hand back, reprint, and "next customer". */
export function SaleCompleteDialog({ sale, currency, onPrint, onNext }: Props) {
  return (
    <Dialog open={sale !== null} onOpenChange={(open) => !open && onNext()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        {sale && (
          <div className="space-y-4 text-center">
            <DialogHeader className="items-center">
              <CheckCircle2Icon className="size-10 text-emerald-600" />
              <DialogTitle>Sale complete · {sale.receiptNumber}</DialogTitle>
            </DialogHeader>
            <div>
              <div className="text-sm text-muted-foreground">Change</div>
              <div className="text-5xl font-bold tabular-nums" data-testid="change-due">
                {formatMoney(sale.changeTotal, currency)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-12" onClick={onPrint}>
                <PrinterIcon /> Print again
              </Button>
              <Button className="h-12" autoFocus onClick={onNext}>
                Next customer
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
