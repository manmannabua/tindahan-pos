"""Domain exceptions.

Services raise these; `app.main` converts them to a consistent JSON error body:

    {"error": {"code": "...", "message": "...", "details": {...}}}

Route handlers never build error responses themselves.
"""

from typing import Any


class AppError(Exception):
    status_code: int = 400
    code: str = "error"

    def __init__(
        self, message: str, *, code: str | None = None, details: dict[str, Any] | None = None
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        self.details = details or {}


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


class FeatureDisabledError(AppError):
    """An optional feature the company has switched off (companies/features.py)."""

    status_code = 403
    code = "feature.disabled"


class ConflictError(AppError):
    status_code = 409
    code = "conflict"


class BusinessRuleError(AppError):
    status_code = 422
    code = "business_rule_violation"


class AuthenticationError(AppError):
    status_code = 401
    code = "authentication_failed"


class PermissionDeniedError(AppError):
    status_code = 403
    code = "permission_denied"


class RateLimitedError(AppError):
    status_code = 429
    code = "rate_limited"
