import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.categories.models import Category
from app.modules.categories.schemas import CategoryCreate, CategoryUpdate
from app.modules.users.permissions import P
from app.shared import crud
from app.shared.exceptions import BusinessRuleError

LABEL = "category"


async def list_categories(
    db: AsyncSession, company_id: uuid.UUID, *, include_inactive: bool
) -> list[Category]:
    stmt = select(Category).where(Category.company_id == company_id)
    if not include_inactive:
        stmt = stmt.where(Category.is_active.is_(True))
    return list(await db.scalars(stmt.order_by(Category.sort_order, Category.name)))


async def create_category(
    db: AsyncSession, principal: Principal, data: CategoryCreate, actor: AuditActor
) -> Category:
    principal.require(P.PRODUCTS_WRITE)
    if data.parent_id:
        await crud.get_scoped(db, Category, principal.company_id, data.parent_id, LABEL)
    await _ensure_name_free(db, principal.company_id, data.parent_id, data.name)
    category = Category(company_id=principal.company_id, **data.model_dump())
    return await crud.create_entity(db, category, actor, LABEL)


async def update_category(
    db: AsyncSession,
    principal: Principal,
    category_id: uuid.UUID,
    data: CategoryUpdate,
    actor: AuditActor,
) -> Category:
    principal.require(P.PRODUCTS_WRITE)
    category = await crud.get_scoped(db, Category, principal.company_id, category_id, LABEL)
    values = data.model_dump(exclude_unset=True)
    if "parent_id" in values and values["parent_id"] != category.parent_id:
        await _ensure_no_cycle(db, principal.company_id, category.id, values["parent_id"])
    name = values.get("name") or category.name
    parent = values.get("parent_id", category.parent_id)
    await _ensure_name_free(db, principal.company_id, parent, name, exclude_id=category.id)
    return await crud.update_entity(db, category, values, actor, LABEL, nullable={"parent_id"})


async def _ensure_name_free(
    db: AsyncSession,
    company_id: uuid.UUID,
    parent_id: uuid.UUID | None,
    name: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> None:
    parent_clause = (
        Category.parent_id.is_(None) if parent_id is None else Category.parent_id == parent_id
    )
    await crud.ensure_unique(
        db,
        select(Category.id).where(
            Category.company_id == company_id, parent_clause, crud.ci_equals(Category.name, name)
        ),
        LABEL,
        "name",
        exclude_id=exclude_id,
    )


async def _ensure_no_cycle(
    db: AsyncSession, company_id: uuid.UUID, category_id: uuid.UUID, new_parent: uuid.UUID | None
) -> None:
    """Walk up from the new parent; reaching the category itself would create a loop."""
    current = new_parent
    for _ in range(100):  # depth guard
        if current is None:
            return
        if current == category_id:
            raise BusinessRuleError(
                "A category cannot be moved under itself", code="category.cycle"
            )
        parent = await crud.get_scoped(db, Category, company_id, current, LABEL)
        current = parent.parent_id
    raise BusinessRuleError("Category tree is too deep", code="category.too_deep")
