"""Customers. Terminals may create customers offline (`customer.upsert` sync operation)."""

import re
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.customers.models import Customer
from app.modules.customers.schemas import CustomerCreate, CustomerUpdate
from app.modules.pricing.models import PriceLevel
from app.modules.review_flags.models import FlagType
from app.modules.review_flags.service import raise_flag
from app.modules.users.permissions import P
from app.shared import crud

LABEL = "customer"
_NULLABLE = {"code", "phone", "email", "address", "tin", "price_level_id", "credit_limit", "notes"}


def normalize_phone(phone: str | None) -> str | None:
    """Keep digits (and a leading +) so '0917 123 4567' and '09171234567' match."""
    if not phone:
        return None
    digits = re.sub(r"[^\d+]", "", phone.strip())
    return digits or None


async def list_customers(
    db: AsyncSession,
    company_id: uuid.UUID,
    *,
    q: str | None,
    include_inactive: bool,
    limit: int,
    offset: int,
) -> tuple[list[Customer], int]:
    stmt = select(Customer).where(Customer.company_id == company_id)
    if not include_inactive:
        stmt = stmt.where(Customer.is_active.is_(True))
    if q:
        pattern = f"%{q}%"
        phone = normalize_phone(q)
        clauses = [
            Customer.name.ilike(pattern),
            Customer.code.ilike(pattern),
            Customer.email.ilike(pattern),
        ]
        if phone:
            clauses.append(Customer.phone.like(f"%{phone}%"))
        stmt = stmt.where(or_(*clauses))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await db.scalars(stmt.order_by(Customer.name).limit(limit).offset(offset))
    return list(rows), total


async def _check_price_level(
    db: AsyncSession, company_id: uuid.UUID, level_id: uuid.UUID | None
) -> None:
    if level_id:
        await crud.get_scoped(db, PriceLevel, company_id, level_id, "price_level")


async def flag_duplicate_phone(db: AsyncSession, customer: Customer) -> None:
    if not customer.phone:
        return
    other = await db.scalar(
        select(Customer.id).where(
            Customer.company_id == customer.company_id,
            Customer.phone == customer.phone,
            Customer.id != customer.id,
            Customer.is_active.is_(True),
        )
    )
    if other:
        await raise_flag(
            db,
            company_id=customer.company_id,
            flag_type=FlagType.DUPLICATE_CUSTOMER,
            entity_type="customer",
            entity_id=customer.id,
            details={"phone": customer.phone, "duplicates": [str(other)]},
        )


async def create_customer(
    db: AsyncSession, principal: Principal, data: CustomerCreate, actor: AuditActor
) -> Customer:
    if not principal.has_in_any_scope(P.CUSTOMERS_WRITE):
        principal.require(P.CUSTOMERS_WRITE)
    await _check_price_level(db, principal.company_id, data.price_level_id)
    values = data.model_dump(exclude_none=True)
    values["phone"] = normalize_phone(data.phone)
    customer = Customer(company_id=principal.company_id, **values)
    db.add(customer)
    await db.flush()
    await flag_duplicate_phone(db, customer)
    return await crud.create_entity(db, customer, actor, LABEL)


async def update_customer(
    db: AsyncSession,
    principal: Principal,
    customer_id: uuid.UUID,
    data: CustomerUpdate,
    actor: AuditActor,
) -> Customer:
    if not principal.has_in_any_scope(P.CUSTOMERS_WRITE):
        principal.require(P.CUSTOMERS_WRITE)
    customer = await crud.get_scoped(db, Customer, principal.company_id, customer_id, LABEL)
    values = data.model_dump(exclude_unset=True)
    if "phone" in values:
        values["phone"] = normalize_phone(values["phone"])
    if values.get("price_level_id"):
        await _check_price_level(db, principal.company_id, values["price_level_id"])
    return await crud.update_entity(db, customer, values, actor, LABEL, nullable=_NULLABLE)
