import type { ApiErrorBody } from "@/types/api";

/** An error response from the API, normalized from `{error: {code, message, details}}`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Non-JSON error (e.g. proxy 502 HTML page).
    }
    if (isApiErrorBody(body)) {
      const { code, message, details } = body.error;
      return new ApiError(response.status, code, message, details ?? {});
    }
    return new ApiError(response.status, `http_${response.status}`, response.statusText || "Request failed");
  }

  /** Field-level validation errors keyed by the last `loc` segment. */
  get fieldErrors(): Record<string, string> {
    const errors = this.details.errors;
    if (!Array.isArray(errors)) return {};
    const result: Record<string, string> = {};
    for (const e of errors) {
      if (e && typeof e === "object" && "loc" in e && "msg" in e && Array.isArray(e.loc)) {
        const field = String(e.loc[e.loc.length - 1]);
        result[field] ??= String(e.msg);
      }
    }
    return result;
  }
}

/** A network failure (server unreachable, CORS, timeout) — distinct from an HTTP error. */
export class NetworkError extends Error {
  constructor(message = "Cannot reach the server", options?: ErrorOptions) {
    super(message, options);
    this.name = "NetworkError";
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiErrorBody).error?.code === "string"
  );
}

/** Friendlier messages for codes the user is likely to see. Falls back to the server message. */
const MESSAGES: Record<string, string> = {
  "auth.invalid_credentials": "Incorrect email or password.",
  "auth.account_disabled": "This account is disabled. Contact your administrator.",
  "permission_denied": "You don't have permission to do that.",
  "role.escalation": "You can't grant permissions you don't have yourself.",
  "rate_limited": "Too many attempts. Please wait a moment and try again.",
  "company.code_taken": "That company code is already in use.",
  "user.email_taken": "That email is already registered.",
  "user.username_taken": "That username is already taken.",
  "user.weak_pin": "That PIN is too easy to guess. Choose another.",
  "user.self_deactivate": "You can't deactivate your own account.",
  "user.self_roles": "You can't change your own roles.",
  "branch.code_taken": "That branch code is already in use.",
  "location.code_taken": "That location code is already used in this branch.",
  "location.default_required": "A branch must always have a default location.",
  "role.code_taken": "That role code already exists.",
  "role.in_use": "This role is still assigned to users.",
  "role.system": "System roles can't be deleted.",
  "role.owner_immutable": "The Owner role can't be modified.",
  "validation_error": "Please check the highlighted fields.",
  // Sessions and terminals
  "auth.missing_token": "Your session has ended. Please sign in again.",
  "auth.invalid_token": "Your session has ended. Please sign in again.",
  "auth.no_session": "Your session has ended. Please sign in again.",
  "auth.refresh_expired": "Your session has ended. Please sign in again.",
  "auth.refresh_reused": "For your security you were signed out. Please sign in again.",
  "auth.refresh_race": "Your session was just renewed in another tab. Please try again.",
  "auth.csrf": "Please reload the page and try again.",
  "auth.device_revoked": "This terminal was removed by the owner. Set it up again to use it.",
  "auth.device_unknown": "This terminal isn't registered. Set it up again.",
  "auth.no_pos_access": "You can't use the POS in this branch. Ask the owner for access.",
  "device.challenge_invalid": "The terminal couldn't confirm its identity. Please try again.",
  "device.bad_signature": "The terminal couldn't confirm its identity. If this keeps happening, set it up again.",
  "sync.branch_not_configured": "This branch has no default stock location. Add one under Branches.",
  "sync.invalid_cursor": "The terminal's download position is out of date. Run a full sync again.",
  "pagination.invalid_cursor": "The list changed while loading. Refresh and try again.",
  // Setup and data entry
  "company.invalid_timezone": "Choose a time zone from the list.",
  "price_level.no_default": "Set a default price level in Catalog setup first.",
  "tax_rate.no_default": "Set a default tax rate in Catalog setup first.",
  "inventory.item_required": "Choose an item or scan its barcode.",
  "goods_receipt.cost_required": "Enter the unit cost for every item.",
  "goods_receipt.variant_required": "Choose an item for every line.",
  "goods_receipt.supplier_required": "Choose a supplier.",
  "import.encoding": "Save the file as “CSV UTF-8” (Excel: File → Save As → CSV UTF-8) and upload it again.",
  "report.invalid_period": "The start date must be on or before the end date.",
  "report.device_required": "Choose a terminal for this report.",
  "review_flag.invalid_status": "Choose Resolved or Dismissed.",
  "storefront.bad_branch": "Choose active branches of this business.",
  "feature.unknown": "That feature isn't available. Reload the page and try again.",
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES[error.code] ?? error.message;
  if (error instanceof NetworkError) return "Cannot reach the server. Check your connection.";
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
