import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import type {
  ChangePasswordRequest,
  LoginRequest,
  Me,
  SignupRequest,
  SignupResponse,
  TokenResponse,
} from "@/types/api";

export async function login(data: LoginRequest): Promise<Me> {
  const response = await api.request<TokenResponse>("/auth/login", { method: "POST", body: data, auth: false });
  useAuthStore.getState().setSession(response.access_token, response.user);
  return response.user;
}

/** Create a company + owner account, then sign in as the owner. */
export async function signup(data: SignupRequest): Promise<Me> {
  await api.request<SignupResponse>("/companies/signup", { method: "POST", body: data, auth: false });
  return login({ email: data.owner_email, password: data.owner_password });
}

export async function logout(): Promise<void> {
  try {
    await api.request<void>("/auth/logout", { method: "POST", body: { client: "admin" }, auth: false });
  } finally {
    useAuthStore.getState().clearSession();
  }
}

export function changePassword(data: ChangePasswordRequest): Promise<void> {
  return api.post<void>("/auth/me/password", data);
}
