/**
 * Human-readable explanations of server error codes shown in the POS sync view. The raw code
 * stays visible next to the text for support.
 */
const MESSAGES: Record<string, string> = {
  "sale.session_closed": "The shift of this sale was already closed on the server. Process a return instead of a void.",
  "sale.already_voided": "This sale was already voided.",
  "sale.has_returns": "Items of this sale were returned, so it can no longer be voided.",
  "return.over_return": "More items were returned than are left on the original sale.",
  "return.refund_mismatch": "The refund amounts do not add up to the refund total.",
  "return.sale_not_completed": "The original sale is voided and cannot be returned.",
  "return.unknown_item": "An item on this return is not part of the original sale.",
  "sync.payload_mismatch": "This record was already synced with different content. A manager must review it.",
  "sync.unknown_variant": "A product on this record no longer exists on the server.",
  "sync.unknown_user": "A cashier or approver on this record is unknown to the server.",
  "sync.unknown_payment_method": "A payment method on this record is unknown to the server.",
  "sync.unknown_promotion": "A promotion on this record is unknown to the server.",
  "sync.foreign_sale": "This sale belongs to another terminal and can't be changed here.",
  "sync.invalid_payload": "The record is malformed. Contact support.",
  "sync.cash_session_missing": "Waiting for the cash session to reach the server (retried automatically).",
  "sync.customer_missing": "Waiting for the customer to reach the server (retried automatically).",
  "sync.sale_missing": "Waiting for the original sale to reach the server (retried automatically).",
  "sync.cash_session_closed": "The cash session was already closed on the server.",
};

export function describeSyncError(error: { code: string; message: string }): string {
  return MESSAGES[error.code] ?? error.message;
}
