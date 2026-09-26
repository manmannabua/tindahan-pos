import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";

import { StoreCatalog } from "@/features/storefront/components/store-catalog";
import { parseCatalogQuery, productsPath, storePath } from "@/features/storefront/public-api";
import type { PublicProductPage, PublicStore } from "@/types/api-public";

/** FastAPI origin as seen from the Next.js server (docker: http://api:8000). */
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:8000";

/**
 * Server-side GET of a public endpoint. Always fresh (stock is live; the API caches briefly).
 * The shopper's IP (set by Nginx as X-Real-IP) is passed on so the API's per-visitor rate limit
 * applies to them rather than to this server.
 */
async function serverGet<T>(path: string): Promise<T | null> {
  const realIp = (await headers()).get("x-real-ip");
  const response = await fetch(`${API_ORIGIN}${path}`, {
    cache: "no-store",
    headers: { Accept: "application/json", ...(realIp ? { "X-Forwarded-For": realIp } : {}) },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
  return (await response.json()) as T;
}

// Shared by generateMetadata and the page within one request.
const getStore = cache((slug: string) => serverGet<PublicStore>(storePath(slug)));

export async function generateMetadata(props: PageProps<"/s/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const store = await getStore(slug);
  if (!store) return { title: { absolute: "Store not found" }, robots: { index: false, follow: false } };
  const description = store.about ?? `See what ${store.name} sells and what's in stock today.`;
  return {
    title: { absolute: `${store.name} · Products and stock` },
    description,
    // Owners opt in to search engines; by default only people with the link/QR find it.
    robots: store.allow_indexing ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title: store.name, description, type: "website" },
  };
}

export default async function StorePage(props: PageProps<"/s/[slug]">) {
  const { slug } = await props.params;
  const store = await getStore(slug);
  if (!store) notFound();

  const query = parseCatalogQuery(await props.searchParams);
  // A branch or category from an old link may no longer be listed: fall back to defaults.
  if (query.branch && !store.branches.some((b) => b.id === query.branch)) query.branch = null;
  const page = await serverGet<PublicProductPage>(productsPath(slug, query));
  if (!page) notFound();

  return <StoreCatalog slug={store.slug} store={store} initialQuery={query} initialPage={page} />;
}
