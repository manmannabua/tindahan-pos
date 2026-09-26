"""Inventory ledger operations. See docs/INVENTORY_LEDGER.md.

`post_movements()` is the ONLY way stock changes. Sales sync, goods receipts, adjustments,
counts and transfers all call it inside their own transaction.
"""

import uuid
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit import service as audit
from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.branches.models import StockLocation
from app.modules.inventory.models import (
    MOVEMENT_DIRECTIONS,
    Direction,
    InventoryBalance,
    InventoryMovement,
    MovementType,
)
from app.modules.products.models import Product, ProductVariant
from app.modules.review_flags.models import FlagType
from app.modules.review_flags.service import raise_flag
from app.modules.users.permissions import P
from app.shared.exceptions import BusinessRuleError, NotFoundError
from app.shared.ids import new_id

QTY_STEP = Decimal("0.001")


def quantize_qty(value: Decimal) -> Decimal:
    return value.quantize(QTY_STEP, rounding=ROUND_HALF_UP)


@dataclass(frozen=True, slots=True)
class MovementSpec:
    variant_id: uuid.UUID
    stock_location_id: uuid.UUID
    quantity: Decimal  # > 0, base units
    movement_type: MovementType
    direction: Direction | None = None  # required only for STOCK_COUNT
    reference_type: str | None = None
    reference_id: uuid.UUID | None = None
    unit_cost: Decimal | None = None
    occurred_at: datetime | None = None
    id: uuid.UUID = field(default_factory=new_id)  # pass a deterministic id for idempotency
    note: str | None = None


@dataclass(frozen=True, slots=True)
class _Row:
    """One ledger row about to be inserted (column name -> value)."""

    id: uuid.UUID
    company_id: uuid.UUID
    branch_id: uuid.UUID
    stock_location_id: uuid.UUID
    product_id: uuid.UUID
    variant_id: uuid.UUID
    quantity: Decimal
    direction: int
    movement_type: str
    reference_type: str | None
    reference_id: uuid.UUID | None
    unit_cost: Decimal | None
    device_id: uuid.UUID | None
    user_id: uuid.UUID | None
    note: str | None
    occurred_at: datetime


@dataclass(frozen=True, slots=True)
class PostingResult:
    movements: list[InventoryMovement]
    skipped_untracked: int
    # (stock_location_id, variant_id) -> new balance, for balances that went negative
    negative: dict[tuple[uuid.UUID, uuid.UUID], Decimal]


async def post_movements(
    db: AsyncSession,
    company_id: uuid.UUID,
    specs: list[MovementSpec],
    *,
    user_id: uuid.UUID | None,
    device_id: uuid.UUID | None = None,
) -> PostingResult:
    """Append movements to the ledger and update balances in the caller's transaction.

    - Idempotent per movement id (`ON CONFLICT (id) DO NOTHING`): re-posting the same fact
      changes nothing.
    - Products with `track_inventory = false` are skipped.
    - Never rejects a movement for insufficient stock. If a balance ends below zero and the
      movement was outbound, a NEGATIVE_INVENTORY review flag is raised.
    """
    if not specs:
        return PostingResult([], 0, {})

    variants = {
        v.id: (v.product_id, track)
        for v, track in (
            await db.execute(
                select(ProductVariant, Product.track_inventory)
                .join(Product, Product.id == ProductVariant.product_id)
                .where(
                    ProductVariant.company_id == company_id,
                    ProductVariant.id.in_({s.variant_id for s in specs}),
                )
            )
        ).all()
    }
    locations = {
        loc.id: loc.branch_id
        for loc in await db.scalars(
            select(StockLocation).where(
                StockLocation.company_id == company_id,
                StockLocation.id.in_({s.stock_location_id for s in specs}),
            )
        )
    }

    now = datetime.now(UTC)
    rows: list[_Row] = []
    skipped = 0
    for spec in specs:
        if spec.variant_id not in variants:
            raise NotFoundError(
                "Variant not found",
                code="variant.not_found",
                details={"variant_id": str(spec.variant_id)},
            )
        if spec.stock_location_id not in locations:
            raise NotFoundError("Stock location not found", code="location.not_found")
        product_id, tracked = variants[spec.variant_id]
        if not tracked:
            skipped += 1
            continue
        quantity = quantize_qty(spec.quantity)
        if quantity <= 0:
            raise BusinessRuleError(
                "Movement quantity must be positive", code="inventory.invalid_quantity"
            )
        direction = MOVEMENT_DIRECTIONS[spec.movement_type] or spec.direction
        if direction is None:
            raise BusinessRuleError(
                "Direction required for STOCK_COUNT", code="inventory.direction_required"
            )
        rows.append(
            _Row(
                id=spec.id,
                company_id=company_id,
                branch_id=locations[spec.stock_location_id],
                stock_location_id=spec.stock_location_id,
                product_id=product_id,
                variant_id=spec.variant_id,
                quantity=quantity,
                direction=int(direction),
                movement_type=spec.movement_type.value,
                reference_type=spec.reference_type,
                reference_id=spec.reference_id,
                unit_cost=spec.unit_cost,
                device_id=device_id,
                user_id=user_id,
                note=spec.note,
                occurred_at=spec.occurred_at or now,
            )
        )
    if not rows:
        return PostingResult([], skipped, {})

    inserted_ids = set(
        await db.scalars(
            insert(InventoryMovement)
            .values([asdict(r) for r in rows])
            .on_conflict_do_nothing(index_elements=["id"])
            .returning(InventoryMovement.id)
        )
    )
    fresh = [r for r in rows if r.id in inserted_ids]

    # Aggregate deltas per (location, variant) and upsert balances in a fixed order, so two
    # concurrent postings touching the same items always lock rows in the same sequence
    # (prevents deadlocks).
    deltas: dict[tuple[uuid.UUID, uuid.UUID], Decimal] = defaultdict(Decimal)
    last_at: dict[tuple[uuid.UUID, uuid.UUID], datetime] = {}
    outbound: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for r in fresh:
        key = (r.stock_location_id, r.variant_id)
        deltas[key] += r.quantity * r.direction
        last_at[key] = max(last_at.get(key, r.occurred_at), r.occurred_at)
        if r.direction == Direction.OUT:
            outbound.add(key)

    negative: dict[tuple[uuid.UUID, uuid.UUID], Decimal] = {}
    for key in sorted(deltas):
        location_id, variant_id = key
        upsert = insert(InventoryBalance).values(
            company_id=company_id,
            stock_location_id=location_id,
            variant_id=variant_id,
            branch_id=locations[location_id],
            quantity=deltas[key],
            last_movement_at=last_at[key],
        )
        upsert = upsert.on_conflict_do_update(
            index_elements=["stock_location_id", "variant_id"],
            set_={
                "quantity": InventoryBalance.quantity + upsert.excluded.quantity,
                "last_movement_at": func.greatest(
                    InventoryBalance.last_movement_at, upsert.excluded.last_movement_at
                ),
                "updated_at": func.now(),
            },
        )
        new_quantity: Decimal = (
            await db.execute(upsert.returning(InventoryBalance.quantity))
        ).scalar_one()
        if new_quantity < 0 and key in outbound:
            negative[key] = new_quantity
            refs = sorted(
                {
                    str(r.reference_id)
                    for r in fresh
                    if r.reference_id and (r.stock_location_id, r.variant_id) == key
                }
            )
            await raise_flag(
                db,
                company_id=company_id,
                flag_type=FlagType.NEGATIVE_INVENTORY,
                entity_type="product_variant",
                entity_id=variant_id,
                branch_id=locations[location_id],
                stock_location_id=location_id,
                details={"balance": str(new_quantity), "references": refs},
            )

    movements = list(
        await db.scalars(select(InventoryMovement).where(InventoryMovement.id.in_(inserted_ids)))
    )
    return PostingResult(movements, skipped, negative)


# --- Queries -----------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class BalanceRow:
    stock_location_id: uuid.UUID
    branch_id: uuid.UUID
    variant_id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    variant_name: str | None
    sku: str
    quantity: Decimal
    reorder_point: Decimal | None
    last_movement_at: datetime | None


async def list_balances(
    db: AsyncSession,
    principal: Principal,
    *,
    branch_id: uuid.UUID | None,
    stock_location_id: uuid.UUID | None,
    q: str | None,
    only_low: bool,
    only_negative: bool,
    limit: int,
    offset: int,
) -> tuple[list[BalanceRow], int]:
    stmt = (
        select(
            InventoryBalance.stock_location_id,
            InventoryBalance.branch_id,
            InventoryBalance.variant_id,
            Product.id.label("product_id"),
            Product.name.label("product_name"),
            ProductVariant.name.label("variant_name"),
            ProductVariant.sku,
            InventoryBalance.quantity,
            ProductVariant.reorder_point,
            InventoryBalance.last_movement_at,
        )
        .join(ProductVariant, ProductVariant.id == InventoryBalance.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(InventoryBalance.company_id == principal.company_id)
    )
    scope = principal.branch_scope(P.INVENTORY_READ)
    if scope is not None:
        stmt = stmt.where(InventoryBalance.branch_id.in_(scope))
    if branch_id:
        stmt = stmt.where(InventoryBalance.branch_id == branch_id)
    if stock_location_id:
        stmt = stmt.where(InventoryBalance.stock_location_id == stock_location_id)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(Product.name.ilike(pattern) | ProductVariant.sku.ilike(pattern))
    if only_low:
        stmt = stmt.where(
            ProductVariant.reorder_point.is_not(None),
            InventoryBalance.quantity <= ProductVariant.reorder_point,
        )
    if only_negative:
        stmt = stmt.where(InventoryBalance.quantity < 0)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    result = await db.execute(
        stmt.order_by(Product.name, ProductVariant.sku).limit(limit).offset(offset)
    )
    return [BalanceRow(**row._mapping) for row in result.all()], total


async def list_movements(
    db: AsyncSession,
    principal: Principal,
    *,
    variant_id: uuid.UUID | None,
    stock_location_id: uuid.UUID | None,
    movement_type: MovementType | None,
    reference_id: uuid.UUID | None,
    limit: int,
    offset: int,
) -> tuple[list[InventoryMovement], int]:
    stmt = select(InventoryMovement).where(InventoryMovement.company_id == principal.company_id)
    scope = principal.branch_scope(P.INVENTORY_READ)
    if scope is not None:
        stmt = stmt.where(InventoryMovement.branch_id.in_(scope))
    if variant_id:
        stmt = stmt.where(InventoryMovement.variant_id == variant_id)
    if stock_location_id:
        stmt = stmt.where(InventoryMovement.stock_location_id == stock_location_id)
    if movement_type:
        stmt = stmt.where(InventoryMovement.movement_type == movement_type)
    if reference_id:
        stmt = stmt.where(InventoryMovement.reference_id == reference_id)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await db.scalars(
        stmt.order_by(InventoryMovement.occurred_at.desc(), InventoryMovement.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(rows), total


# --- Operations --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class StockLine:
    variant_id: uuid.UUID
    quantity: Decimal
    unit_cost: Decimal | None


async def post_initial_stock(
    db: AsyncSession,
    principal: Principal,
    stock_location_id: uuid.UUID,
    lines: list[StockLine],
    note: str | None,
    actor: AuditActor,
) -> PostingResult:
    """Opening balances (e.g. when starting to use the system or importing)."""
    location = await db.scalar(
        select(StockLocation).where(
            StockLocation.company_id == principal.company_id, StockLocation.id == stock_location_id
        )
    )
    if location is None:
        raise NotFoundError("Stock location not found", code="location.not_found")
    principal.require(P.INVENTORY_ADJUST, location.branch_id)
    reference_id = new_id()
    result = await post_movements(
        db,
        principal.company_id,
        [
            MovementSpec(
                variant_id=line.variant_id,
                stock_location_id=location.id,
                quantity=line.quantity,
                movement_type=MovementType.INITIAL_STOCK,
                reference_type="initial_stock",
                reference_id=reference_id,
                unit_cost=line.unit_cost,
                note=note,
            )
            for line in lines
        ],
        user_id=principal.user_id,
    )
    await _apply_receipt_costs(db, principal.company_id, lines)
    audit.record(
        db,
        actor,
        "inventory.initial_stock",
        entity_type="stock_location",
        entity_id=location.id,
        branch_id=location.branch_id,
        metadata={"reference_id": str(reference_id), "lines": len(lines)},
    )
    await db.commit()
    return result


async def _apply_receipt_costs(
    db: AsyncSession, company_id: uuid.UUID, lines: list[StockLine]
) -> None:
    """Set cost for variants that had none yet. Purchases use the moving average instead."""
    for line in lines:
        if line.unit_cost is None:
            continue
        variant = await db.get(ProductVariant, line.variant_id)
        if variant and variant.company_id == company_id and variant.average_cost == 0:
            variant.average_cost = line.unit_cost
            variant.last_cost = line.unit_cost


async def verify_balances(
    db: AsyncSession, company_id: uuid.UUID
) -> list[tuple[uuid.UUID, uuid.UUID, Decimal, Decimal]]:
    """Compare balances to the ledger. Returns (location, variant, balance, ledger_sum) drifts."""
    ledger = (
        select(
            InventoryMovement.stock_location_id,
            InventoryMovement.variant_id,
            func.sum(InventoryMovement.signed_quantity).label("total"),
        )
        .where(InventoryMovement.company_id == company_id)
        .group_by(InventoryMovement.stock_location_id, InventoryMovement.variant_id)
        .subquery()
    )
    rows = await db.execute(
        select(
            InventoryBalance.stock_location_id,
            InventoryBalance.variant_id,
            InventoryBalance.quantity,
            func.coalesce(ledger.c.total, 0),
        )
        .outerjoin(
            ledger,
            (ledger.c.stock_location_id == InventoryBalance.stock_location_id)
            & (ledger.c.variant_id == InventoryBalance.variant_id),
        )
        .where(
            InventoryBalance.company_id == company_id,
            InventoryBalance.quantity != func.coalesce(ledger.c.total, 0),
        )
    )
    return [(a, b, c, d) for a, b, c, d in rows.all()]
