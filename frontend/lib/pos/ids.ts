import { v5 as uuidv5 } from "uuid";

/** Same namespace as backend app/shared/ids.py: `derived_id(source, purpose)`. */
export const POS_NAMESPACE = "6f1c8a52-3d4e-4b7a-9c1e-2a5b8d0f4e11";

/** Deterministic id derived from another id (idempotent retries produce the same record). */
export function derivedId(source: string, purpose: string): string {
  return uuidv5(`${source}:${purpose}`, POS_NAMESPACE);
}
