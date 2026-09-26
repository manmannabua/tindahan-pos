import { toBig } from "@/lib/money";

export const PO_STATUSES = ["DRAFT", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"] as const;

export const PO_BADGE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  APPROVED: "default",
  PARTIALLY_RECEIVED: "default",
  RECEIVED: "secondary",
  CLOSED: "secondary",
  CANCELLED: "outline",
};

/** Quantity still to receive, expressed in the line's ordered unit (never negative). */
export function remainingInOrderedUnit(line: { base_quantity: string; received_base_quantity: string; unit_factor: string }): string {
  const remaining = toBig(line.base_quantity).minus(toBig(line.received_base_quantity));
  if (remaining.lte("0")) return "0";
  return remaining.div(toBig(line.unit_factor)).round(3, 1).toString();
}
