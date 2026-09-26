"use client";

import { ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { create } from "zustand";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { checkPin, pinCheckMessage } from "@/lib/auth/pin";
import { getDb } from "@/lib/db/schema";
import { useLiveQuery } from "@/hooks/use-live-query";
import { usePosSession } from "@/stores/pos-session-store";

import { PinPad } from "./components/pin-pad";

interface Request {
  permission: string;
  reason: string;
  resolve: (authorizerId: string | null) => void;
}

const useAuthRequest = create<{ request: Request | null; set: (r: Request | null) => void }>()((set) => ({
  request: null,
  set: (request) => set({ request }),
}));

/**
 * Manager authorization (docs/SECURITY.md §6). Resolves with the id of the person who approved,
 * or null if cancelled. If the logged-in cashier holds the permission, they approve themselves.
 * Works offline: PINs are verified locally; the server re-validates on sync.
 */
export function requestAuthorization(permission: string, reason: string): Promise<string | null> {
  const cashier = usePosSession.getState().cashier;
  if (cashier?.permissions.includes(permission)) return Promise.resolve(cashier.id);
  return new Promise((resolve) => useAuthRequest.getState().set({ permission, reason, resolve }));
}

/** Mount once in the POS app. */
export function ManagerAuthDialog() {
  const request = useAuthRequest((s) => s.request);
  const close = (id: string | null) => {
    request?.resolve(id);
    useAuthRequest.getState().set(null);
  };
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && close(null)}>
      <DialogContent className="sm:max-w-md">
        {request && <AuthForm key={request.reason + request.permission} request={request} onDone={close} />}
      </DialogContent>
    </Dialog>
  );
}

function AuthForm({ request, onDone }: { request: Request; onDone: (id: string | null) => void }) {
  const approvers = useLiveQuery(
    () => getDb().staff.filter((s) => s.canUsePos && s.permissions.includes(request.permission)).toArray(),
    [request.permission],
    [],
  );
  const [approverId, setApproverId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!approverId) return;
    setBusy(true);
    const result = await checkPin(getDb(), approverId, pin, { requiredPermission: request.permission });
    setBusy(false);
    setPin("");
    if (result.ok) onDone(result.staff.id);
    else setError(pinCheckMessage(result));
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ShieldCheckIcon className="size-5 text-primary" /> Manager approval
        </DialogTitle>
        <DialogDescription>{request.reason}</DialogDescription>
      </DialogHeader>
      {approvers.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody on this terminal can approve this ({request.permission}).</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {approvers.map((a) => (
            <Button key={a.id} variant={approverId === a.id ? "default" : "outline"} onClick={() => setApproverId(a.id)}>
              {a.fullName}
            </Button>
          ))}
        </div>
      )}
      {approverId && <PinPad value={pin} onChange={setPin} onSubmit={() => void submit()} disabled={busy} label="Manager PIN" />}
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      <Button variant="ghost" onClick={() => onDone(null)}>
        Cancel
      </Button>
    </>
  );
}
