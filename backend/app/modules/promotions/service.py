import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.branches.models import Branch
from app.modules.brands.models import Brand
from app.modules.categories.models import Category
from app.modules.products.models import Product, ProductVariant
from app.modules.promotions.models import Promotion, TargetType
from app.modules.promotions.schemas import PromotionBase, PromotionCreate, PromotionUpdate
from app.modules.users.permissions import P
from app.shared import crud
from app.shared.exceptions import NotFoundError

LABEL = "promotion"
_TARGET_MODELS: dict[TargetType, Any] = {
    TargetType.VARIANT: ProductVariant,
    TargetType.PRODUCT: Product,
    TargetType.CATEGORY: Category,
    TargetType.BRAND: Brand,
}


async def _validate(db: AsyncSession, company_id: uuid.UUID, data: PromotionBase) -> None:
    for target_type, model in _TARGET_MODELS.items():
        ids = {t.id for t in data.targets if t.type == target_type and t.id}
        if not ids:
            continue
        found: set[uuid.UUID] = set(
            await db.scalars(
                select(model.id).where(model.company_id == company_id, model.id.in_(ids))
            )
        )
        if missing := ids - found:
            raise NotFoundError(
                f"Unknown {target_type.value.lower()} in targets",
                code="promotion.unknown_target",
                details={"ids": sorted(map(str, missing))},
            )
    if data.branch_ids:
        found = set(
            await db.scalars(
                select(Branch.id).where(
                    Branch.company_id == company_id, Branch.id.in_(data.branch_ids)
                )
            )
        )
        if set(data.branch_ids) - found:
            raise NotFoundError("Unknown branch", code="branch.not_found")


def _values(data: PromotionBase) -> dict[str, object]:
    values = data.model_dump()
    values["targets"] = [t.model_dump(mode="json") for t in data.targets]
    values["days_of_week"] = sorted(set(data.days_of_week)) if data.days_of_week else None
    return values


async def list_promotions(
    db: AsyncSession, company_id: uuid.UUID, *, include_inactive: bool, limit: int, offset: int
) -> tuple[list[Promotion], int]:
    stmt = select(Promotion).where(Promotion.company_id == company_id)
    if not include_inactive:
        stmt = stmt.where(Promotion.is_active.is_(True))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await db.scalars(
        stmt.order_by(Promotion.priority.desc(), Promotion.name).limit(limit).offset(offset)
    )
    return list(rows), total


async def create_promotion(
    db: AsyncSession, principal: Principal, data: PromotionCreate, actor: AuditActor
) -> Promotion:
    principal.require(P.PROMOTIONS_MANAGE)
    await _validate(db, principal.company_id, data)
    return await crud.create_entity(
        db, Promotion(company_id=principal.company_id, **_values(data)), actor, LABEL
    )


async def update_promotion(
    db: AsyncSession,
    principal: Principal,
    promotion_id: uuid.UUID,
    data: PromotionUpdate,
    actor: AuditActor,
) -> Promotion:
    principal.require(P.PROMOTIONS_MANAGE)
    promotion = await crud.get_scoped(db, Promotion, principal.company_id, promotion_id, LABEL)
    await _validate(db, principal.company_id, data)
    nullable = {
        "buy_quantity",
        "get_quantity",
        "starts_at",
        "ends_at",
        "days_of_week",
        "start_time",
        "end_time",
        "branch_ids",
    }
    return await crud.update_entity(db, promotion, _values(data), actor, LABEL, nullable=nullable)
