from typing import Any

from app.modules.audit.service import diff


def apply_patch(obj: object, values: dict[str, Any], nullable: set[str]) -> dict[str, Any]:
    """Apply a PATCH payload (`model_dump(exclude_unset=True)`) to an ORM object.

    `None` clears a field only if it is listed in `nullable`; otherwise `None` means "unchanged".
    Returns an audit diff of what actually changed.
    """
    applied = {k: v for k, v in values.items() if v is not None or k in nullable}
    before = {k: getattr(obj, k) for k in applied}
    for key, value in applied.items():
        setattr(obj, key, value)
    return diff(before, applied)
