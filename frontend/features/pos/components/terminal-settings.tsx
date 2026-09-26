"use client";

import { SettingsIcon, ShieldCheckIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_SETTINGS, saveTerminalSettings, type TerminalSettings } from "@/lib/db/meta";
import { getDb } from "@/lib/db/schema";
import { buildReceiptSample } from "@/lib/printing/sample";
import { forgetPrinters, isSupported, pairedPrinter, pairPrinter, type EscPosMode } from "@/lib/printing/escpos-transport";
import { openCashDrawer, printDocument, type PrinterMode } from "@/lib/printing/output";
import { usePosSession } from "@/stores/pos-session-store";

import { requestAuthorization } from "../manager-auth";

export const SETTINGS_PERMISSION = "settings.manage";

/** Per-terminal settings (stored in IndexedDB). Changing them needs `settings.manage`. */
export function TerminalSettingsView() {
  const { context, cashier } = usePosSession();
  const [unlocked, setUnlocked] = useState(() => Boolean(cashier?.permissions.includes(SETTINGS_PERMISSION)));
  if (!context || !cashier) return null;

  if (!unlocked) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-8 text-center">
        <ShieldCheckIcon className="mx-auto size-10 text-primary" />
        <p className="text-sm text-muted-foreground">Terminal settings can only be changed with a manager&apos;s approval.</p>
        <Button
          className="h-12 w-full"
          onClick={() =>
            void requestAuthorization(SETTINGS_PERMISSION, "Change terminal settings").then((id) => id && setUnlocked(true))
          }
        >
          Unlock settings
        </Button>
      </div>
    );
  }
  return <SettingsForm initial={context.settings} />;
}

function SettingsForm({ initial }: { initial: TerminalSettings }) {
  const [s, setS] = useState<TerminalSettings>(initial);
  const set = <K extends keyof TerminalSettings>(key: K, value: TerminalSettings[K]) => setS({ ...s, [key]: value });

  const save = async () => {
    const clamp = (n: number, lo: number, hi: number, fallback: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback);
    const next: TerminalSettings = {
      ...s,
      scannerMinLength: clamp(s.scannerMinLength, 1, 20, DEFAULT_SETTINGS.scannerMinLength),
      scannerMaxInterKeyMs: clamp(s.scannerMaxInterKeyMs, 10, 500, DEFAULT_SETTINGS.scannerMaxInterKeyMs),
      scannerMaxAvgInterKeyMs: clamp(s.scannerMaxAvgInterKeyMs, 5, 300, DEFAULT_SETTINGS.scannerMaxAvgInterKeyMs),
    };
    await saveTerminalSettings(getDb(), next);
    const session = usePosSession.getState();
    if (session.context) session.setContext({ ...session.context, settings: next });
    setS(next);
    toast.success("Settings saved");
  };

  return (
    <form
      className="mx-auto w-full max-w-xl space-y-5 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <SettingsIcon className="size-5" /> Terminal settings
      </h1>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Receipt paper width</legend>
        <div className="flex gap-2" role="radiogroup" aria-label="Receipt paper width">
          {([58, 80] as const).map((w) => (
            <Button key={w} type="button" variant={s.receiptWidth === w ? "default" : "outline"} className="h-11 flex-1" onClick={() => set("receiptWidth", w)}>
              {w} mm
            </Button>
          ))}
        </div>
      </fieldset>

      <PrinterSection settings={s} onModeChange={(mode) => set("printerMode", mode)} onBaudChange={(v) => set("serialBaudRate", v)} />

      <Toggle id="auto-print" label="Print receipt automatically after each sale" checked={s.printReceiptAutomatically} onChange={(v) => set("printReceiptAutomatically", v)} />
      <Toggle id="sound" label="Scan sounds" checked={s.scannerSound} onChange={(v) => set("scannerSound", v)} />
      <Toggle id="stock-warning" label="Warn when selling more than local stock" checked={s.warnOnNegativeStock} onChange={(v) => set("warnOnNegativeStock", v)} />
      <Toggle id="require-session" label="Require an open cash session to sell" checked={s.requireCashSession} onChange={(v) => set("requireCashSession", v)} />

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Barcode scanner timing</legend>
        <p className="text-xs text-muted-foreground">Increase the gaps for slow Bluetooth scanners. Defaults suit most USB scanners.</p>
        <div className="grid grid-cols-3 gap-2">
          <NumberField id="scan-min" label="Min length" value={s.scannerMinLength} onChange={(v) => set("scannerMinLength", v)} />
          <NumberField id="scan-gap" label="Max gap (ms)" value={s.scannerMaxInterKeyMs} onChange={(v) => set("scannerMaxInterKeyMs", v)} />
          <NumberField id="scan-avg" label="Max avg gap (ms)" value={s.scannerMaxAvgInterKeyMs} onChange={(v) => set("scannerMaxAvgInterKeyMs", v)} />
        </div>
      </fieldset>

      <Button type="submit" className="h-12 w-full">
        Save settings
      </Button>
    </form>
  );
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
    </div>
  );
}

function NumberField({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input id={id} inputMode="numeric" className="h-10" value={String(value)} onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")))} />
    </div>
  );
}

const PRINTER_MODES: { mode: PrinterMode; label: string }[] = [
  { mode: "browser", label: "Browser (any printer)" },
  { mode: "escpos-usb", label: "ESC/POS USB" },
  { mode: "escpos-serial", label: "ESC/POS serial" },
];

function PrinterSection({
  settings,
  onModeChange,
  onBaudChange,
}: {
  settings: TerminalSettings;
  onModeChange: (mode: PrinterMode) => void;
  onBaudChange: (baud: number) => void;
}) {
  const mode = settings.printerMode;
  const escpos = mode === "browser" ? null : (mode as EscPosMode);
  const [paired, setPaired] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (escpos ? pairedPrinter(escpos) : Promise.resolve(null)).then((name) => {
      if (!cancelled) setPaired(name);
    });
    return () => {
      cancelled = true;
    };
  }, [escpos, version]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
      setVersion((v) => v + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Receipt printer</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Receipt printer">
        {PRINTER_MODES.map((m) => (
          <Button key={m.mode} type="button" variant={mode === m.mode ? "default" : "outline"} onClick={() => onModeChange(m.mode)}>
            {m.label}
          </Button>
        ))}
      </div>
      {escpos && !isSupported(escpos) && (
        <p className="text-sm text-destructive">This browser can&apos;t reach printers directly (Chrome or Edge on desktop/Android can). Receipts will print through the browser.</p>
      )}
      {escpos && isSupported(escpos) && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm">{paired ? `Paired: ${paired}` : "No printer paired yet."}</p>
          {escpos === "escpos-serial" && (
            <NumberField id="baud" label="Baud rate" value={settings.serialBaudRate} onChange={onBaudChange} />
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void run(() => pairPrinter(escpos), "Printer paired")}>
              Pair printer
            </Button>
            <Button type="button" variant="outline" disabled={!paired} onClick={() => void run(() => forgetPrinters(escpos), "Printer forgotten")}>
              Forget
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!paired}
              onClick={() =>
                void run(async () => {
                  const outcome = await printDocument(buildReceiptSample(settings.receiptWidth), settings);
                  if (outcome.fallbackReason) throw new Error(outcome.fallbackReason);
                }, "Test page sent")
              }
            >
              Test print
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!paired}
              onClick={() =>
                void run(async () => {
                  if (!(await openCashDrawer(settings))) throw new Error("The drawer did not respond");
                }, "Drawer opened")
              }
            >
              Open drawer
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Save settings after changing the printer type. The drawer opens with cash payments.</p>
        </div>
      )}
    </fieldset>
  );
}
