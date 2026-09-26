import { ToggleLeftIcon } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { FEATURE_LABELS, type FeatureKey } from "@/lib/features";

/** Shown instead of a page whose optional feature the owner has switched off. */
export function FeatureOff({ feature, canManage }: { feature: FeatureKey; canManage: boolean }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <ToggleLeftIcon className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">{FEATURE_LABELS[feature]} is turned off</h1>
      <p className="text-sm text-muted-foreground">
        This business doesn&apos;t use this feature right now. {canManage ? "You can turn it on in Settings → Features." : "Ask the owner to turn it on."}
      </p>
      {canManage && (
        <Link href="/settings/features" className={buttonVariants()}>
          Open Features
        </Link>
      )}
    </div>
  );
}
