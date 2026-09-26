import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    require_permission,
)
from app.modules.users import service
from app.modules.users.models import Role, User
from app.modules.users.permissions import PERMISSION_DESCRIPTIONS, P
from app.modules.users.schemas import (
    PermissionRead,
    ResetPasswordRequest,
    RoleAssignmentRead,
    RoleCreate,
    RoleRead,
    RoleUpdate,
    SetPinRequest,
    SetRolesRequest,
    UserCreate,
    UserRead,
    UserUpdate,
)
from app.shared.schemas import Page

router = APIRouter(tags=["users"])

_manage_users = [Depends(require_permission(P.USERS_MANAGE))]
_manage_roles = [Depends(require_permission(P.ROLES_MANAGE))]


def to_user_read(user: User) -> UserRead:
    return UserRead(
        id=user.id,
        email=user.email,
        username=user.username,
        full_name=user.full_name,
        is_active=user.is_active,
        has_pin=user.pin_hash is not None,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
        roles=[
            RoleAssignmentRead(
                role_id=a.role_id,
                role_code=a.role.code,
                role_name=a.role.name,
                branch_id=a.branch_id,
            )
            for a in user.role_assignments
        ],
    )


def to_role_read(role: Role) -> RoleRead:
    return RoleRead(
        id=role.id,
        code=role.code,
        name=role.name,
        description=role.description,
        is_system=role.is_system,
        permissions=sorted(rp.permission for rp in role.permissions),
    )


@router.get("/users", response_model=Page[UserRead], dependencies=_manage_users)
async def list_users(
    principal: CurrentPrincipal,
    db: DbSession,
    q: Annotated[str | None, Query(max_length=100)] = None,
    include_inactive: bool = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[UserRead]:
    users, total = await service.list_users(
        db, principal, q=q, include_inactive=include_inactive, limit=limit, offset=offset
    )
    return Page(items=[to_user_read(u) for u in users], total=total, limit=limit, offset=offset)


@router.post(
    "/users",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=_manage_users,
)
async def create_user(
    data: UserCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> UserRead:
    user = await service.create_user(db, principal, data, audit_actor(principal, request))
    return to_user_read(user)


@router.get("/users/{user_id}", response_model=UserRead, dependencies=_manage_users)
async def get_user(user_id: uuid.UUID, principal: CurrentPrincipal, db: DbSession) -> UserRead:
    return to_user_read(await service.get_user(db, principal, user_id))


@router.patch("/users/{user_id}", response_model=UserRead, dependencies=_manage_users)
async def update_user(
    user_id: uuid.UUID,
    data: UserUpdate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> UserRead:
    user = await service.update_user(db, principal, user_id, data, audit_actor(principal, request))
    return to_user_read(user)


@router.put("/users/{user_id}/roles", response_model=UserRead, dependencies=_manage_users)
async def set_user_roles(
    user_id: uuid.UUID,
    data: SetRolesRequest,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> UserRead:
    user = await service.set_roles(
        db, principal, user_id, data.roles, audit_actor(principal, request)
    )
    return to_user_read(user)


@router.put(
    "/users/{user_id}/pin", status_code=status.HTTP_204_NO_CONTENT, dependencies=_manage_users
)
async def set_user_pin(
    user_id: uuid.UUID,
    data: SetPinRequest,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> None:
    await service.set_user_pin(db, principal, user_id, data.pin, audit_actor(principal, request))


@router.put(
    "/users/{user_id}/password",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=_manage_users,
)
async def reset_user_password(
    user_id: uuid.UUID,
    data: ResetPasswordRequest,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> None:
    await service.reset_password(
        db, principal, user_id, data.password, audit_actor(principal, request)
    )


@router.get("/permissions", response_model=list[PermissionRead])
async def list_permissions(principal: CurrentPrincipal) -> list[PermissionRead]:
    return [PermissionRead(code=p.value, description=PERMISSION_DESCRIPTIONS[p]) for p in P]


@router.get("/roles", response_model=list[RoleRead])
async def list_roles(principal: CurrentPrincipal, db: DbSession) -> list[RoleRead]:
    return [to_role_read(r) for r in await service.list_roles(db, principal)]


@router.post(
    "/roles",
    response_model=RoleRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=_manage_roles,
)
async def create_role(
    data: RoleCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> RoleRead:
    return to_role_read(
        await service.create_role(db, principal, data, audit_actor(principal, request))
    )


@router.patch("/roles/{role_id}", response_model=RoleRead, dependencies=_manage_roles)
async def update_role(
    role_id: uuid.UUID,
    data: RoleUpdate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> RoleRead:
    return to_role_read(
        await service.update_role(db, principal, role_id, data, audit_actor(principal, request))
    )


@router.delete(
    "/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=_manage_roles
)
async def delete_role(
    role_id: uuid.UUID, principal: CurrentPrincipal, request: Request, db: DbSession
) -> None:
    await service.delete_role(db, principal, role_id, audit_actor(principal, request))
