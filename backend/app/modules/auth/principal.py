"""Authenticated identities.

`Principal` is a user (optionally acting on a registered device). `DevicePrincipal` is a POS
terminal acting on its own behalf (sync, PIN login). Both are immutable snapshots built once
per request.
"""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field

from app.modules.users.permissions import P
from app.shared.exceptions import PermissionDeniedError


@dataclass(frozen=True, slots=True)
class Principal:
    user_id: uuid.UUID
    company_id: uuid.UUID
    username: str
    device_id: uuid.UUID | None = None
    # Permissions granted company-wide (role assignment with branch_id NULL).
    global_permissions: frozenset[str] = frozenset()
    # Permissions granted only for specific branches.
    branch_permissions: Mapping[uuid.UUID, frozenset[str]] = field(default_factory=dict)

    def has(self, permission: P, branch_id: uuid.UUID | None = None) -> bool:
        """True if granted globally, or for `branch_id` when given."""
        if permission in self.global_permissions:
            return True
        if branch_id is not None:
            return permission in self.branch_permissions.get(branch_id, frozenset())
        return False

    def has_in_any_scope(self, permission: P) -> bool:
        return permission in self.global_permissions or any(
            permission in perms for perms in self.branch_permissions.values()
        )

    def require(self, permission: P, branch_id: uuid.UUID | None = None) -> None:
        if not self.has(permission, branch_id):
            raise PermissionDeniedError(
                "You do not have permission to perform this action.",
                details={"permission": permission.value},
            )

    def branch_scope(self, permission: P) -> set[uuid.UUID] | None:
        """Branches where `permission` applies. `None` means all branches."""
        if permission in self.global_permissions:
            return None
        return {b for b, perms in self.branch_permissions.items() if permission in perms}

    @property
    def all_permissions(self) -> frozenset[str]:
        merged = set(self.global_permissions)
        for perms in self.branch_permissions.values():
            merged |= perms
        return frozenset(merged)


@dataclass(frozen=True, slots=True)
class DevicePrincipal:
    device_id: uuid.UUID
    company_id: uuid.UUID
    branch_id: uuid.UUID
    terminal_code: str
