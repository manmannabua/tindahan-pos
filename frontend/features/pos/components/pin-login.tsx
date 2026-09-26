"use client";

import { UserRoundIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useLiveQuery } from "@/hooks/use-live-query";
import { checkPin, pinCheckMessage } from "@/lib/auth/pin";
import { getDb } from "@/lib/db/schema";
import { usePosSession } from "@/stores/pos-session-store";

import { PinPad } from "./pin-pad";

/** Cashier login with PIN — verified locally, works offline (docs/SECURITY.md §4). */
export function PinLogin() {
  const staff = useLiveQuery(
    async () => (await getDb().staff.toArray()).filter((s) => s.canUsePos).sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [],
    [],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const result = await checkPin(getDb(), selected, pin, { requiredPermission: "pos.access" });
    setBusy(false);
    setPin("");
    if (result.ok) usePosSession.getState().login(result.staff);
    else setError(pinCheckMessage(result));
  };

  const person = staff.find((s) => s.id === selected);

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 p-4 sm:p-8 md:grid-cols-2">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold">Who is selling?</h1>
        <div className="grid gap-2">
          {staff.map((s) => (
            <Button
              key={s.id}
              variant={selected === s.id ? "default" : "outline"}
              className="h-14 justify-start gap-3 text-base"
              onClick={() => {
                setSelected(s.id);
                setError(null);
                setPin("");
              }}
            >
              <UserRoundIcon className="size-5" />
              {s.fullName}
              <span className="ml-auto text-xs opacity-70">@{s.username}</span>
            </Button>
          ))}
          {staff.length === 0 && <p className="text-sm text-muted-foreground">No staff can use this terminal.</p>}
        </div>
      </section>
      <section className="space-y-3 rounded-xl border bg-background p-5">
        {person ? (
          <>
            <h2 className="text-lg font-semibold">PIN for {person.fullName}</h2>
            <PinPad key={person.id} value={pin} onChange={setPin} onSubmit={() => void submit()} disabled={busy} />
            {error && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Select your name, then enter your PIN.</p>
        )}
      </section>
    </div>
  );
}
