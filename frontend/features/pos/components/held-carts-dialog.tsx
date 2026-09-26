"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLiveQuery } from "@/hooks/use-live-query";
import { getDb } from "@/lib/db/schema";
import type { Cart } from "@/lib/pos/cart";
import { useCartStore } from "@/stores/cart-store";

/** Recall a held sale. Held carts live in IndexedDB, so they survive a restart. */
export function HeldCartsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const held = useLiveQuery(() => getDb().heldCarts.orderBy("heldAt").toArray(), [], []);
  const recall = async (id: string) => {
    const db = getDb();
    const row = await db.heldCarts.get(id);
    if (!row) return;
    useCartStore.getState().replace(row.cart as Cart);
    await db.heldCarts.delete(id);
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Held sales</DialogTitle>
        </DialogHeader>
        {held.length === 0 && <p className="text-sm text-muted-foreground">No held sales.</p>}
        <div className="grid gap-2">
          {held.map((h) => (
            <Button key={h.id} variant="outline" className="h-12 justify-between" onClick={() => void recall(h.id)}>
              <span>{h.label}</span>
              <span className="text-xs text-muted-foreground">{new Date(h.heldAt).toLocaleTimeString()}</span>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
