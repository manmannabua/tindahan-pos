import { randomUUID } from "node:crypto";

import { createSerwistRoute } from "@serwist/turbopack";

/**
 * Builds and serves the service worker at /serwist/sw.js (Turbopack has no webpack plugin hook,
 * so Serwist bundles the worker in a static route handler at build time).
 */

// One revision per build: the POS shell HTML references hashed chunks, so it must be
// re-downloaded whenever the app is redeployed.
const revision = process.env.NEXT_PUBLIC_BUILD_ID ?? randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "app/sw.ts",
  // useNativeEsbuild: Serwist's default (native esbuild on Windows, esbuild-wasm elsewhere).
  // esbuild-wasm cannot resolve Windows drive paths ("working directory is not an absolute
  // path"), so forcing wasm breaks Windows builds.
  additionalPrecacheEntries: [
    { url: "/pos", revision },
    { url: "/pos/login", revision },
    { url: "/pos/setup", revision },
    { url: "/manifest.webmanifest", revision },
  ],
  // Admin pages are online-only; don't precache their HTML.
  globIgnores: ["**/*.map"],
});
