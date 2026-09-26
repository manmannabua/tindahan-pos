/**
 * Public online catalog: query-string state and API access.
 *
 * Used by the server-rendered page and by the browser. Only anonymous `/api/v1/public/...`
 * endpoints are called here — never the authenticated admin API client.
 */
import { ApiError } from "@/lib/api/errors";

export const PUBLIC_PREFIX = "/api/v1/public/stores";
export const PAGE_SIZE = 24;
/** Stock refresh while the page is open and visible. */
export const REFRESH_MS = 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the shopper is looking at; mirrored in the page URL so links can be shared. */
export interface CatalogQuery {
  q: string;
  category: string | null;
  branch: string | null;
  inStock: boolean;
  page: number;
}

export const emptyQuery: CatalogQuery = { q: "", category: null, branch: null, inStock: false, page: 1 };

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Parse (and sanitise) the page's search params. Invalid values are dropped, never sent on. */
export function parseCatalogQuery(params: RawParams): CatalogQuery {
  const category = first(params.category);
  const branch = first(params.branch);
  const page = Number.parseInt(first(params.page) ?? "1", 10);
  return {
    q: (first(params.q) ?? "").slice(0, 60),
    category: category && UUID.test(category) ? category : null,
    branch: branch && UUID.test(branch) ? branch : null,
    inStock: first(params.stock) === "1",
    page: Number.isFinite(page) && page >= 1 && page <= 400 ? page : 1,
  };
}

/** The page URL's search string for a query (defaults omitted). */
export function catalogSearch(query: CatalogQuery): string {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set("q", query.q.trim());
  if (query.category) params.set("category", query.category);
  if (query.branch) params.set("branch", query.branch);
  if (query.inStock) params.set("stock", "1");
  if (query.page > 1) params.set("page", String(query.page));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function storePath(slug: string): string {
  return `${PUBLIC_PREFIX}/${encodeURIComponent(slug)}`;
}

/** API path for a page of products. */
export function productsPath(slug: string, query: CatalogQuery): string {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String((query.page - 1) * PAGE_SIZE),
  });
  if (query.q.trim()) params.set("q", query.q.trim());
  if (query.category) params.set("category_id", query.category);
  if (query.branch) params.set("branch_id", query.branch);
  if (query.inStock) params.set("in_stock", "true");
  return `${storePath(slug)}/products?${params.toString()}`;
}

export function productPath(slug: string, productId: string, branch: string | null): string {
  const qs = branch ? `?branch_id=${encodeURIComponent(branch)}` : "";
  return `${storePath(slug)}/products/${encodeURIComponent(productId)}${qs}`;
}

/** Browser-side GET of a public endpoint (same origin). */
export async function fetchPublic<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw await ApiError.fromResponse(response);
  return (await response.json()) as T;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
