"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  Barcode,
  BarcodeLookup,
  Brand,
  Category,
  CategoryCreate,
  CategoryUpdate,
  Paged,
  PaymentMethod,
  Price,
  PriceIn,
  PriceLevel,
  Product,
  ProductCreate,
  ProductSummary,
  ProductUpdate,
  TaxRate,
  Unit,
  VariantIn,
  VariantUpdate,
} from "@/types/api-admin";

// --- Reference data ----------------------------------------------------------------------------

/** Simple company reference lists sharing one CRUD shape. */
export type ReferenceKind = "brands" | "units" | "tax-rates" | "price-levels" | "payment-methods";

export interface ReferenceRowMap {
  brands: Brand;
  units: Unit;
  "tax-rates": TaxRate;
  "price-levels": PriceLevel;
  "payment-methods": PaymentMethod;
}

export const catalogKeys = {
  all: ["catalog"] as const,
  reference: (kind: ReferenceKind | "categories") => [...catalogKeys.all, kind] as const,
  products: ["products"] as const,
  productList: (params: ProductListParams) => [...catalogKeys.products, "list", params] as const,
  product: (id: string) => [...catalogKeys.products, "detail", id] as const,
};

/** Endpoints that accept `include_inactive` (the others always return everything). */
const WITH_INACTIVE = new Set<ReferenceKind | "categories">(["brands", "units", "categories"]);

export function useReference<K extends ReferenceKind>(kind: K) {
  return useQuery({
    queryKey: catalogKeys.reference(kind),
    queryFn: ({ signal }) =>
      api.get<ReferenceRowMap[K][]>(`/${kind}`, WITH_INACTIVE.has(kind) ? { include_inactive: true } : undefined, signal),
    staleTime: 60_000,
  });
}

export function useSaveReference(kind: ReferenceKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: Record<string, unknown> }) =>
      id ? api.patch<unknown>(`/${kind}/${id}`, data) : api.post<unknown>(`/${kind}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.reference(kind) }),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: catalogKeys.reference("categories"),
    queryFn: ({ signal }) => api.get<Category[]>("/categories", { include_inactive: true }, signal),
    staleTime: 60_000,
  });
}

export function useSaveCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: CategoryCreate | CategoryUpdate }) =>
      id ? api.patch<Category>(`/categories/${id}`, data) : api.post<Category>("/categories", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.reference("categories") }),
  });
}

/** id → label lookups for tables. */
export function useLabels<K extends ReferenceKind>(kind: K, label: (row: ReferenceRowMap[K]) => string) {
  const { data } = useReference(kind);
  return Object.fromEntries((data ?? []).map((row) => [row.id, label(row)])) as Record<string, string>;
}

// --- Products ------------------------------------------------------------------------------------

export interface ProductListParams {
  q?: string;
  category_id?: string;
  brand_id?: string;
  include_inactive?: boolean;
  /** true = only products shown online, false = only hidden ones. */
  online?: boolean;
  limit: number;
  offset: number;
}

export function useProducts(params: ProductListParams) {
  return useQuery({
    queryKey: catalogKeys.productList(params),
    queryFn: ({ signal }) => api.get<Paged<ProductSummary>>("/products", { ...params }, signal),
    placeholderData: (previous) => previous,
  });
}

export function useProduct(id: string | null) {
  return useQuery({
    queryKey: catalogKeys.product(id ?? ""),
    queryFn: ({ signal }) => api.get<Product>(`/products/${id}`, undefined, signal),
    enabled: Boolean(id),
  });
}

/** Mutations that return the full product update its cache entry and refresh the lists. */
function useProductMutation<T>(fn: (input: T) => Promise<Product>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (product) => {
      queryClient.setQueryData(catalogKeys.product(product.id), product);
      return queryClient.invalidateQueries({ queryKey: [...catalogKeys.products, "list"] });
    },
  });
}

export function useCreateProduct() {
  return useProductMutation((data: ProductCreate) => api.post<Product>("/products", data));
}

export function useUpdateProduct(id: string) {
  return useProductMutation((data: ProductUpdate) => api.patch<Product>(`/products/${id}`, data));
}

/** Upload (or replace) the product photo; `photo` should already be resized (lib/images/resize). */
export function useSetProductImage(productId: string) {
  return useProductMutation((photo: Blob) => {
    const form = new FormData();
    const ext = photo.type === "image/webp" ? "webp" : photo.type === "image/png" ? "png" : "jpg";
    form.append("file", photo, `photo.${ext}`);
    return api.put<Product>(`/products/${productId}/image`, form);
  });
}

export function useRemoveProductImage(productId: string) {
  return useProductMutation<void>(() => api.delete<Product>(`/products/${productId}/image`));
}

export function useAddProductUnit(productId: string) {
  return useProductMutation((data: { unit_id: string; factor: string }) =>
    api.post<Product>(`/products/${productId}/units`, data),
  );
}

export function useUpdateProductUnit() {
  return useProductMutation(({ id, data }: { id: string; data: { factor?: string; is_active?: boolean } }) =>
    api.patch<Product>(`/product-units/${id}`, data),
  );
}

export function useAddVariant(productId: string) {
  return useProductMutation((data: VariantIn) => api.post<Product>(`/products/${productId}/variants`, data));
}

export function useUpdateVariant() {
  return useProductMutation(({ id, data }: { id: string; data: VariantUpdate }) =>
    api.patch<Product>(`/variants/${id}`, data),
  );
}

/** Barcode / price mutations return partial data; refetch the product afterwards. */
function useProductChildMutation<T, R>(productId: string, fn: (input: T) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: catalogKeys.product(productId) }),
        queryClient.invalidateQueries({ queryKey: [...catalogKeys.products, "list"] }),
      ]),
  });
}

export function useAddBarcode(productId: string) {
  return useProductChildMutation(productId, ({ variantId, code, unitId }: { variantId: string; code: string; unitId?: string | null }) =>
    api.post<Barcode>(`/variants/${variantId}/barcodes`, { code, unit_id: unitId ?? null }),
  );
}

export function useGenerateBarcode(productId: string) {
  return useProductChildMutation(productId, ({ variantId, unitId }: { variantId: string; unitId?: string | null }) =>
    api.post<Barcode>(`/variants/${variantId}/barcodes/generate`, { unit_id: unitId ?? null }),
  );
}

export function useUpdateBarcode(productId: string) {
  return useProductChildMutation(productId, ({ id, data }: { id: string; data: { is_active?: boolean; is_primary?: boolean } }) =>
    api.patch<Barcode>(`/barcodes/${id}`, data),
  );
}

export function useSetPrices(productId: string) {
  return useProductChildMutation(productId, ({ variantId, prices }: { variantId: string; prices: PriceIn[] }) =>
    api.put<Price[]>(`/variants/${variantId}/prices`, { prices }),
  );
}

export function lookupBarcode(code: string) {
  return api.get<BarcodeLookup>("/barcodes/lookup", { code });
}
