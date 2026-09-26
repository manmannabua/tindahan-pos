"""User and role management.

Privilege-escalation rule: a user may only grant permissions they hold themselves (in the same
scope). This is what stops a manager with `users.manage` from making themselves an owner.
"""

import uuid
from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import hash_secret, make_offline_pin_verifier
from app.modules.audit import service as audit
from app.modules.audit.service import AuditActor
from app.modules.auth.models import RefreshToken
from app.modules.auth.principal import Principal
from app.modules.branches.models import Branch
from app.modules.users.models import Role, RolePermission, User, UserRole
from app.modules.users.permissions import P
from app.modules.users.repository import (
    get_role_with_permissions,
    get_user_by_email,
    get_user_by_username,
    get_user_with_roles,
)
from app.modules.users.schemas import (
    RoleAssignment,
    RoleCreate,
    RoleUpdate,
    UserCreate,
    UserUpdate,
)
from app.shared.exceptions import (
    BusinessRuleError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
)

# PINs that are too easy to guess are refused.
_WEAK_PINS = {"0000", "1111", "1234", "000000", "111111", "123456", "654321", "123123", "12345678"}


# --- Users -------------------------------------------------------------------------------


async def list_users(
    db: AsyncSession,
    principal: Principal,
    *,
    q: str | None,
    include_inactive: bool,
    limit: int,
    offset: int,
) -> tuple[list[User], int]:
    stmt = select(User).where(User.company_id == principal.company_id)
    if not include_inactive:
        stmt = stmt.where(User.is_active.is_(True))
    if q:
        pattern = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(User.full_name).like(pattern),
                func.lower(User.email).like(pattern),
                User.username.like(pattern),
            )
        )
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    users = await db.scalars(
        stmt.options(selectinload(User.role_assignments).selectinload(UserRole.role))
        .order_by(User.full_name)
        .limit(limit)
        .offset(offset)
    )
    return list(users), total


async def get_user(db: AsyncSession, principal: Principal, user_id: uuid.UUID) -> User:
    user = await get_user_with_roles(db, principal.company_id, user_id)
    if user is None:
        raise NotFoundError("User not found", code="user.not_found")
    return user


async def create_user(
    db: AsyncSession, principal: Principal, data: UserCreate, actor: AuditActor
) -> User:
    principal.require(P.USERS_MANAGE)
    if await get_user_by_email(db, data.email):
        raise ConflictError("Email already registered", code="user.email_taken")
    if await get_user_by_username(db, principal.company_id, data.username):
        raise ConflictError("Username already taken", code="user.username_taken")
    await _validate_assignments(db, principal, data.roles)

    user = User(
        company_id=principal.company_id,
        email=str(data.email).lower(),
        username=data.username,
        full_name=data.full_name,
        password_hash=hash_secret(data.password),
    )
    if data.pin:
        set_pin_credentials(user, data.pin)
    user.role_assignments = [
        UserRole(role_id=a.role_id, branch_id=a.branch_id) for a in _dedupe(data.roles)
    ]
    db.add(user)
    await db.flush()
    audit.record(
        db,
        actor,
        "user.created",
        entity_type="user",
        entity_id=user.id,
        metadata={
            "username": user.username,
            "roles": [a.model_dump(mode="json") for a in data.roles],
        },
    )
    await db.commit()
    return await get_user(db, principal, user.id)


async def update_user(
    db: AsyncSession,
    principal: Principal,
    user_id: uuid.UUID,
    data: UserUpdate,
    actor: AuditActor,
) -> User:
    principal.require(P.USERS_MANAGE)
    user = await get_user(db, principal, user_id)
    values = data.model_dump(exclude_unset=True)
    if values.get("is_active") is False:
        if user.id == principal.user_id:
            raise BusinessRuleError("You cannot deactivate yourself", code="user.self_deactivate")
        await _revoke_all_refresh_tokens(db, user.id)
    if values.get("email") and values["email"].lower() != user.email:
        if await get_user_by_email(db, values["email"]):
            raise ConflictError("Email already registered", code="user.email_taken")
        values["email"] = values["email"].lower()

    before = {k: getattr(user, k) for k in values}
    for key, value in values.items():
        if value is not None:
            setattr(user, key, value)
    audit.record(
        db,
        actor,
        "user.updated",
        entity_type="user",
        entity_id=user.id,
        changes=audit.diff(before, values),
    )
    await db.commit()
    return await get_user(db, principal, user.id)


async def set_roles(
    db: AsyncSession,
    principal: Principal,
    user_id: uuid.UUID,
    assignments: list[RoleAssignment],
    actor: AuditActor,
) -> User:
    principal.require(P.USERS_MANAGE)
    if user_id == principal.user_id:
        raise BusinessRuleError("You cannot change your own roles", code="user.self_roles")
    user = await get_user(db, principal, user_id)
    # Removing roles is also a privilege operation: you may not strip someone of permissions
    # you don't hold yourself (e.g. a manager demoting the owner).
    await _validate_assignments(
        db,
        principal,
        [RoleAssignment(role_id=a.role_id, branch_id=a.branch_id) for a in user.role_assignments],
    )
    await _validate_assignments(db, principal, assignments)
    old = [{"role": a.role.code, "branch_id": str(a.branch_id)} for a in user.role_assignments]
    await db.execute(delete(UserRole).where(UserRole.user_id == user.id))
    for a in _dedupe(assignments):
        db.add(UserRole(user_id=user.id, role_id=a.role_id, branch_id=a.branch_id))
    audit.record(
        db,
        actor,
        "user.roles_changed",
        entity_type="user",
        entity_id=user.id,
        changes={"roles": [old, [a.model_dump(mode="json") for a in assignments]]},
    )
    await db.commit()
    db.expire(user)
    return await get_user(db, principal, user_id)


async def set_user_pin(
    db: AsyncSession, principal: Principal, user_id: uuid.UUID, pin: str, actor: AuditActor
) -> None:
    if user_id != principal.user_id:
        principal.require(P.USERS_MANAGE)
    user = await get_user(db, principal, user_id)
    set_pin_credentials(user, pin)
    audit.record(db, actor, "user.pin_changed", entity_type="user", entity_id=user.id)
    await db.commit()


async def reset_password(
    db: AsyncSession, principal: Principal, user_id: uuid.UUID, password: str, actor: AuditActor
) -> None:
    principal.require(P.USERS_MANAGE)
    user = await get_user(db, principal, user_id)
    user.password_hash = hash_secret(password)
    await _revoke_all_refresh_tokens(db, user.id)
    audit.record(db, actor, "user.password_reset", entity_type="user", entity_id=user.id)
    await db.commit()


def set_pin_credentials(user: User, pin: str) -> None:
    if pin in _WEAK_PINS or len(set(pin)) == 1:
        raise BusinessRuleError("This PIN is too easy to guess", code="user.weak_pin")
    verifier = make_offline_pin_verifier(pin)
    user.pin_hash = hash_secret(pin)
    user.pin_offline_salt = verifier.salt
    user.pin_offline_verifier = verifier.verifier
    user.pin_offline_iterations = verifier.iterations
    user.pin_updated_at = datetime.now(UTC)


async def _revoke_all_refresh_tokens(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )


def _dedupe(assignments: Iterable[RoleAssignment]) -> list[RoleAssignment]:
    seen: dict[tuple[uuid.UUID, uuid.UUID | None], RoleAssignment] = {}
    for a in assignments:
        seen.setdefault((a.role_id, a.branch_id), a)
    return list(seen.values())


async def _validate_assignments(
    db: AsyncSession, principal: Principal, assignments: Iterable[RoleAssignment]
) -> None:
    assignments = list(assignments)
    role_ids = {a.role_id for a in assignments}
    roles = {
        r.id: r
        for r in await db.scalars(
            select(Role)
            .where(Role.company_id == principal.company_id, Role.id.in_(role_ids))
            .options(selectinload(Role.permissions))
        )
    }
    branch_ids = {a.branch_id for a in assignments if a.branch_id}
    if branch_ids:
        found = set(
            await db.scalars(
                select(Branch.id).where(
                    Branch.company_id == principal.company_id, Branch.id.in_(branch_ids)
                )
            )
        )
        if missing := branch_ids - found:
            raise NotFoundError(
                "Branch not found", details={"branch_ids": [str(b) for b in missing]}
            )
    for a in assignments:
        role = roles.get(a.role_id)
        if role is None:
            raise NotFoundError("Role not found", code="role.not_found")
        _ensure_can_grant(principal, [rp.permission for rp in role.permissions], a.branch_id)


def _ensure_can_grant(
    principal: Principal, permissions: Iterable[str], branch_id: uuid.UUID | None
) -> None:
    missing = sorted(p for p in permissions if not principal.has(P(p), branch_id))
    if missing:
        raise PermissionDeniedError(
            "You cannot grant permissions you do not hold",
            code="role.escalation",
            details={"missing": missing},
        )


# --- Roles -------------------------------------------------------------------------------


async def list_roles(db: AsyncSession, principal: Principal) -> list[Role]:
    return list(
        await db.scalars(
            select(Role)
            .where(Role.company_id == principal.company_id)
            .options(selectinload(Role.permissions))
            .order_by(Role.is_system.desc(), Role.name)
        )
    )


async def create_role(
    db: AsyncSession, principal: Principal, data: RoleCreate, actor: AuditActor
) -> Role:
    principal.require(P.ROLES_MANAGE)
    _ensure_can_grant(principal, data.permissions, None)
    exists = await db.scalar(
        select(Role.id).where(Role.company_id == principal.company_id, Role.code == data.code)
    )
    if exists:
        raise ConflictError("Role code already exists", code="role.code_taken")
    role = Role(
        company_id=principal.company_id,
        code=data.code,
        name=data.name,
        description=data.description,
        permissions=[RolePermission(permission=p.value) for p in data.permissions],
    )
    db.add(role)
    await db.flush()
    audit.record(
        db,
        actor,
        "role.created",
        entity_type="role",
        entity_id=role.id,
        metadata={"code": role.code, "permissions": [p.value for p in data.permissions]},
    )
    await db.commit()
    return await _get_role(db, principal, role.id)


async def update_role(
    db: AsyncSession, principal: Principal, role_id: uuid.UUID, data: RoleUpdate, actor: AuditActor
) -> Role:
    principal.require(P.ROLES_MANAGE)
    role = await _get_role(db, principal, role_id)
    if role.code == "OWNER":
        raise BusinessRuleError("The Owner role cannot be modified", code="role.owner_immutable")
    changes: dict[str, object] = {}
    if data.name is not None:
        changes["name"] = [role.name, data.name]
        role.name = data.name
    if data.description is not None:
        changes["description"] = [role.description, data.description]
        role.description = data.description
    if data.permissions is not None:
        old = {rp.permission for rp in role.permissions}
        new = {p.value for p in data.permissions}
        # Both added and removed permissions must be within the editor's own permissions.
        _ensure_can_grant(principal, old ^ new, None)
        role.permissions = [RolePermission(permission=p) for p in sorted(new)]
        changes["permissions"] = [sorted(old), sorted(new)]
    audit.record(db, actor, "role.updated", entity_type="role", entity_id=role.id, changes=changes)
    await db.commit()
    db.expire(role)
    return await _get_role(db, principal, role_id)


async def delete_role(
    db: AsyncSession, principal: Principal, role_id: uuid.UUID, actor: AuditActor
) -> None:
    principal.require(P.ROLES_MANAGE)
    role = await _get_role(db, principal, role_id)
    if role.is_system:
        raise BusinessRuleError("System roles cannot be deleted", code="role.system")
    if await db.scalar(select(UserRole.id).where(UserRole.role_id == role.id).limit(1)):
        raise BusinessRuleError("Role is still assigned to users", code="role.in_use")
    await db.delete(role)
    audit.record(
        db,
        actor,
        "role.deleted",
        entity_type="role",
        entity_id=role.id,
        metadata={"code": role.code},
    )
    await db.commit()


async def _get_role(db: AsyncSession, principal: Principal, role_id: uuid.UUID) -> Role:
    role = await get_role_with_permissions(db, principal.company_id, role_id)
    if role is None:
        raise NotFoundError("Role not found", code="role.not_found")
    return role
