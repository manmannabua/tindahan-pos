"use client";

import { useEffect, useState } from "react";

import { loadPosContext, TerminalNotReadyError } from "@/lib/db/context";
import { getDb } from "@/lib/db/schema";
import { getOpenSession } from "@/lib/pos/cash-session";
import { countUnsynced } from "@/lib/sync/outbox";
import { startSync } from "@/lib/sync/service";
import { useLiveQuery } from "@/hooks/use-live-query";
import { useCartStore } from "@/stores/cart-store";
import { usePosSession } from "@/stores/pos-session-store";
import { useTerminalStore } from "@/stores/terminal-store";
import type { PromotionSync } from "@/types/sync";

export type BootState = "loading" | "not_ready" | "ready" | "error";

/**
 * Load the terminal context from IndexedDB (no network), start background sync and keep the
 * pending-operations count in the status bar live.
 */
export function usePosBootstrap(): { state: BootState; error: string | null } {
  const [state, setState] = useState<BootState>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = getDb();
        const context = await loadPosContext(db);
        if (cancelled) return;
        const session = usePosSession.getState();
        session.setContext(context);
        session.setCashSession((await getOpenSession(db)) ?? null);
        useCartStore.getState().setPriceContext({
          priceLevelId: context.defaultPriceLevel.id,
          defaultPriceLevelId: context.defaultPriceLevel.id,
          branchId: context.branch.id,
          pricesIncludeTax: context.company.pricesIncludeTax,
        });
        setState("ready");
        void startSync();
      } catch (e) {
        if (cancelled) return;
        if (e instanceof TerminalNotReadyError) setState("not_ready");
        else {
          setError(e instanceof Error ? e.message : String(e));
          setState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pending = useLiveQuery(() => countUnsynced(getDb()), [], 0);
  useEffect(() => {
    useTerminalStore.getState().setSyncState({ pendingCount: pending });
  }, [pending]);

  // Promotions: follow what sync downloads, and re-evaluate every minute so time windows
  // (happy hour, a promotion ending at midnight) take effect in an open cart.
  const promotions = useLiveQuery(() => getDb().promotions.toArray(), [], []);
  const context = usePosSession((s) => s.context);
  useEffect(() => {
    if (!context) return;
    const apply = () =>
      useCartStore.getState().setPromoContext({
        promotions: promotions.filter((p) => p.isActive).map((p) => p.data as PromotionSync),
        timeZone: context.company.timezone,
        branchId: context.branch.id,
      });
    apply();
    const timer = window.setInterval(apply, 60_000);
    return () => window.clearInterval(timer);
  }, [promotions, context]);

  return { state, error };
}
