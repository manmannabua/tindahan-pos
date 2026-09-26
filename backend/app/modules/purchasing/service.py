"""Purchase orders and goods receiving (Phase 6).

Cost tracking: `product_variants.average_cost` is a company-wide moving weighted average per
base unit, updated on every receipt (docs/INVENTORY_LEDGER.md §9):

    new_avg = (on_hand x old_avg + received x cost) / (on_hand + received)

where `on_hand` is the company-wide balance before the receipt, floored at zero (negative stock
has no meaningful cost to average with).
"""

import uuid
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.audit import service as audit
from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.branches.models import StockLocation
from app.modules.inventory.models import InventoryBalance, MovementType
from app.modules.inventory.operations import LineRef, resolve_line
from app.modules.inventory.service import MovementSpec, post_movements
from app.modules.products.models import ProductUnit, ProductVariant
from app.modules.purchasing.models import (
    GoodsReceipt,
    GoodsReceiptLine,
    POStatus,
    PurchaseOrder,
    PurchaseOrderLine,
)
from app.modules.purchasing.schemas import POCreate, POLineIn, POUpdate, ReceiptCreate
from app.modules.suppliers.models import Supplier
from app.modules.users.permissions import P
from app.shared import crud
from app.shared.exceptions import BusinessRuleError, NotFoundError
from app.shared.ids import derived_id
from app.shared.sequences import next_number

COST_STEP = Decimal("0.0001")
CENT = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _cost(value: Decimal) -> Decimal:
    return value.quantize(COST_STEP, rounding=ROUND_HALF_UP)


async def _supplier(db: AsyncSession, company_id: uuid.UUID, supplier_id: uuid.UUID) -> Supplier:
    supplier = await crud.get_scoped(db, Supplier, company_id, supplier_id, "supplier")
    if not supplier.is_active:
        raise BusinessRuleError("Supplier is inactive", code="supplier.inactive")
    return supplier


async def _build_lines(
    db: AsyncSession, company_id: uuid.UUID, lines: list[POLineIn]
) -> list[PurchaseOrderLine]:
    built: list[PurchaseOrderLine] = []
    for n, line_in in enumerate(lines, start=1):
        line = await resolve_line(
            db,
            company_id,
            LineRef(line_in.quantity, variant_id=line_in.variant_id, unit_id=line_in.unit_id),
        )
        built.append(
            PurchaseOrderLine(
                company_id=company_id,
                line_no=n,
                variant_id=line.variant.id,
                product_unit_id=line.product_unit.id,
                unit_factor=line.product_unit.factor,
                quantity=line.quantity,
                base_quantity=line.base_quantity,
                unit_cost=line_in.unit_cost,
                line_total=_money(line.quantity * line_in.unit_cost),
            )
        )
    return built


# --- purchase orders -----------------------------------------------------------------------


def _visible_branches(principal: Principal) -> set[uuid.UUID] | None:
    """Branches whose purchasing documents the user may see (None = all)."""
    manage = principal.branch_scope(P.PURCHASING_MANAGE)
    receive = principal.branch_scope(P.PURCHASING_RECEIVE)
    if manage is None or receive is None:
        return None
    return manage | receive


async def get_po(
    db: AsyncSession, principal: Principal, po_id: uuid.UUID, *, lock: bool = False
) -> PurchaseOrder:
    stmt = (
        select(PurchaseOrder)
        .where(PurchaseOrder.company_id == principal.company_id, PurchaseOrder.id == po_id)
        .options(selectinload(PurchaseOrder.lines))
        .execution_options(populate_existing=True)
    )
    if lock:
        stmt = stmt.with_for_update(of=PurchaseOrder)
    po = await db.scalar(stmt)
    if po is None:
        raise NotFoundError("Purchase order not found", code="purchase_order.not_found")
    return po


async def create_po(
    db: AsyncSession, principal: Principal, data: POCreate, actor: AuditActor
) -> PurchaseOrder:
    location = await crud.get_scoped(
        db, StockLocation, principal.company_id, data.stock_location_id, "location"
    )
    principal.require(P.PURCHASING_MANAGE, location.branch_id)
    await _supplier(db, principal.company_id, data.supplier_id)
    lines = await _build_lines(db, principal.company_id, data.lines)
    po = PurchaseOrder(
        company_id=principal.company_id,
        number=f"PO-{await next_number(db, principal.company_id, 'purchase_order'):06d}",
        supplier_id=data.supplier_id,
        branch_id=location.branch_id,
        stock_location_id=location.id,
        order_date=data.order_date or datetime.now(UTC).date(),
        expected_date=data.expected_date,
        notes=data.notes,
        total=sum((line.line_total for line in lines), Decimal(0)),
        created_by_id=principal.user_id,
        lines=lines,
    )
    db.add(po)
    await db.flush()
    audit.record(
        db,
        actor,
        "purchase_order.created",
        entity_type="purchase_order",
        entity_id=po.id,
        branch_id=po.branch_id,
        metadata={"number": po.number, "total": str(po.total)},
    )
    await db.commit()
    return await get_po(db, principal, po.id)


async def update_po(
    db: AsyncSession, principal: Principal, po_id: uuid.UUID, data: POUpdate, actor: AuditActor
) -> PurchaseOrder:
    po = await get_po(db, principal, po_id, lock=True)
    principal.require(P.PURCHASING_MANAGE, po.branch_id)
    if po.status != POStatus.DRAFT:
        raise BusinessRuleError(
            "Only draft purchase orders can be edited", code="purchase_order.not_draft"
        )
    values = data.model_dump(exclude_unset=True, exclude={"lines"})
    for key, value in values.items():
        setattr(po, key, value)
    if data.lines is not None:
        po.lines = await _build_lines(db, principal.company_id, data.lines)
        po.total = sum((line.line_total for line in po.lines), Decimal(0))
    audit.record(db, actor, "purchase_order.updated", entity_type="purchase_order", entity_id=po.id)
    await db.commit()
    return await get_po(db, principal, po.id)


async def approve_po(
    db: AsyncSession, principal: Principal, po_id: uuid.UUID, actor: AuditActor
) -> PurchaseOrder:
    po = await get_po(db, principal, po_id, lock=True)
    principal.require(P.PURCHASING_MANAGE, po.branch_id)
    if po.status != POStatus.DRAFT:
        raise BusinessRuleError(
            "Only draft purchase orders can be approved", code="purchase_order.not_draft"
        )
    po.status = POStatus.APPROVED
    po.approved_by_id = principal.user_id
    po.approved_at = datetime.now(UTC)
    audit.record(
        db,
        actor,
        "purchase_order.approved",
        entity_type="purchase_order",
        entity_id=po.id,
        branch_id=po.branch_id,
    )
    await db.commit()
    return await get_po(db, principal, po.id)


async def cancel_po(
    db: AsyncSession, principal: Principal, po_id: uuid.UUID, actor: AuditActor
) -> PurchaseOrder:
    po = await get_po(db, principal, po_id, lock=True)
    principal.require(P.PURCHASING_MANAGE, po.branch_id)
    if po.status not in (POStatus.DRAFT, POStatus.APPROVED):
        raise BusinessRuleError(
            "Purchase orders with receipts cannot be cancelled; close them instead",
            code="purchase_order.not_cancellable",
        )
    po.status = POStatus.CANCELLED
    po.closed_at = datetime.now(UTC)
    audit.record(
        db,
        actor,
        "purchase_order.cancelled",
        entity_type="purchase_order",
        entity_id=po.id,
        branch_id=po.branch_id,
    )
    await db.commit()
    return await get_po(db, principal, po.id)


async def close_po(
    db: AsyncSession, principal: Principal, po_id: uuid.UUID, actor: AuditActor
) -> PurchaseOrder:
    """Close a partially received order short (the rest will not arrive)."""
    po = await get_po(db, principal, po_id, lock=True)
    principal.require(P.PURCHASING_MANAGE, po.branch_id)
    if po.status != POStatus.PARTIALLY_RECEIVED:
        raise BusinessRuleError(
            "Only partially received orders can be closed", code="purchase_order.not_partial"
        )
    po.status = POStatus.CLOSED
    po.closed_at = datetime.now(UTC)
    audit.record(
        db,
        actor,
        "purchase_order.closed",
        entity_type="purchase_order",
        entity_id=po.id,
        branch_id=po.branch_id,
    )
    await db.commit()
    return await get_po(db, principal, po.id)


async def list_pos(
    db: AsyncSession,
    principal: Principal,
    *,
    status: POStatus | None,
    supplier_id: uuid.UUID | None,
    limit: int,
    offset: int,
) -> tuple[list[PurchaseOrder], int]:
    stmt = select(PurchaseOrder).where(PurchaseOrder.company_id == principal.company_id)
    scope = _visible_branches(principal)
    if scope is not None:
        stmt = stmt.where(PurchaseOrder.branch_id.in_(scope))
    if status:
        stmt = stmt.where(PurchaseOrder.status == status)
    if supplier_id:
        stmt = stmt.where(PurchaseOrder.supplier_id == supplier_id)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await db.scalars(
        stmt.options(selectinload(PurchaseOrder.lines))
        .order_by(PurchaseOrder.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(rows), total


# --- goods receipts ------------------------------------------------------------------------


async def receive_goods(
    db: AsyncSession, principal: Principal, data: ReceiptCreate, actor: AuditActor
) -> GoodsReceipt:
    company_id = principal.company_id
    po: PurchaseOrder | None = None
    if data.purchase_order_id:
        po = await get_po(db, principal, data.purchase_order_id, lock=True)
        if po.status not in (POStatus.APPROVED, POStatus.PARTIALLY_RECEIVED):
            raise BusinessRuleError(
                "Only approved purchase orders can be received",
                code="purchase_order.not_receivable",
            )
    supplier_id = po.supplier_id if po else data.supplier_id
    if supplier_id is None:
        raise BusinessRuleError("Supplier is required", code="goods_receipt.supplier_required")
    await _supplier(db, company_id, supplier_id)
    location_id = data.stock_location_id or (po.stock_location_id if po else None)
    if location_id is None:
        raise BusinessRuleError(
            "Stock location is required", code="goods_receipt.location_required"
        )
    location = await crud.get_scoped(db, StockLocation, company_id, location_id, "location")
    principal.require(P.PURCHASING_RECEIVE, location.branch_id)

    po_lines = {line.id: line for line in po.lines} if po else {}
    receipt = GoodsReceipt(
        company_id=company_id,
        number=f"GR-{await next_number(db, company_id, 'goods_receipt'):06d}",
        supplier_id=supplier_id,
        purchase_order_id=po.id if po else None,
        branch_id=location.branch_id,
        stock_location_id=location.id,
        supplier_invoice_no=data.supplier_invoice_no,
        notes=data.notes,
        total_cost=Decimal(0),
        received_by_id=principal.user_id,
    )
    db.add(receipt)
    await db.flush()

    rows: list[GoodsReceiptLine] = []
    for n, line_in in enumerate(data.lines, start=1):
        po_line = None
        if line_in.purchase_order_line_id:
            po_line = po_lines.get(line_in.purchase_order_line_id)
            if po_line is None:
                raise NotFoundError(
                    "Line is not on this purchase order", code="purchase_order_line.not_found"
                )
        elif po is not None:
            raise BusinessRuleError(
                "Receipt lines must reference the purchase order lines",
                code="goods_receipt.po_line_required",
            )
        variant_id = po_line.variant_id if po_line else line_in.variant_id
        if variant_id is None:
            raise BusinessRuleError("variant_id is required", code="goods_receipt.variant_required")

        if po_line and line_in.unit_id is None:
            unit = await db.get(ProductUnit, po_line.product_unit_id)
            assert unit is not None  # noqa: S101
            resolved = await resolve_line(
                db,
                company_id,
                LineRef(line_in.quantity, variant_id=variant_id, unit_id=unit.unit_id),
            )
        else:
            resolved = await resolve_line(
                db,
                company_id,
                LineRef(line_in.quantity, variant_id=variant_id, unit_id=line_in.unit_id),
            )

        unit_cost = line_in.unit_cost
        if unit_cost is None:
            if po_line is None:
                raise BusinessRuleError("unit_cost is required", code="goods_receipt.cost_required")
            # PO cost is per ordered unit; convert via base units.
            unit_cost = _cost(
                po_line.unit_cost / po_line.unit_factor * resolved.product_unit.factor
            )
        base_unit_cost = _cost(unit_cost / resolved.product_unit.factor)

        if po_line is not None:
            remaining = po_line.base_quantity - po_line.received_base_quantity
            if resolved.base_quantity > remaining:
                raise BusinessRuleError(
                    "Receiving more than ordered",
                    code="goods_receipt.over_receipt",
                    details={"line_no": po_line.line_no, "remaining_base_quantity": str(remaining)},
                )
            po_line.received_base_quantity += resolved.base_quantity

        row = GoodsReceiptLine(
            company_id=company_id,
            goods_receipt_id=receipt.id,
            line_no=n,
            purchase_order_line_id=po_line.id if po_line else None,
            variant_id=variant_id,
            product_unit_id=resolved.product_unit.id,
            quantity=resolved.quantity,
            base_quantity=resolved.base_quantity,
            unit_cost=unit_cost,
            base_unit_cost=base_unit_cost,
            line_total=_money(resolved.quantity * unit_cost),
            lot_no=line_in.lot_no,
            expiry_date=line_in.expiry_date,
        )
        db.add(row)
        rows.append(row)
    await db.flush()
    receipt.total_cost = sum((r.line_total for r in rows), Decimal(0))

    await _update_average_costs(db, company_id, rows)
    await post_movements(
        db,
        company_id,
        [
            MovementSpec(
                id=derived_id(r.id, "PURCHASE"),
                variant_id=r.variant_id,
                stock_location_id=location.id,
                quantity=r.base_quantity,
                movement_type=MovementType.PURCHASE,
                reference_type="goods_receipt",
                reference_id=receipt.id,
                unit_cost=r.base_unit_cost,
                note=receipt.number,
            )
            for r in rows
        ],
        user_id=principal.user_id,
    )

    if po is not None:
        fully = all(line.received_base_quantity >= line.base_quantity for line in po.lines)
        po.status = POStatus.RECEIVED if fully else POStatus.PARTIALLY_RECEIVED
        if fully:
            po.closed_at = datetime.now(UTC)

    audit.record(
        db,
        actor,
        "goods_receipt.posted",
        entity_type="goods_receipt",
        entity_id=receipt.id,
        branch_id=location.branch_id,
        metadata={
            "number": receipt.number,
            "po": po.number if po else None,
            "total": str(receipt.total_cost),
        },
    )
    await db.commit()
    return await get_receipt(db, principal, receipt.id)


async def _update_average_costs(
    db: AsyncSession, company_id: uuid.UUID, rows: list[GoodsReceiptLine]
) -> None:
    """Moving weighted average per variant, using on-hand quantity *before* this receipt."""
    by_variant: dict[uuid.UUID, tuple[Decimal, Decimal]] = {}  # qty, total cost
    for r in rows:
        qty, cost = by_variant.get(r.variant_id, (Decimal(0), Decimal(0)))
        by_variant[r.variant_id] = (
            qty + r.base_quantity,
            cost + r.base_quantity * r.base_unit_cost,
        )
    for variant_id, (received_qty, received_cost) in by_variant.items():
        variant = await db.scalar(
            select(ProductVariant).where(ProductVariant.id == variant_id).with_for_update()
        )
        assert variant is not None  # noqa: S101
        on_hand = await db.scalar(
            select(func.coalesce(func.sum(InventoryBalance.quantity), 0)).where(
                InventoryBalance.company_id == company_id, InventoryBalance.variant_id == variant_id
            )
        )
        on_hand = max(Decimal(on_hand or 0), Decimal(0))
        total_qty = on_hand + received_qty
        if total_qty > 0:
            variant.average_cost = _cost(
                (on_hand * variant.average_cost + received_cost) / total_qty
            )
        variant.last_cost = _cost(received_cost / received_qty)


async def get_receipt(
    db: AsyncSession, principal: Principal, receipt_id: uuid.UUID
) -> GoodsReceipt:
    receipt = await db.scalar(
        select(GoodsReceipt)
        .where(GoodsReceipt.company_id == principal.company_id, GoodsReceipt.id == receipt_id)
        .options(selectinload(GoodsReceipt.lines))
        .execution_options(populate_existing=True)
    )
    if receipt is None:
        raise NotFoundError("Goods receipt not found", code="goods_receipt.not_found")
    return receipt


async def list_receipts(
    db: AsyncSession,
    principal: Principal,
    *,
    supplier_id: uuid.UUID | None,
    purchase_order_id: uuid.UUID | None,
    received_from: date | None,
    limit: int,
    offset: int,
) -> tuple[list[GoodsReceipt], int]:
    stmt = select(GoodsReceipt).where(GoodsReceipt.company_id == principal.company_id)
    scope = _visible_branches(principal)
    if scope is not None:
        stmt = stmt.where(GoodsReceipt.branch_id.in_(scope))
    if supplier_id:
        stmt = stmt.where(GoodsReceipt.supplier_id == supplier_id)
    if purchase_order_id:
        stmt = stmt.where(GoodsReceipt.purchase_order_id == purchase_order_id)
    if received_from:
        stmt = stmt.where(GoodsReceipt.received_at >= received_from)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await db.scalars(
        stmt.options(selectinload(GoodsReceipt.lines))
        .order_by(GoodsReceipt.received_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(rows), total
