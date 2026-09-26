"use client";

import { UserPlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLiveQuery } from "@/hooks/use-live-query";
import { getDb, type LocalCustomer } from "@/lib/db/schema";
import { createCustomerOffline, searchCustomers } from "@/lib/pos/customers";
import { triggerSync } from "@/lib/sync/service";
import { useCartStore } from "@/stores/cart-store";
import { usePosSession } from "@/stores/pos-session-store";

/** Attach a customer to the sale: search local customers, or create one (works offline). */
export function CustomerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">{open && <CustomerPicker onDone={onClose} />}</DialogContent>
    </Dialog>
  );
}

function CustomerPicker({ onDone }: { onDone: () => void }) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const debounced = useDebouncedValue(query, 150);
  const results = useLiveQuery<LocalCustomer[]>(() => searchCustomers(getDb(), debounced), [debounced], []);
  const levels = useLiveQuery(() => getDb().priceLevels.toArray(), [], []);

  const select = (c: LocalCustomer) => {
    useCartStore.getState().setCustomer({ id: c.id, name: c.name, priceLevelId: c.priceLevelId });
    onDone();
  };

  if (creating) return <NewCustomerForm initialName={/\d/.test(query) ? "" : query} initialPhone={/\d/.test(query) ? query : ""} onCreated={select} onCancel={() => setCreating(false)} />;

  return (
    <div className="space-y-3">
      <DialogHeader>
        <DialogTitle>Customer</DialogTitle>
        <DialogDescription>Search by name or phone number.</DialogDescription>
      </DialogHeader>
      <Input aria-label="Search customers" autoFocus className="h-11" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul className="max-h-72 divide-y overflow-auto rounded-lg border" aria-label="Customers">
        {results.map((c) => (
          <li key={c.id}>
            <button type="button" className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted" onClick={() => select(c)}>
              <span className="font-medium">{c.name}</span>
              {c.priceLevelId && (
                <span className="rounded bg-muted px-1.5 text-xs">{levels.find((l) => l.id === c.priceLevelId)?.name ?? "Price level"}</span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">{c.phone}</span>
            </button>
          </li>
        ))}
        {debounced.trim() && results.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">No match.</li>}
      </ul>
      <Button variant="outline" className="h-11 w-full" onClick={() => setCreating(true)}>
        <UserPlusIcon /> New customer
      </Button>
    </div>
  );
}

function NewCustomerForm({
  initialName,
  initialPhone,
  onCreated,
  onCancel,
}: {
  initialName: string;
  initialPhone: string;
  onCreated: (c: LocalCustomer) => void;
  onCancel: () => void;
}) {
  const { context, cashier } = usePosSession();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [busy, setBusy] = useState(false);
  if (!context || !cashier) return null;

  const submit = async () => {
    setBusy(true);
    try {
      const customer = await createCustomerOffline(getDb(), {
        name,
        phone,
        deviceId: context.device.deviceId,
        userId: cashier.id,
      });
      triggerSync();
      onCreated(customer);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>New customer</DialogTitle>
        <DialogDescription>Saved on this terminal and sent to the server with the next sync.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="customer-name">Name</Label>
        <Input id="customer-name" autoFocus required className="h-11" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="customer-phone">Phone (optional)</Label>
        <Input id="customer-phone" type="tel" className="h-11" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="h-11" onClick={onCancel}>
          Back
        </Button>
        <Button type="submit" className="h-11 flex-1" disabled={busy || !name.trim()}>
          Save customer
        </Button>
      </div>
    </form>
  );
}
