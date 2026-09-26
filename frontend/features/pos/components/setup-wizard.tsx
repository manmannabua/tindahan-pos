"use client";

import { CheckCircle2Icon, CircleIcon, LoaderIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { TextField } from "@/components/shared/form-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { login } from "@/features/auth/api";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/api/errors";
import { getDeviceClient } from "@/lib/device";
import { getMeta } from "@/lib/db/meta";
import { getDb } from "@/lib/db/schema";
import { downloadAndValidate, registerTerminal, ValidationFailedError, type DownloadProgress } from "@/lib/pos/setup";
import { cn } from "@/lib/utils";
import type { Branch } from "@/types/api";
import type { PullTableName } from "@/types/sync";

type Step = "signin" | "configure" | "download" | "ready";

const PROGRESS_ROWS: { label: string; tables: PullTableName[] }[] = [
  { label: "Settings", tables: ["companies", "branches", "stock_locations", "tax_rates", "price_levels", "payment_methods"] },
  { label: "Categories & units", tables: ["categories", "brands", "units"] },
  { label: "Products", tables: ["products", "product_variants", "product_units"] },
  { label: "Barcodes", tables: ["barcodes"] },
  { label: "Prices", tables: ["prices"] },
  { label: "Inventory", tables: ["inventory_balances"] },
  { label: "Customers & promotions", tables: ["customers", "promotions"] },
];

/** Terminal initialization (docs/DEVICE_MANAGEMENT.md §2, §4). Requires the network. */
export function SetupWizard() {
  const [step, setStep] = useState<Step | null>(null);

  // Resume: registered but the download didn't finish (or already ready).
  useEffect(() => {
    void (async () => {
      const db = getDb();
      const status = await getMeta(db, "initStatus");
      setStep(status === "READY" ? "ready" : status === "DOWNLOADING" ? "download" : "signin");
    })();
  }, []);

  if (step === null) return null;
  return (
    <div className="mx-auto w-full max-w-xl space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Terminal setup</h1>
      {step === "signin" && <SignIn onDone={() => setStep("configure")} />}
      {step === "configure" && <Configure onDone={() => setStep("download")} />}
      {step === "download" && <Download onDone={() => setStep("ready")} />}
      {step === "ready" && <Ready />}
    </div>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const me = await login({ email, password });
      const canRegister = me.permissions.includes("devices.register") || Object.values(me.branch_permissions).some((p) => p.includes("devices.register"));
      if (!canRegister) throw new Error("This account cannot register terminals (needs devices.register).");
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>1. Manager sign-in</CardTitle>
        <CardDescription>Registering a terminal needs a manager account and a connection to the server.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="submit" size="lg" className="h-11 w-full" disabled={busy || !email || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Configure({ onDone }: { onDone: () => void }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [code, setCode] = useState("T01");
  const [name, setName] = useState("Counter 1");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.get<Branch[]>("/branches").then((rows) => {
      setBranches(rows);
      if (rows.length === 1) setBranchId(rows[0].id);
    }, (e: unknown) => setError(errorMessage(e)));
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await registerTerminal(getDb(), api, { branchId, terminalCode: code.trim().toUpperCase(), name: name.trim() });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>2. Branch and terminal</CardTitle>
        <CardDescription>A key pair is generated on this device; only the public key is sent to the server.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label>Branch</Label>
            <div className="grid gap-2">
              {branches.map((b) => (
                <Button key={b.id} type="button" variant={branchId === b.id ? "default" : "outline"} className="h-11 justify-start" onClick={() => setBranchId(b.id)}>
                  {b.code} · {b.name}
                </Button>
              ))}
            </div>
          </div>
          <TextField label="Terminal code" value={code} onChange={(e) => setCode(e.target.value)} description="Unique per branch, e.g. T01. Printed on receipts." />
          <TextField label="Terminal name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" size="lg" className="h-11 w-full" disabled={busy || !branchId || !code.trim() || name.trim().length < 2}>
            {busy ? "Registering…" : "Register terminal"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Download({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState<DownloadProgress>({ expected: {}, received: {}, done: false });
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    downloadAndValidate(getDb(), getDeviceClient(), (p) => !cancelled && setProgress(p)).then(
      () => !cancelled && onDone(),
      (e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ValidationFailedError ? `${e.message}. Retry the download.` : errorMessage(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt, onDone]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>3. Download for offline use</CardTitle>
        <CardDescription>The terminal is not ready for offline use until every step is checked.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2" aria-label="Download progress">
          {PROGRESS_ROWS.map((row) => {
            const expected = row.tables.reduce((n, t) => n + (progress.expected[t] ?? 0), 0);
            const received = row.tables.reduce((n, t) => n + (progress.received[t] ?? 0), 0);
            const known = row.tables.every((t) => progress.expected[t] !== undefined);
            const complete = progress.done || (known && received >= expected);
            return (
              <li key={row.label} className="flex items-center gap-3 text-sm">
                {complete ? (
                  <CheckCircle2Icon className="size-5 text-emerald-600" />
                ) : error ? (
                  <CircleIcon className="size-5 text-muted-foreground" />
                ) : (
                  <LoaderIcon className="size-5 animate-spin text-muted-foreground" />
                )}
                <span className="w-40">{row.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {received.toLocaleString()}
                  {known ? ` / ${expected.toLocaleString()}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
        {error && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Button className="h-11 w-full" onClick={() => {
              setError(null);
              setAttempt((a) => a + 1);
            }}>
            Retry download
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Ready() {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    void getMeta(getDb(), "persistentStorage").then((v) => setPersisted(v ?? false));
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2Icon className="size-6" /> POS READY FOR OFFLINE USE
        </CardTitle>
        <CardDescription>This terminal can now sell without a connection. Sales sync automatically when online.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {persisted === false && (
          <Alert>
            <TriangleAlertIcon />
            <AlertDescription>
              The browser did not grant persistent storage. Install the app (Add to Home Screen / Install) so offline data
              is never evicted.
            </AlertDescription>
          </Alert>
        )}
        <a href="/pos" className={cn(buttonVariants({ size: "lg" }), "h-12 w-full")}>
          Open terminal
        </a>
      </CardContent>
    </Card>
  );
}
