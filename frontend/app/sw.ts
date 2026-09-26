/// <reference lib="webworker" />
/**
 * Service worker (bundled by @serwist/turbopack via app/serwist/[path]/route.ts).
 *
 * Its only job is to make the APPLICATION available offline (docs/OFFLINE_ARCHITECTURE.md §2):
 * precache the app shell (JS/CSS chunks, fonts, icons, the static /pos pages). Business data is
 * synchronized explicitly into IndexedDB — API responses are NEVER cached here.
 */
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  type PrecacheEntry,
  Serwist,
  type SerwistGlobalConfig,
  StaleWhileRevalidate,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: { cleanupOutdatedCaches: true },
  // Never swap code under a cashier mid-sale: a new version waits until the UI asks for it
  // (SKIP_WAITING message below) or all POS tabs are closed.
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    {
      // API traffic always goes to the network. The sync engine owns offline data.
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: "next-static",
        plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 24 * 60 * 60 })],
      }),
    },
    {
      matcher: ({ request, sameOrigin }) =>
        sameOrigin && ["image", "font"].includes(request.destination),
      handler: new StaleWhileRevalidate({
        cacheName: "static-assets",
        plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 })],
      }),
    },
  ],
});

self.addEventListener("message", (event) => {
  if (event.data && typeof event.data === "object" && event.data.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

serwist.addEventListeners();
