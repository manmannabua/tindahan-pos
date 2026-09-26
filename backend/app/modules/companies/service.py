"""Company (tenant) lifecycle."""

import uuid
from zoneinfo import available_timezones

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_secret
from app.modules.audit import service as audit
from app.modules.audit.service import AuditActor
from app.modules.branches.models import Branch, LocationType, StockLocation
from app.modules.companies.models import Company
from app.modules.companies.schemas import CompanyUpdate, SignupRequest
from app.modules.expenses import service as expenses_service
from app.modules.payments import service as payments_service
from app.modules.pricing import service as pricing_service
from app.modules.units.service import seed_default_units
from app.modules.users.models import Role, RolePermission, User, UserRole
from app.modules.users.permissions import DEFAULT_ROLES
from app.modules.users.repository import get_user_by_email
from app.shared.exceptions import BusinessRuleError, ConflictError, NotFoundError
from app.shared.patch import apply_patch


def _validate_timezone(tz: str) -> None:
    if tz not in available_timezones():
        raise BusinessRuleError(f"Unknown timezone '{tz}'", code="company.invalid_timezone")


async def signup(
    db: AsyncSession, data: SignupRequest, *, ip: str | None = None
) -> tuple[Company, User, Branch]:
    """Create a company with default roles, a main branch + location, and its owner."""
    _validate_timezone(data.timezone)
    if await db.scalar(select(Company.id).where(Company.code == data.company_code)):
        raise ConflictError("Company code already in use", code="company.code_taken")
    if await get_user_by_email(db, data.owner_email):
        raise ConflictError("Email already registered", code="user.email_taken")

    company = Company(
        code=data.company_code,
        name=data.company_name,
        timezone=data.timezone,
        currency=data.currency.upper(),
    )
    db.add(company)
    await db.flush()

    roles = seed_default_roles(db, company.id)
    seed_default_units(db, company.id)
    pricing_service.seed_defaults(db, company.id)
    payments_service.seed_defaults(db, company.id)
    expenses_service.seed_defaults(db, company.id)

    branch = Branch(company_id=company.id, code=data.branch_code, name=data.branch_name)
    db.add(branch)
    await db.flush()
    db.add(
        StockLocation(
            company_id=company.id,
            branch_id=branch.id,
            code="STORE",
            name=f"{data.branch_name} - Store",
            location_type=LocationType.STORE,
            is_default=True,
        )
    )

    owner = User(
        company_id=company.id,
        email=str(data.owner_email).lower(),
        username=data.owner_username,
        full_name=data.owner_full_name,
        password_hash=hash_secret(data.owner_password),
    )
    db.add(owner)
    await db.flush()
    db.add(UserRole(user_id=owner.id, role_id=roles["OWNER"].id, branch_id=None))

    audit.record(
        db,
        AuditActor(company_id=company.id, user_id=owner.id, ip_address=ip),
        "company.created",
        entity_type="company",
        entity_id=company.id,
        metadata={"code": company.code, "branch_code": branch.code},
    )
    await db.commit()
    return company, owner, branch


def seed_default_roles(db: AsyncSession, company_id: uuid.UUID) -> dict[str, Role]:
    roles: dict[str, Role] = {}
    for code, (name, description, permissions) in DEFAULT_ROLES.items():
        role = Role(
            company_id=company_id,
            code=code,
            name=name,
            description=description,
            is_system=True,
            permissions=[RolePermission(permission=p.value) for p in sorted(permissions)],
        )
        db.add(role)
        roles[code] = role
    return roles


async def get_company(db: AsyncSession, company_id: uuid.UUID) -> Company:
    company = await db.get(Company, company_id)
    if company is None:
        raise NotFoundError("Company not found")
    return company


async def update_company(
    db: AsyncSession, company_id: uuid.UUID, data: CompanyUpdate, actor: AuditActor
) -> Company:
    company = await get_company(db, company_id)
    changes = data.model_dump(exclude_unset=True)
    if "timezone" in changes and changes["timezone"] is not None:
        _validate_timezone(changes["timezone"])
    audit.record(
        db,
        actor,
        "company.updated",
        entity_type="company",
        entity_id=company.id,
        changes=apply_patch(company, changes, {"legal_name", "tin", "bir_accreditation_no"}),
    )
    await db.commit()
    await db.refresh(company)
    return company
