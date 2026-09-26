import { create } from "zustand";

import type { Me } from "@/types/api";

export type AuthStatus = "unknown" | "authenticated" | "anonymous";

interface AuthState {
  /** Access token, kept in memory only. Never persisted: any XSS could read persisted storage. */
  accessToken: string | null;
  user: Me | null;
  status: AuthStatus;
  setSession: (accessToken: string, user: Me) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  user: null,
  status: "unknown",
  setSession: (accessToken, user) => set({ accessToken, user, status: "authenticated" }),
  clearSession: () => set({ accessToken: null, user: null, status: "anonymous" }),
}));
