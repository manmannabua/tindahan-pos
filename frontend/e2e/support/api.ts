/**
 * Direct backend API access for e2e seeding and verification (bypasses the browser).
 * E2E_API_URL defaults to the local backend used by `pnpm test:e2e`.
 */
export const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000/api/v1";
export const PASSWORD = "correct-horse-battery";
export const CASHIER_PIN = "482915";

async function call<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "pos",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${response.status}: ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** A valid EAN-13 in the restricted-circulation range (prefix 2). */
export function ean13(n: number): string {
  const body = `2${String(n).padStart(11, "0")}`;
  let sum = 0;
  [...body].reverse().forEach((d, i) => (sum += Number(d) * (i % 2 === 0 ? 3 : 1)));
  return body + ((10 - (sum % 10)) % 10);
}

export interface SeededProduct {
  name: string;
  barcode: string;
  price: string;
  variantId: string;
}

export interface SeededCompany {
  code: string;
  email: string;
  token: string;
  branchId: string;
  locationId: string;
  products: SeededProduct[];
  cashier: { id: string; username: string; fullName: string };
}

export async function seedCompany(options: {
  products: { name: string; price: string; stock: string; scPwdEligible?: boolean }[];
}): Promise<SeededCompany> {
  const code = `E2E${Date.now().toString(36).toUpperCase().slice(-5)}${Math.floor(Math.random() * 100)}`;
  const email = `owner-${code.toLowerCase()}@example.com`;
  const signup = await call<{ branch_id: string }>("/companies/signup", {
    method: "POST",
    body: {
      company_name: `${code} Mart`,
      company_code: code,
      owner_full_name: "Erin Owner",
      owner_email: email,
      owner_username: "erin",
      owner_password: PASSWORD,
    },
  });
  const { access_token: token } = await call<{ access_token: string }>("/auth/login", {
    method: "POST",
    body: { email, password: PASSWORD },
  });
  const branch = await call<{ locations: { id: string; is_default: boolean }[] }>(`/branches/${signup.branch_id}`, { token });
  const locationId = branch.locations.find((l) => l.is_default)?.id ?? "";
  const units = await call<{ id: string; code: string }[]>("/units", { token });
  const pc = units.find((u) => u.code === "PC")?.id;

  const seed = Date.now() % 100_000_000;
  const products: SeededProduct[] = [];
  for (const [i, p] of options.products.entries()) {
    const barcode = ean13(seed * 10 + i);
    const product = await call<{ variants: { id: string }[] }>("/products", {
      method: "POST",
      token,
      body: {
        name: p.name,
        base_unit_id: pc,
        ...(p.scPwdEligible ? { sc_pwd_eligible: true } : {}),
        variants: [{ cost: "10.0000", barcodes: [{ code: barcode, is_primary: true }], prices: [{ price: p.price }] }],
      },
    });
    const variantId = product.variants[0].id;
    await call("/inventory/initial-stock", {
      method: "POST",
      token,
      body: { stock_location_id: locationId, lines: [{ variant_id: variantId, quantity: p.stock }] },
    });
    products.push({ name: p.name, barcode, price: p.price, variantId });
  }

  const roles = await call<{ id: string; code: string }[]>("/roles", { token });
  const cashierRole = roles.find((r) => r.code === "CASHIER")?.id;
  const cashier = await call<{ id: string; username: string; full_name: string }>("/users", {
    method: "POST",
    token,
    body: {
      email: `cathy-${code.toLowerCase()}@example.com`,
      username: "cathy",
      full_name: "Cathy Cashier",
      password: PASSWORD,
      pin: CASHIER_PIN,
      roles: [{ role_id: cashierRole, branch_id: null }],
    },
  });
  return {
    code,
    email,
    token,
    branchId: signup.branch_id,
    locationId,
    products,
    cashier: { id: cashier.id, username: cashier.username, fullName: cashier.full_name },
  };
}

export interface SaleSummary {
  id: string;
  receipt_number: string;
  total: string;
  paid_total: string;
  change_total: string;
  status: string;
}

export async function salesForDevice(token: string, deviceId: string): Promise<{ total: number; items: SaleSummary[] }> {
  return call(`/sales?device_id=${deviceId}&limit=200`, { token });
}

export async function saleDetail(token: string, saleId: string): Promise<{ payments: { method_kind: string; amount: string }[] }> {
  return call(`/sales/${saleId}`, { token });
}

export async function balances(token: string): Promise<{ items: { variant_id: string; quantity: string }[] }> {
  return call("/inventory/balances?limit=500", { token });
}

export async function reviewFlags(token: string): Promise<{ items: { flag_type: string; entity_id: string }[] }> {
  return call("/review-flags?limit=200", { token });
}
