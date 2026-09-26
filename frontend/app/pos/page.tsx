import { PosApp } from "@/features/pos/components/pos-app";

// Prerendered at build time and precached by the service worker: the POS must open with no
// server (docs/ARCHITECTURE.md F2). Never read request data here; everything comes from IndexedDB.
export const dynamic = "force-static";

export default function PosPage() {
  return <PosApp />;
}
