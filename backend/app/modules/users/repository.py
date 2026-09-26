import uuid
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.users.models import Role, RolePermission, User, UserRole


async def load_permission_scopes(
    db: AsyncSession, user_id: uuid.UUID
) -> tuple[frozenset[str], dict[uuid.UUID, frozenset[str]]]:
    """Return (global permissions, per-branch permissions) for a user."""
    rows = await db.execute(
        select(UserRole.branch_id, RolePermission.permission)
        .join(RolePermission, RolePermission.role_id == UserRole.role_id)
        .where(UserRole.user_id == user_id)
    )
    global_perms: set[str] = set()
    per_branch: dict[uuid.UUID, set[str]] = defaultdict(set)
    for branch_id, permission in rows:
        if branch_id is None:
            global_perms.add(permission)
        else:
            per_branch[branch_id].add(permission)
    return frozenset(global_perms), {b: frozenset(p) for b, p in per_branch.items()}


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    return await db.scalar(select(User).where(func.lower(User.email) == email.lower()))


async def get_user_by_username(
    db: AsyncSession, company_id: uuid.UUID, username: str
) -> User | None:
    return await db.scalar(
        select(User).where(User.company_id == company_id, User.username == username)
    )


async def get_user_with_roles(
    db: AsyncSession, company_id: uuid.UUID, user_id: uuid.UUID
) -> User | None:
    return await db.scalar(
        select(User)
        .where(User.company_id == company_id, User.id == user_id)
        .options(selectinload(User.role_assignments).selectinload(UserRole.role))
    )


async def get_role_with_permissions(
    db: AsyncSession, company_id: uuid.UUID, role_id: uuid.UUID
) -> Role | None:
    return await db.scalar(
        select(Role)
        .where(Role.company_id == company_id, Role.id == role_id)
        .options(selectinload(Role.permissions))
    )
