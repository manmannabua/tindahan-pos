"use client";

import {
  BanknoteIcon,
  DownloadIcon,
  FileTextIcon,
  HistoryIcon,
  LockIcon,
  MonitorSmartphoneIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  SettingsIcon,
  ShoppingCartIcon,
} from "lucide-react";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCartStore } from "@/stores/cart-store";
import { usePosSession } from "@/stores/pos-session-store";

import { usePosBootstrap } from "../hooks/use-pos-bootstrap";
import { useServiceWorkerUpdate } from "../hooks/use-sw-update";
import { ManagerAuthDialog } from "../manager-auth";
import { CashView, OpenCashSession } from "./cash-session-views";
import { PinLogin } from "./pin-login";
import { ReadingsCard } from "./readings-card";
import { ReceiptsJournal } from "./receipts-journal";
import { SalesHistory } from "./sales-history";
import { SellScreen } from "./sell-screen";
import { SyncMonitor } from "./sync-monitor";
import { TerminalSettingsView } from "./terminal-settings";
import { usePosFeature } from "../hooks/use-pos-feature";

type View = "sell" | "cash" | "readings" | "sales" | "receipts" | "sync" | "settings";

const VIEWS: { id: View; label: string; icon: typeof ShoppingCartIcon }[] = [
  { id: "sell", label: "Sell", icon: ShoppingCartIcon },
  { id: "cash", label: "Cash", icon: BanknoteIcon },
  { id: "readings", label: "Readings", icon: FileTextIcon },
  { id: "sales", label: "Sales", icon: HistoryIcon },
  { id: "receipts", label: "Receipts", icon: ReceiptTextIcon },
  { id: "sync", label: "Sync", icon: RefreshCwIcon },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

/**
 * The whole terminal runs inside this one statically-rendered page: views switch in memory, not
 * by navigation, so nothing needs the network and the PIN session (memory only) survives view
 * changes. See docs/OFFLINE_ARCHITECTURE.md.
 */
export function PosApp() {
  const { state, error } = usePosBootstrap();
  const { context, cashier, cashSession } = usePosSession();
  const [view, setView] = useState<View>("sell");
  const cashOn = usePosFeature("cash_management");
  const birOn = usePosFeature("bir");
  const journalOn = usePosFeature("receipt_journal");

  if (state === "loading") return <p className="p-8 text-center text-muted-foreground">Opening terminal…</p>;
  if (state === "error") return <p className="p-8 text-center text-destructive">Could not open the local database: {error}</p>;
  if (state === "not_ready") return <NotReady />;
  if (!context) return null;
  if (!cashier) return <PinLogin />;

  // Cash sessions are part of the optional cash-drawer feature. Without it, X/Z readings (BIR)
  // get their own tab.
  const needsSession = cashOn && context.settings.requireCashSession && !cashSession;
  const views = VIEWS.filter(
    (v) => (v.id !== "cash" || cashOn) && (v.id !== "readings" || (birOn && !cashOn)) && (v.id !== "receipts" || journalOn),
  );
  const lock = () => {
    usePosSession.getState().logout();
    setView("sell");
  };

  return (
    <div className="flex flex-1 flex-col">
      <nav className="flex items-center gap-1 border-b bg-background px-3 py-1.5" aria-label="Terminal">
        {views.map(({ id, label, icon: Icon }) => (
          <Button key={id} variant={view === id ? "secondary" : "ghost"} className="h-10" onClick={() => setView(id)}>
            <Icon /> {label}
          </Button>
        ))}
        <UpdateBanner />
        <span className="ml-auto hidden text-sm text-muted-foreground sm:inline">
          {context.branch.name} · {context.device.terminalCode} · {cashier.fullName}
        </span>
        {/* The cart stays (checkpointed) while locked; the next cashier continues or clears it. */}
        <Button variant="outline" className="h-10" onClick={lock}>
          <LockIcon /> Lock
        </Button>
      </nav>
      {view === "sell" && (needsSession ? <OpenCashSession /> : <SellScreen />)}
      {view === "cash" && cashOn && <CashView />}
      {view === "readings" && (
        <div className="mx-auto w-full max-w-3xl p-4">
          <ReadingsCard shiftStart={null} />
        </div>
      )}
      {view === "sales" && <SalesHistory />}
      {view === "receipts" && journalOn && <ReceiptsJournal />}
      {view === "sync" && <SyncMonitor />}
      {view === "settings" && <TerminalSettingsView />}
      <ManagerAuthDialog />
    </div>
  );
}

/** "Update available — reload when idle": applied only with an empty cart, never mid-sale. */
function UpdateBanner() {
  const { available, apply } = useServiceWorkerUpdate();
  const cartEmpty = useCartStore((s) => s.lines.length === 0);
  if (!available) return null;
  return (
    <Button
      variant="secondary"
      className="h-10"
      disabled={!cartEmpty}
      title={cartEmpty ? "Reload now to use the new version" : "Finish the current sale first"}
      onClick={apply}
    >
      <DownloadIcon /> Update available — reload when idle
    </Button>
  );
}

function NotReady() {
  return (
    <div className="mx-auto max-w-md space-y-4 p-8 text-center">
      <MonitorSmartphoneIcon className="mx-auto size-10 text-primary" />
      <h1 className="text-xl font-semibold">This terminal is not set up</h1>
      <p className="text-sm text-muted-foreground">
        A manager must register this device and download the catalog once, while online. After that the terminal
        works without a connection.
      </p>
      {/* Plain anchors keep navigation inside the precached POS shell. */}
      <a href="/pos/setup" className={cn(buttonVariants({ size: "lg" }), "h-12 w-full")}>
        Set up this terminal
      </a>
    </div>
  );
}
