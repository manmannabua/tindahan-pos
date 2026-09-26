"use client";

import { v7 as uuidv7 } from "uuid";
import { BadgePercentIcon, HeartHandshakeIcon, PauseIcon, PlayIcon, Trash2Icon, UserIcon, WalletIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useLiveQuery } from "@/hooks/use-live-query";
import { getDb, type LocalDiscount, type LocalSale } from "@/lib/db/schema";
import { compare, formatMoney, subtract } from "@/lib/money";
import { calculateCart, itemCount } from "@/lib/pos/cart";
import { completeSale, SaleValidationError, type TenderInput } from "@/lib/pos/complete-sale";
import { openCashDrawer } from "@/lib/printing/output";
import { buildReceipt } from "@/lib/printing/receipt";
import { triggerSync } from "@/lib/sync/service";
import { cartSnapshot, useCartStore } from "@/stores/cart-store";
import { usePosSession } from "@/stores/pos-session-store";

import { useCartCheckpoint } from "../hooks/use-cart-checkpoint";
import { printJournalReceipt } from "../print";
import { CartTable } from "./cart-table";
import { CustomerDialog } from "./customer-dialog";
import { HeldCartsDialog } from "./held-carts-dialog";
import { OrderDiscountDialog } from "./order-discount-dialog";
import { authorizeDiscount } from "./line-edit-dialog";
import { PaymentDialog } from "./payment-dialog";
import { SaleCompleteDialog } from "./sale-complete-dialog";
import { ScanBar } from "./scan-bar";
import { StatutoryDialog } from "./statutory-dialog";

export function SellScreen() {
  const { context, cashier, cashSession } = usePosSession();
  const cart = useCartStore();
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState<{ sale: LocalSale; receiptId: string | null } | null>(null);
  const [showHeld, setShowHeld] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showCustomer, setShowCustomer] = useState(false);
  const [showStatutory, setShowStatutory] = useState(false);
  const heldCount = useLiveQuery(() => getDb().heldCarts.count(), [], 0);
  useCartCheckpoint(true);

  const totals = useMemo(
    () => calculateCart(cart, context?.company.pricesIncludeTax ?? true),
    [cart, context?.company.pricesIncludeTax],
  );
  if (!context || !cashier) return null;
  const currency = context.company.currency;
  const calc = totals.calculation;

  const printSale = async (receiptId: string, kickDrawer = false) => {
    await printJournalReceipt(receiptId, context, { kickDrawer });
  };

  const checkout = async (tenders: TenderInput[]) => {
    setBusy(true);
    try {
      const result = await completeSale(getDb(), {
        cart: cartSnapshot(useCartStore.getState()),
        tenders,
        cashier: { id: cashier.id, name: cashier.fullName },
        cashSessionId: cashSession?.id ?? null,
        priceLevelId: cart.priceContext?.priceLevelId ?? context.defaultPriceLevel.id,
        pricesIncludeTax: context.company.pricesIncludeTax,
        deviceId: context.device.deviceId,
        receiptPrefix: context.device.receiptPrefix,
        stockLocationId: context.device.defaultStockLocationId,
        // The receipt goes into the journal with the sale, printed or not.
        buildReceipt: (sale, items, payments) =>
          buildReceipt({
            sale,
            items,
            payments,
            company: context.company,
            branch: context.branch,
            terminalCode: context.device.terminalCode,
            deviceBir: context.deviceBir,
            width: context.settings.receiptWidth,
          }),
      });
      useCartStore.getState().clear();
      setPaying(false);
      setCompleted({ sale: result.sale, receiptId: result.receiptId });
      triggerSync(); // background; never awaited
      // Cash (and any method marked "opens drawer") kicks the drawer, together with the receipt.
      const kickDrawer = tenders.some((t) => t.method.opensDrawer);
      if (context.settings.printReceiptAutomatically && result.receiptId) void printSale(result.receiptId, kickDrawer);
      else if (kickDrawer) void openCashDrawer(context.settings);
    } catch (error) {
      toast.error(error instanceof SaleValidationError ? error.message : `Could not complete the sale: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const hold = async () => {
    if (cart.lines.length === 0) return;
    const label = `${cart.lines[0].item.productName}${cart.lines.length > 1 ? ` +${cart.lines.length - 1}` : ""}`;
    await getDb().heldCarts.add({ id: uuidv7(), label, heldAt: new Date().toISOString(), heldBy: cashier.id, cart: cartSnapshot(cart) });
    cart.clear();
    toast.success("Sale held");
  };

  const applyOrderDiscount = async (discount: LocalDiscount | null) => {
    setShowDiscount(false);
    if (!discount || !calc) {
      cart.setOrderDiscount(null);
      return;
    }
    const approver = await authorizeDiscount(discount, calc.totals.grossTotal);
    if (approver === undefined) return;
    cart.setOrderDiscount({ ...discount, authorizedById: approver });
  };

  return (
    <div className="grid flex-1 gap-4 p-3 sm:p-4 lg:grid-cols-[1fr_22rem]">
      <section className="flex min-h-0 flex-col gap-3">
        <ScanBar disabled={paying || busy || completed !== null} />
        <div className="flex min-h-0 flex-1 flex-col rounded-xl border bg-background">
          <CartTable lineResults={calc?.lines ?? null} currency={currency} />
        </div>
      </section>

      <aside className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2">
          <UserIcon className="size-4 text-muted-foreground" />
          <span className="flex-1 truncate text-sm" data-testid="cart-customer">
            {cart.customer ? cart.customer.name : "Walk-in customer"}
          </span>
          {cart.customer ? (
            <Button size="sm" variant="ghost" onClick={() => cart.setCustomer(null)}>
              Remove
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setShowCustomer(true)}>
              Customer
            </Button>
          )}
        </div>
        {cart.statutory && (
          <div
            data-testid="statutory-banner"
            className="flex items-center gap-2 rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-sm dark:border-sky-800 dark:bg-sky-950"
          >
            <HeartHandshakeIcon className="size-4 text-sky-700" />
            <span className="min-w-0 flex-1 truncate">
              {cart.statutory.kind === "SENIOR" ? "Senior citizen" : "PWD"}: {cart.statutory.holderName} ({cart.statutory.idNumber})
            </span>
            <Button size="sm" variant="ghost" onClick={() => cart.setStatutory(null)}>
              Remove
            </Button>
          </div>
        )}
        <div className="space-y-2 rounded-xl border bg-background p-4">
          <Row label="Items" value={cart.lines.length ? itemCount(cart) : "0"} />
          <Row label="Subtotal" value={formatMoney(calc?.totals.grossTotal ?? "0", currency)} />
          {/* Regular discounts only; the SC/PWD discount has its own row below. */}
          {calc && compare(subtract(calc.totals.discountTotal, calc.totals.statutoryDiscountTotal), "0") > 0 && (
            <Row
              label="Discount"
              value={`−${formatMoney(subtract(calc.totals.discountTotal, calc.totals.statutoryDiscountTotal), currency)}`}
            />
          )}
          {calc && compare(calc.totals.vatExemptionTotal, "0") > 0 && (
            <Row label="Less: VAT exemption" value={`−${formatMoney(calc.totals.vatExemptionTotal, currency)}`} />
          )}
          {calc && compare(calc.totals.statutoryDiscountTotal, "0") > 0 && (
            <Row label="Less: SC/PWD 20% discount" value={`−${formatMoney(calc.totals.statutoryDiscountTotal, currency)}`} />
          )}
          <Row label={context.company.pricesIncludeTax ? "VAT (included)" : "VAT"} value={formatMoney(calc?.totals.taxTotal ?? "0", currency)} />
          <div className="flex items-end justify-between border-t pt-2">
            <span className="text-sm font-medium">TOTAL</span>
            <span className="text-4xl font-bold tabular-nums" data-testid="cart-total">
              {formatMoney(calc?.totals.total ?? "0", currency)}
            </span>
          </div>
          {!totals.ok && cart.lines.length > 0 && <p className="text-sm font-medium text-destructive">{totals.error}</p>}
        </div>
        <Button size="lg" className="h-16 text-lg" disabled={!totals.ok || busy} onClick={() => setPaying(true)}>
          <WalletIcon className="size-5" /> Pay
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-12" disabled={!calc} onClick={() => setShowDiscount(true)}>
            <BadgePercentIcon /> Discount
          </Button>
          <Button variant="outline" className="h-12" disabled={cart.lines.length === 0} onClick={() => void hold()}>
            <PauseIcon /> Hold
          </Button>
          <Button variant="outline" className="h-12" disabled={heldCount === 0 || cart.lines.length > 0} onClick={() => setShowHeld(true)}>
            <PlayIcon /> Recall ({heldCount})
          </Button>
          <Button
            variant="outline"
            className="h-12"
            disabled={cart.lines.length === 0}
            onClick={() => window.confirm("Clear the whole sale?") && cart.clear()}
          >
            <Trash2Icon /> Clear
          </Button>
          <Button variant="outline" className="col-span-2 h-12" onClick={() => setShowStatutory(true)}>
            <HeartHandshakeIcon /> Senior / PWD
          </Button>
        </div>
      </aside>

      {calc && (
        <PaymentDialog
          open={paying}
          total={calc.totals.total}
          currency={currency}
          methods={context.paymentMethods}
          busy={busy}
          onCancel={() => setPaying(false)}
          onComplete={(tenders) => void checkout(tenders)}
        />
      )}
      <SaleCompleteDialog
        sale={completed?.sale ?? null}
        currency={currency}
        onPrint={() => completed?.receiptId && void printSale(completed.receiptId)}
        onNext={() => setCompleted(null)}
      />
      <HeldCartsDialog open={showHeld} onClose={() => setShowHeld(false)} />
      <CustomerDialog open={showCustomer} onClose={() => setShowCustomer(false)} />
      <StatutoryDialog
        open={showStatutory}
        current={cart.statutory ?? null}
        onClose={() => setShowStatutory(false)}
        onApply={(s) => {
          setShowStatutory(false);
          cart.setStatutory(s);
          if (s && !cart.lines.some((l) => l.item.scPwdEligible)) {
            toast.info("No item in this sale is eligible for the senior citizen / PWD discount yet");
          }
        }}
      />
      <OrderDiscountDialog open={showDiscount} current={cart.orderDiscount} onClose={() => setShowDiscount(false)} onApply={(d) => void applyOrderDiscount(d)} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
