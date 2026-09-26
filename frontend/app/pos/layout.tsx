import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PosShell } from "@/features/pos/components/pos-shell";

export const metadata: Metadata = { title: "Terminal" };

export default function PosLayout({ children }: { children: ReactNode }) {
  return <PosShell>{children}</PosShell>;
}
