/**
 * Extra seeding/verification for the Phase 7 POS e2e (managers, promotions, customers, returns).
 */
import { API_URL, PASSWORD, type SeededCompany } from "./api";

export const MANAGER_PIN = "246813";

async function call<T>(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", "X-Requested-With": "pos", Authorization: `Bearer ${token}` },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${response.status}: ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function createManager(company: SeededCompany): Promise<{ id: string; fullName: string }> {
  const roles = await call<{ id: string; code: string }[]>("/roles", company.token);
  const manager = await call<{ id: string; full_name: string }>("/users", company.token, {
    method: "POST",
    body: {
      email: `mara-${company.code.toLowerCase()}@example.com`,
      username: "mara",
      full_name: "Mara Manager",
      password: PASSWORD,
      pin: MANAGER_PIN,
      roles: [{ role_id: roles.find((r) => r.code === "MANAGER")?.id, branch_id: null }],
    },
  });
  return { id: manager.id, fullName: manager.full_name };
}

export async function createPromotion(company: SeededCompany, body: Record<string, unknown>): Promise<{ id: string }> {
  return call("/promotions", company.token, { method: "POST", body });
}

export interface SaleDetailFull {
  id: string;
  receipt_number: string;
  status: string;
  customer_id: string | null;
  total: string;
  discount_total: string;
  items: { product_name: string; quantity: string; line_discount: string; total: string }[];
}

export async function saleByReceipt(company: SeededCompany, receipt: string): Promise<SaleDetailFull> {
  const page = await call<{ items: { id: string }[] }>(`/sales?receipt_number=${encodeURIComponent(receipt)}`, company.token);
  if (page.items.length !== 1) throw new Error(`expected one sale ${receipt}, got ${page.items.length}`);
  return call(`/sales/${page.items[0].id}`, company.token);
}

export async function customers(company: SeededCompany, q: string): Promise<{ id: string; name: string; phone: string | null }[]> {
  return (await call<{ items: { id: string; name: string; phone: string | null }[] }>(`/customers?q=${encodeURIComponent(q)}`, company.token)).items;
}

export async function returnsToday(company: SeededCompany): Promise<{ return_number: string; refund_total: string; original_sale_id: string }[]> {
  return (await call<{ data: { return_number: string; refund_total: string; original_sale_id: string }[] }>("/reports/returns", company.token)).data;
}

export async function failedOperations(company: SeededCompany): Promise<{ operation: string; error: unknown }[]> {
  return (await call<{ failed_operations: { operation: string; error: unknown }[] }>("/sync/monitor", company.token)).failed_operations;
}
