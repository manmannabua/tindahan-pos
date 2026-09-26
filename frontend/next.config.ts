import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/** FastAPI origin. The browser always calls same-origin `/api/*`; Next (dev) or Nginx (prod) proxies it. */
const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:8000";

/**
 * Content Security Policy without nonces: the POS shell is statically prerendered (so it can be
 * precached and opened offline), and nonces require per-request rendering. Next's inline
 * bootstrap scripts therefore need 'unsafe-inline'. No third-party origins are allowed.
 * See node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera is needed for camera barcode scanning (same origin only).
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Service worker updates must be picked up promptly.
      { source: "/serwist/:path*", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};

export default withSerwist(nextConfig);
