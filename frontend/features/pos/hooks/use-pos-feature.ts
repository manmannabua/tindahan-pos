"use client";

import { useLiveQuery } from "@/hooks/use-live-query";
import { getMeta } from "@/lib/db/meta";
import { getDb } from "@/lib/db/schema";
import { type FeatureKey, isFeatureOn } from "@/lib/features";
import { usePosSession } from "@/stores/pos-session-store";

/**
 * Is an optional feature on for this terminal's business? Read live from IndexedDB (the owner's
 * choice arrives with the next sync) with the context loaded at start-up as the first value, so
 * nothing flickers. Works offline: the last known state is used.
 */
export function usePosFeature(feature: FeatureKey): boolean {
  const initial = usePosSession((s) => s.context?.features);
  const live = useLiveQuery(() => getMeta(getDb(), "features"), [], undefined);
  return isFeatureOn(live ?? initial, feature);
}
