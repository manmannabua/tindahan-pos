"use client";

import { useCallback, useEffect, useState } from "react";

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Detect a new service worker waiting to take over (a deployed update). The POS never swaps code
 * mid-sale: the caller applies the update only when the cart is empty.
 */
export function useServiceWorkerUpdate(): { available: boolean; apply: () => void } {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let registration: ServiceWorkerRegistration | undefined;
    let timer: number | undefined;
    const sw = navigator.serviceWorker;

    const track = (reg: ServiceWorkerRegistration) => {
      // An update only matters if a worker already controls this page.
      if (reg.waiting && sw.controller) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed" && sw.controller) setWaiting(reg.waiting ?? installing);
        });
      });
    };

    void sw.getRegistration().then((reg) => {
      if (!reg) return;
      registration = reg;
      track(reg);
      timer = window.setInterval(() => void registration?.update().catch(() => undefined), CHECK_INTERVAL_MS);
    });
    return () => window.clearInterval(timer);
  }, []);

  const apply = useCallback(() => {
    if (!waiting) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, [waiting]);

  return { available: waiting !== null, apply };
}
