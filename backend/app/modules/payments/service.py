import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.payments.models import DEFAULT_PAYMENT_METHODS, PaymentMethod
from app.modules.payments.schemas import PaymentMethodCreate, PaymentMethodUpdate
from app.modules.users.permissions import P
from app.shared import crud

LABEL = "payment_method"


def seed_defaults(db: AsyncSession, company_id: uuid.UUID) -> None:
    for i, (code, (name, kind, requires_reference, opens_drawer)) in enumerate(
        DEFAULT_PAYMENT_METHODS.items()
    ):
        db.add(
            PaymentMethod(
                company_id=company_id,
                code=code,
                name=name,
                kind=kind,
                requires_reference=requires_reference,
                opens_drawer=opens_drawer,
                sort_order=i,
            )
        )


async def list_methods(db: AsyncSession, company_id: uuid.UUID) -> list[PaymentMethod]:
    return list(
        await db.scalars(
            select(PaymentMethod)
            .where(PaymentMethod.company_id == company_id)
            .order_by(PaymentMethod.sort_order, PaymentMethod.code)
        )
    )


async def create_method(
    db: AsyncSession, principal: Principal, data: PaymentMethodCreate, actor: AuditActor
) -> PaymentMethod:
    principal.require(P.SETTINGS_MANAGE)
    await crud.ensure_unique(
        db,
        select(PaymentMethod.id).where(
            PaymentMethod.company_id == principal.company_id, PaymentMethod.code == data.code
        ),
        LABEL,
        "code",
    )
    return await crud.create_entity(
        db, PaymentMethod(company_id=principal.company_id, **data.model_dump()), actor, LABEL
    )


async def update_method(
    db: AsyncSession,
    principal: Principal,
    method_id: uuid.UUID,
    data: PaymentMethodUpdate,
    actor: AuditActor,
) -> PaymentMethod:
    principal.require(P.SETTINGS_MANAGE)
    method = await crud.get_scoped(db, PaymentMethod, principal.company_id, method_id, LABEL)
    return await crud.update_entity(db, method, data.model_dump(exclude_unset=True), actor, LABEL)
