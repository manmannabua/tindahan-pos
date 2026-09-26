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
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES[error.code] ?? error.message;
  if (error instanceof NetworkError) return "Cannot reach the server. Check your connection.";
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
