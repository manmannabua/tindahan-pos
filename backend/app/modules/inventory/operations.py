"""Inventory documents: adjustments, stock counts, transfers (Phase 5).

Every document changes stock only through `post_movements()`, referencing itself, so the
ledger explains every unit. Quantities may be entered in any configured unit of the product;
they are converted to base units here.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.audit import service as audit
from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.branches.models import StockLocation
from app.modules.inventory.models import (
    AdjustmentReason,
    Direction,
    InventoryBalance,
    MovementType,
    StockAdjustment,
    StockAdjustmentLine,
    StockCount,
    StockCountLine,
    StockCountStatus,
    StockTransfer,
    StockTransferLine,
    TransferStatus,
)
from app.modules.inventory.service import MovementSpec, post_movements, quantize_qty
from app.modules.products.models import Barcode, ProductUnit, ProductVariant
from app.modules.review_flags.models import FlagType
from app.modules.review_flags.service import raise_flag
from app.modules.users.permissions import P
from app.shared import barcodes as bc
from app.shared import crud
from app.shared.exceptions import BusinessRuleError, NotFoundError
from app.shared.ids import derived_id
from app.shared.sequences import next_number

# --- shared helpers -------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class LineRef:
    """What the user entered: an item (by variant or barcode), a unit and a quantity."""

    quantity: Decimal
    variant_id: uuid.UUID | None = None
    barcode: str | None = None
    unit_id: uuid.UUID | None = None  # units.id; None = barcode's unit or the base unit


@dataclass(frozen=True, slots=True)
class ResolvedLine:
    variant: ProductVariant
    product_unit: ProductUnit
    quantity: Decimal
    base_quantity: Decimal


async def resolve_line(db: AsyncSession, company_id: uuid.UUID, ref: LineRef) -> ResolvedLine:
    product_unit_id: uuid.UUID | None = None
    variant_id = ref.variant_id
    if ref.barcode:
        barcode = await db.scalar(
            select(Barcode).where(
                Barcode.company_id == company_id,
                Barcode.code == bc.canonicalize(ref.barcode),
                Barcode.is_active.is_(True),
            )
        )
        if barcode is None:
            raise NotFoundError(f"Barcode {ref.barcode} not found", code="barcode.not_found")
        variant_id, product_unit_id = barcode.variant_id, barcode.product_unit_id
    if variant_id is None:
        raise BusinessRuleError("Provide a variant or a barcode", code="inventory.item_required")
    variant = await crud.get_scoped(db, ProductVariant, company_id, variant_id, "variant")

    stmt = select(ProductUnit).where(ProductUnit.product_id == variant.product_id)
    if ref.unit_id:
        stmt = stmt.where(ProductUnit.unit_id == ref.unit_id)
    elif product_unit_id:
        stmt = stmt.where(ProductUnit.id == product_unit_id)
    else:
        stmt = stmt.where(ProductUnit.is_base.is_(True))
    unit = await db.scalar(stmt)
    if unit is None:
        raise NotFoundError(
            "Unit is not configured for this product", code="product_unit.not_found"
        )
    return ResolvedLine(variant, unit, ref.quantity, quantize_qty(ref.quantity * unit.factor))


async def _location(
    db: AsyncSession, principal: Principal, location_id: uuid.UUID, permission: P
) -> StockLocation:
    location = await crud.get_scoped(
        db, StockLocation, principal.company_id, location_id, "location"
    )
    principal.require(permission, location.branch_id)
    if not location.is_active:
        raise BusinessRuleError("Stock location is inactive", code="location.inactive")
    return location


async def _document_number(
    db: AsyncSession, company_id: uuid.UUID, doc_type: str, prefix: str
) -> str:
    return f"{prefix}-{await next_number(db, company_id, doc_type):06d}"


async def current_balance(
    db: AsyncSession, location_id: uuid.UUID, variant_id: uuid.UUID
) -> Decimal:
    value = await db.scalar(
        select(InventoryBalance.quantity).where(
            InventoryBalance.stock_location_id == location_id,
            InventoryBalance.variant_id == variant_id,
        )
    )
    return value if value is not None else Decimal(0)


# --- adjustments -----------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class AdjustmentLineIn:
    ref: LineRef
    reason: AdjustmentReason


async def create_adjustment(
    db: AsyncSession,
    principal: Principal,
    *,
    stock_location_id: uuid.UUID,
    reason: str,
    note: str | None,
    lines: list[AdjustmentLineIn],
    actor: AuditActor,
) -> StockAdjustment:
    location = await _location(db, principal, stock_location_id, P.INVENTORY_ADJUST)
    adjustment = StockAdjustment(
        company_id=principal.company_id,
        number=await _document_number(db, principal.company_id, "stock_adjustment", "ADJ"),
        branch_id=location.branch_id,
        stock_location_id=location.id,
        reason=reason,
        note=note,
        created_by_id=principal.user_id,
    )
    db.add(adjustment)
    await db.flush()

    specs: list[MovementSpec] = []
    for line_in in lines:
        line = await resolve_line(db, principal.company_id, line_in.ref)
        row = StockAdjustmentLine(
            company_id=principal.company_id,
            adjustment_id=adjustment.id,
            variant_id=line.variant.id,
            product_unit_id=line.product_unit.id,
            movement_type=line_in.reason,
            quantity=line.quantity,
            base_quantity=line.base_quantity,
            unit_cost=line.variant.average_cost,
        )
        db.add(row)
        await db.flush()
        specs.append(
            MovementSpec(
                id=derived_id(row.id, "ADJUSTMENT"),
                variant_id=line.variant.id,
                stock_location_id=location.id,
                quantity=line.base_quantity,
                movement_type=MovementType(line_in.reason.value),
                reference_type="stock_adjustment",
                reference_id=adjustment.id,
                unit_cost=line.variant.average_cost,
                note=reason,
            )
        )
    await post_movements(db, principal.company_id, specs, user_id=principal.user_id)
    audit.record(
        db,
        actor,
        "inventory.adjusted",
        entity_type="stock_adjustment",
        entity_id=adjustment.id,
        branch_id=location.branch_id,
        metadata={"number": adjustment.number, "reason": reason, "lines": len(lines)},
    )
    await db.commit()
    return await get_adjustment(db, principal, adjustment.id)


async def get_adjustment(
    db: AsyncSession, principal: Principal, adjustment_id: uuid.UUID
) -> StockAdjustment:
    adjustment = await db.scalar(
        select(StockAdjustment)
        .where(
            StockAdjustment.company_id == principal.company_id, StockAdjustment.id == adjustment_id
        )
        .options(selectinload(StockAdjustment.lines))
        .execution_options(populate_existing=True)
    )
    if adjustment is None:
        raise NotFoundError("Adjustment not found", code="stock_adjustment.not_found")
    return adjustment


async def list_adjustments(
    db: AsyncSession, principal: Principal, *, branch_id: uuid.UUID | None, limit: int, offset: int
) -> tuple[list[StockAdjustment], int]:
    stmt = select(StockAdjustment).where(StockAdjustment.company_id == principal.company_id)
    scope = principal.branch_scope(P.INVENTORY_READ)
    if scope is not None:
        stmt = stmt.where(StockAdjustment.branch_id.in_(scope))
    if branch_id:
        stmt = stmt.where(StockAdjustment.branch_id == branch_id)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await db.scalars(
        stmt.options(selectinload(StockAdjustment.lines))
        .order_by(StockAdjustment.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(rows), total


# --- stock counts ----------------------------------------------------------------------------


async def start_count(
    db: AsyncSession,
    principal: Principal,
    *,
    stock_location_id: uuid.UUID,
    is_full: bool,
    note: str | None,
    actor: AuditActor,
) -> StockCount:
    location = await _location(db, principal, stock_location_id, P.INVENTORY_COUNT)
    count = StockCount(
        company_id=principal.company_id,
        number=await _document_number(db, principal.company_id, "stock_count", "CNT"),
        branch_id=location.branch_id,
        stock_location_id=location.id,
        is_full=is_full,
        note=note,
        started_by_id=principal.user_id,
    )
    db.add(count)
    await db.flush()
    audit.record(
        db,
        actor,
        "stock_count.started",
        entity_type="stock_count",
        entity_id=count.id,
        branch_id=location.branch_id,
        metadata={"number": count.number, "full": is_full},
    )
    await db.commit()
    return await get_count(db, principal, count.id)


async def get_count(db: AsyncSession, principal: Principal, count_id: uuid.UUID) -> StockCount:
    count = await db.scalar(
        select(StockCount)
        .where(StockCount.company_id == principal.company_id, StockCount.id == count_id)
        .options(selectinload(StockCount.lines))
        .execution_options(populate_existing=True)
    )
    if count is None:
        raise NotFoundError("Stock count not found", code="stock_count.not_found")
    return count


async def _open_count(db: AsyncSession, principal: Principal, count_id: uuid.UUID) -> StockCount:
    count = await db.scalar(
        select(StockCount)
        .where(StockCount.company_id == principal.company_id, StockCount.id == count_id)
        .with_for_update()
    )
    if count is None:
        raise NotFoundError("Stock count not found", code="stock_count.not_found")
    principal.require(P.INVENTORY_COUNT, count.branch_id)
    if count.status != StockCountStatus.IN_PROGRESS:
        raise BusinessRuleError("Stock count is closed", code="stock_count.closed")
    return count


async def record_count(
    db: AsyncSession,
    principal: Principal,
    count_id: uuid.UUID,
    ref: LineRef,
    *,
    mode: str,
) -> StockCountLine:
    """Record a counted quantity. mode SET replaces it, ADD accumulates (one scan = +1 unit)."""
    count = await _open_count(db, principal, count_id)
    line = await resolve_line(db, principal.company_id, ref)
    row = await db.scalar(
        select(StockCountLine).where(
            StockCountLine.stock_count_id == count.id,
            StockCountLine.variant_id == line.variant.id,
        )
    )
    system = await current_balance(db, count.stock_location_id, line.variant.id)
    now = datetime.now(UTC)
    if row is None:
        row = StockCountLine(
            company_id=principal.company_id,
            stock_count_id=count.id,
            variant_id=line.variant.id,
            counted_quantity=line.base_quantity,
            system_quantity=system,
            counted_by_id=principal.user_id,
            counted_at=now,
        )
        db.add(row)
    else:
        row.counted_quantity = (
            row.counted_quantity + line.base_quantity if mode == "ADD" else line.base_quantity
        )
        row.system_quantity = system
        row.counted_by_id = principal.user_id
        row.counted_at = now
    if row.counted_quantity < 0:
        raise BusinessRuleError("Counted quantity cannot be negative", code="stock_count.negative")
    await db.commit()
    await db.refresh(row)
    return row


async def complete_count(
    db: AsyncSession, principal: Principal, count_id: uuid.UUID, actor: AuditActor
) -> StockCount:
    count = await _open_count(db, principal, count_id)
    lines = list(
        await db.scalars(select(StockCountLine).where(StockCountLine.stock_count_id == count.id))
    )
    if count.is_full:
        # Items with stock that nobody counted are counted as zero.
        counted = {line.variant_id for line in lines}
        for balance in await db.scalars(
            select(InventoryBalance).where(
                InventoryBalance.stock_location_id == count.stock_location_id,
                InventoryBalance.quantity != 0,
            )
        ):
            if balance.variant_id not in counted:
                line = StockCountLine(
                    company_id=principal.company_id,
                    stock_count_id=count.id,
                    variant_id=balance.variant_id,
                    counted_quantity=Decimal(0),
                    system_quantity=balance.quantity,
                    counted_by_id=principal.user_id,
                )
                db.add(line)
                lines.append(line)
        await db.flush()

    specs: list[MovementSpec] = []
    for line in lines:
        line.variance = line.counted_quantity - line.system_quantity
        if line.variance == 0:
            continue
        specs.append(
            MovementSpec(
                id=derived_id(line.id, "STOCK_COUNT"),
                variant_id=line.variant_id,
                stock_location_id=count.stock_location_id,
                quantity=abs(line.variance),
                movement_type=MovementType.STOCK_COUNT,
                direction=Direction.IN if line.variance > 0 else Direction.OUT,
                reference_type="stock_count",
                reference_id=count.id,
                note=count.number,
            )
        )
    await post_movements(db, principal.company_id, specs, user_id=principal.user_id)
    count.status = StockCountStatus.COMPLETED
    count.completed_by_id = principal.user_id
    count.completed_at = datetime.now(UTC)
    audit.record(
        db,
        actor,
        "stock_count.completed",
        entity_type="stock_count",
        entity_id=count.id,
        branch_id=count.branch_id,
        metadata={"number": count.number, "lines": len(lines), "adjusted": len(specs)},
    )
    await db.commit()
    return await get_count(db, principal, count.id)


async def cancel_count(
    db: AsyncSession, principal: Principal, count_id: uuid.UUID, actor: AuditActor
) -> StockCount:
    count = await _open_count(db, principal, count_id)
    count.status = StockCountStatus.CANCELLED
    audit.record(db, actor, "stock_count.cancelled", entity_type="stock_count", entity_id=count.id)
    await db.commit()
    return await get_count(db, principal, count.id)


# --- transfers -------------------------------------------------------------------------------


async def create_transfer(
    db: AsyncSession,
    principal: Principal,
    *,
    from_location_id: uuid.UUID,
    to_location_id: uuid.UUID,
    note: str | None,
    lines: list[LineRef],
    actor: AuditActor,
) -> StockTransfer:
    if from_location_id == to_location_id:
        raise BusinessRuleError("Source and destination must differ", code="transfer.same_location")
    source = await _location(db, principal, from_location_id, P.INVENTORY_TRANSFER)
    target = await crud.get_scoped(
        db, StockLocation, principal.company_id, to_location_id, "location"
    )
    transfer = StockTransfer(
        company_id=principal.company_id,
        number=await _document_number(db, principal.company_id, "stock_transfer", "TRF"),
        from_location_id=source.id,
        to_location_id=target.id,
        from_branch_id=source.branch_id,
        to_branch_id=target.branch_id,
        note=note,
        created_by_id=principal.user_id,
    )
    db.add(transfer)
    await db.flush()
    for ref in lines:
        line = await resolve_line(db, principal.company_id, ref)
        db.add(
            StockTransferLine(
                company_id=principal.company_id,
                transfer_id=transfer.id,
                variant_id=line.variant.id,
                product_unit_id=line.product_unit.id,
                quantity=line.quantity,
                base_quantity=line.base_quantity,
            )
        )
    audit.record(
        db,
        actor,
        "stock_transfer.created",
        entity_type="stock_transfer",
        entity_id=transfer.id,
        branch_id=source.branch_id,
        metadata={"number": transfer.number},
    )
    await db.commit()
    return await get_transfer(db, principal, transfer.id)


async def get_transfer(
    db: AsyncSession, principal: Principal, transfer_id: uuid.UUID
) -> StockTransfer:
    transfer = await db.scalar(
        select(StockTransfer)
        .where(StockTransfer.company_id == principal.company_id, StockTransfer.id == transfer_id)
        .options(selectinload(StockTransfer.lines))
        .execution_options(populate_existing=True)
    )
    if transfer is None:
        raise NotFoundError("Transfer not found", code="stock_transfer.not_found")
    return transfer


async def _locked_transfer(
    db: AsyncSession, principal: Principal, transfer_id: uuid.UUID
) -> StockTransfer:
    transfer = await db.scalar(
        select(StockTransfer)
        .where(StockTransfer.company_id == principal.company_id, StockTransfer.id == transfer_id)
        .with_for_update()
    )
    if transfer is None:
        raise NotFoundError("Transfer not found", code="stock_transfer.not_found")
    return transfer


async def send_transfer(
    db: AsyncSession, principal: Principal, transfer_id: uuid.UUID, actor: AuditActor
) -> StockTransfer:
    """Goods leave the source: TRANSFER_OUT movements; status IN_TRANSIT."""
    transfer = await _locked_transfer(db, principal, transfer_id)
    principal.require(P.INVENTORY_TRANSFER, transfer.from_branch_id)
    if transfer.status != TransferStatus.DRAFT:
        raise BusinessRuleError("Only draft transfers can be sent", code="transfer.not_draft")
    lines = list(
        await db.scalars(
            select(StockTransferLine).where(StockTransferLine.transfer_id == transfer.id)
        )
    )
    if not lines:
        raise BusinessRuleError("Transfer has no lines", code="transfer.empty")
    await post_movements(
        db,
        principal.company_id,
        [
            MovementSpec(
                id=derived_id(line.id, "TRANSFER_OUT"),
                variant_id=line.variant_id,
                stock_location_id=transfer.from_location_id,
                quantity=line.base_quantity,
                movement_type=MovementType.TRANSFER_OUT,
                reference_type="stock_transfer",
                reference_id=transfer.id,
                note=transfer.number,
            )
            for line in lines
        ],
        user_id=principal.user_id,
    )
    transfer.status = TransferStatus.IN_TRANSIT
    transfer.sent_by_id = principal.user_id
    transfer.sent_at = datetime.now(UTC)
    audit.record(
        db,
        actor,
        "stock_transfer.sent",
        entity_type="stock_transfer",
        entity_id=transfer.id,
        branch_id=transfer.from_branch_id,
    )
    await db.commit()
    return await get_transfer(db, principal, transfer.id)


async def receive_transfer(
    db: AsyncSession,
    principal: Principal,
    transfer_id: uuid.UUID,
    received: dict[uuid.UUID, Decimal] | None,
    actor: AuditActor,
) -> StockTransfer:
    """Goods arrive: TRANSFER_IN for the received quantity (per line, base units; default = sent).

    Missing quantity stays out of both locations (it left the source) and raises a flag.
    """
    transfer = await _locked_transfer(db, principal, transfer_id)
    principal.require(P.INVENTORY_TRANSFER, transfer.to_branch_id)
    if transfer.status != TransferStatus.IN_TRANSIT:
        raise BusinessRuleError("Transfer is not in transit", code="transfer.not_in_transit")
    lines = list(
        await db.scalars(
            select(StockTransferLine).where(StockTransferLine.transfer_id == transfer.id)
        )
    )
    received = received or {}
    if unknown := set(received) - {line.id for line in lines}:
        raise NotFoundError(
            "Unknown transfer line", details={"line_ids": sorted(map(str, unknown))}
        )
    specs: list[MovementSpec] = []
    shortages: list[dict[str, str]] = []
    for line in lines:
        qty = quantize_qty(received.get(line.id, line.base_quantity))
        if qty < 0 or qty > line.base_quantity:
            raise BusinessRuleError(
                "Received quantity must be between 0 and the sent quantity",
                code="transfer.invalid_received",
            )
        line.received_base_quantity = qty
        if qty > 0:
            specs.append(
                MovementSpec(
                    id=derived_id(line.id, "TRANSFER_IN"),
                    variant_id=line.variant_id,
                    stock_location_id=transfer.to_location_id,
                    quantity=qty,
                    movement_type=MovementType.TRANSFER_IN,
                    reference_type="stock_transfer",
                    reference_id=transfer.id,
                    note=transfer.number,
                )
            )
        if qty < line.base_quantity:
            shortages.append(
                {
                    "variant_id": str(line.variant_id),
                    "sent": str(line.base_quantity),
                    "received": str(qty),
                }
            )
    await post_movements(db, principal.company_id, specs, user_id=principal.user_id)
    transfer.status = TransferStatus.RECEIVED
    transfer.received_by_id = principal.user_id
    transfer.received_at = datetime.now(UTC)
    if shortages:
        await raise_flag(
            db,
            company_id=principal.company_id,
            flag_type=FlagType.TRANSFER_DISCREPANCY,
            entity_type="stock_transfer",
            entity_id=transfer.id,
            branch_id=transfer.to_branch_id,
            details={"number": transfer.number, "lines": shortages},
        )
    audit.record(
        db,
        actor,
        "stock_transfer.received",
        entity_type="stock_transfer",
        entity_id=transfer.id,
        branch_id=transfer.to_branch_id,
        metadata={"shortages": shortages},
    )
    await db.commit()
    return await get_transfer(db, principal, transfer.id)


async def cancel_transfer(
    db: AsyncSession, principal: Principal, transfer_id: uuid.UUID, actor: AuditActor
) -> StockTransfer:
    """Draft: simply cancelled. In transit: goods return to the source (TRANSFER_IN there)."""
    transfer = await _locked_transfer(db, principal, transfer_id)
    principal.require(P.INVENTORY_TRANSFER, transfer.from_branch_id)
    if transfer.status == TransferStatus.IN_TRANSIT:
        lines = list(
            await db.scalars(
                select(StockTransferLine).where(StockTransferLine.transfer_id == transfer.id)
            )
        )
        await post_movements(
            db,
            principal.company_id,
            [
                MovementSpec(
                    id=derived_id(line.id, "TRANSFER_RETURN"),
                    variant_id=line.variant_id,
                    stock_location_id=transfer.from_location_id,
                    quantity=line.base_quantity,
                    movement_type=MovementType.TRANSFER_IN,
                    reference_type="stock_transfer",
                    reference_id=transfer.id,
                    note=f"{transfer.number} cancelled",
                )
                for line in lines
            ],
            user_id=principal.user_id,
        )
    elif transfer.status != TransferStatus.DRAFT:
        raise BusinessRuleError("Transfer can no longer be cancelled", code="transfer.closed")
    transfer.status = TransferStatus.CANCELLED
    audit.record(
        db, actor, "stock_transfer.cancelled", entity_type="stock_transfer", entity_id=transfer.id
    )
    await db.commit()
    return await get_transfer(db, principal, transfer.id)


async def list_documents[D: (StockCount, StockTransfer)](
    db: AsyncSession,
    principal: Principal,
    model: type[D],
    *,
    status: str | None,
    limit: int,
    offset: int,
) -> tuple[list[D], int]:
    stmt = select(model).where(model.company_id == principal.company_id)
    scope = principal.branch_scope(P.INVENTORY_READ)
    if scope is not None:
        if model is StockTransfer:
            stmt = stmt.where(
                StockTransfer.from_branch_id.in_(scope) | StockTransfer.to_branch_id.in_(scope)
            )
        else:
            stmt = stmt.where(StockCount.branch_id.in_(scope))
    if status:
        stmt = stmt.where(model.status == status)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await db.scalars(
        stmt.options(selectinload(model.lines))
        .order_by(model.number.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(rows), total
