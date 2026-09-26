import { create } from "zustand";

import type { PosContext } from "@/lib/db/context";
import type { LocalCashSession, LocalStaff } from "@/lib/db/schema";

interface PosSessionState {
  context: PosContext | null;
  /** Cashier logged in with their PIN. Memory only: a reload returns to the PIN screen. */
  cashier: LocalStaff | null;
  cashSession: LocalCashSession | null;
  setContext: (context: PosContext | null) => void;
  login: (cashier: LocalStaff) => void;
  logout: () => void;
  setCashSession: (session: LocalCashSession | null) => void;
}

export const usePosSession = create<PosSessionState>()((set) => ({
  context: null,
  cashier: null,
  cashSession: null,
  setContext: (context) => set({ context }),
  login: (cashier) => set({ cashier }),
  logout: () => set({ cashier: null }),
  setCashSession: (cashSession) => set({ cashSession }),
}));

export function hasPermission(staff: LocalStaff | null, permission: string): boolean {
  return Boolean(staff?.permissions.includes(permission));
}
