"use client";

import { liveQuery } from "dexie";
import { type DependencyList, useEffect, useState } from "react";

/**
 * Subscribe to a Dexie query; re-renders whenever the tables it read change (in any tab).
 * Returns `initial` until the first result arrives.
 */
export function useLiveQuery<T>(query: () => Promise<T>, deps: DependencyList, initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: setValue,
      error: (error: unknown) => console.error("liveQuery failed", error),
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller supplies deps
  }, deps);
  return value;
}
