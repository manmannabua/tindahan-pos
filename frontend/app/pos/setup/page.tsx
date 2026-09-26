import type { Metadata } from "next";

import { SetupWizard } from "@/features/pos/components/setup-wizard";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Terminal setup" };

export default function PosSetupPage() {
  return <SetupWizard />;
}
