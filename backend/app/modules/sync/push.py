"""Push: apply operations from a terminal's outbox exactly once.

Per operation, in its own transaction:

    INSERT INTO sync_operations (id = operation_id) ON CONFLICT DO NOTHING
      → no row inserted? It was processed before (or is being processed right now by a
        concurrent retry, in which case the INSERT waits for that transaction): DUPLICATE.
    run the handler (inserts the sale with PK = client UUID, items, payments, movements…)
    COMMIT

See docs/SYNC_PROTOCOL.md §3.
"""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.auth.principal import DevicePrincipal
from app.modules.devices.models import Device
from app.modules.realtime.service import mark_device_online, publish
from app.modules.review_flags.models import FlagType
from app.modules.review_flags.service import raise_flag
from app.modules.sync.handlers import HANDLERS, Deferred, OpContext, Rejected
from app.modules.sync.models import OperationStatus, SyncOperation
from app.modules.sync.schemas import (
    OperationIn,
    OperationResult,
    OpError,
    OpStatus,
    PushRequest,
    PushResponse,
)
from app.shared.exceptions import AppError, AuthenticationError

log = get_logger(__name__)

CLOCK_SKEW_TOLERANCE = timedelta(minutes=5)


def payload_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


async def push(db: AsyncSession, principal: DevicePrincipal, request: PushRequest) -> PushResponse:
    permission_cache: dict[Any, Any] = {}
    results = [await _process(db, principal, op, permission_cache) for op in request.operations]
    await _update_device_status(db, principal, request)
    await mark_device_online(principal.device_id)
    applied = [
        op
        for op, r in zip(request.operations, results, strict=True)
        if r.status == OpStatus.APPLIED
    ]
    if applied:
        # After commit: listeners (admin dashboard) refresh; nothing depends on delivery.
        await publish(
            principal.company_id,
            "sync.applied",
            {
                "device_id": principal.device_id,
                "branch_id": principal.branch_id,
                "operations": len(applied),
                "sales": sum(1 for op in applied if op.operation == "sale.complete"),
            },
        )
    return PushResponse(results=results, server_time=datetime.now(UTC))


async def _process(
    db: AsyncSession,
    principal: DevicePrincipal,
    op: OperationIn,
    permission_cache: dict[Any, Any],
) -> OperationResult:
    spec = HANDLERS.get(op.operation)
    digest = payload_hash(op.payload)
    if spec is None or spec.entity_type != op.entity_type:
        return await _record_failure(
            db,
            principal,
            op,
            digest,
            OperationStatus.REJECTED,
            OpError(code="sync.unknown_operation", message=f"Unknown operation {op.operation}"),
        )

    # Fast path: this exact operation was already processed.
    existing = await db.get(SyncOperation, op.operation_id)
    if existing is not None:
        return _replay(existing, principal)

    # Same entity pushed again under a new operation id (e.g. outbox rebuilt on the device).
    prior = await db.scalar(
        select(SyncOperation).where(
            SyncOperation.company_id == principal.company_id,
            SyncOperation.entity_type == op.entity_type,
            SyncOperation.entity_id == op.entity_id,
            SyncOperation.operation == op.operation,
            SyncOperation.status == OperationStatus.APPLIED,
        )
    )
    if prior is not None:
        if prior.payload_hash == digest:
            return OperationResult(operation_id=op.operation_id, status=OpStatus.DUPLICATE)
        return await _record_failure(
            db,
            principal,
            op,
            digest,
            OperationStatus.CONFLICT,
            OpError(
                code="sync.payload_mismatch",
                message="This record was already synced with different content",
                details={"entity_id": str(op.entity_id)},
            ),
        )

    device = await db.get(Device, principal.device_id)
    if device is None or not device.is_active:
        raise AuthenticationError("Device is not active", code="auth.device_revoked")
    try:
        claimed = await db.scalar(
            insert(SyncOperation)
            .values(
                id=op.operation_id,
                company_id=principal.company_id,
                device_id=principal.device_id,
                entity_type=op.entity_type,
                entity_id=op.entity_id,
                operation=op.operation,
                payload_hash=digest,
                status=OperationStatus.APPLIED,
                client_created_at=op.created_at,
            )
            .on_conflict_do_nothing(index_elements=["id"])
            .returning(SyncOperation.id)
        )
        if claimed is None:  # a concurrent request processed it first
            await db.rollback()
            return OperationResult(operation_id=op.operation_id, status=OpStatus.DUPLICATE)
        if _entity_id_of(op) != op.entity_id:
            raise Rejected("sync.entity_mismatch", "entity_id does not match the payload id")
        ctx = OpContext(db=db, device=device, permissions=permission_cache)
        result = await spec.handler(ctx, op.payload)
        await db.execute(
            update(SyncOperation).where(SyncOperation.id == op.operation_id).values(result=result)
        )
        await db.commit()
        return OperationResult(operation_id=op.operation_id, status=OpStatus.APPLIED, result=result)
    except Deferred as exc:
        await db.rollback()
        return OperationResult(
            operation_id=op.operation_id,
            status=OpStatus.DEFERRED,
            error=OpError(code=exc.code, message=exc.message),
        )
    except Rejected as exc:
        await db.rollback()
        return await _record_failure(
            db,
            principal,
            op,
            digest,
            OperationStatus.REJECTED,
            OpError(code=exc.code, message=exc.message, details=exc.details),
        )
    except AppError as exc:
        # A domain rule refused the operation (e.g. over-return): permanent for this payload.
        await db.rollback()
        return await _record_failure(
            db,
            principal,
            op,
            digest,
            OperationStatus.REJECTED,
            OpError(code=exc.code, message=exc.message, details=exc.details),
        )
    except DBAPIError:
        # e.g. a unique violation from a concurrent duplicate under a different operation id.
        # Transient from the client's point of view: the retry will resolve to DUPLICATE/CONFLICT.
        await db.rollback()
        log.warning("sync.op_db_error", operation_id=str(op.operation_id), exc_info=True)
        return _retry(op)
    except Exception:
        await db.rollback()
        log.exception("sync.op_failed", operation_id=str(op.operation_id))
        return _retry(op)


def _entity_id_of(op: OperationIn) -> Any:
    raw = op.payload.get("id")
    try:
        return type(op.entity_id)(str(raw))
    except (TypeError, ValueError):
        return None


def _retry(op: OperationIn) -> OperationResult:
    return OperationResult(
        operation_id=op.operation_id,
        status=OpStatus.RETRY,
        error=OpError(code="sync.server_error", message="Temporary server error; will retry"),
    )


def _replay(existing: SyncOperation, principal: DevicePrincipal) -> OperationResult:
    if existing.device_id != principal.device_id:
        return OperationResult(
            operation_id=existing.id,
            status=OpStatus.REJECTED,
            error=OpError(code="sync.operation_id_reused", message="Operation id already used"),
        )
    if existing.status == OperationStatus.APPLIED:
        return OperationResult(
            operation_id=existing.id, status=OpStatus.DUPLICATE, result=existing.result
        )
    error = OpError(**existing.error) if existing.error else None
    return OperationResult(operation_id=existing.id, status=OpStatus(existing.status), error=error)


async def _record_failure(
    db: AsyncSession,
    principal: DevicePrincipal,
    op: OperationIn,
    digest: str,
    status: OperationStatus,
    error: OpError,
) -> OperationResult:
    """Remember REJECTED/CONFLICT outcomes so a resend gets the same answer instantly."""
    await db.execute(
        insert(SyncOperation)
        .values(
            id=op.operation_id,
            company_id=principal.company_id,
            device_id=principal.device_id,
            entity_type=op.entity_type[:32],
            entity_id=op.entity_id,
            operation=op.operation[:48],
            payload_hash=digest,
            status=status,
            error=error.model_dump(),
            client_created_at=op.created_at,
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await db.commit()
    log.warning(
        "sync.op_failed_permanently",
        operation_id=str(op.operation_id),
        status=status,
        code=error.code,
    )
    return OperationResult(operation_id=op.operation_id, status=OpStatus(status.value), error=error)


async def _update_device_status(
    db: AsyncSession, principal: DevicePrincipal, request: PushRequest
) -> None:
    device = await db.get(Device, principal.device_id)
    if device is None:
        return
    now = datetime.now(UTC)
    device.last_seen_at = now
    device.last_sync_at = now
    if request.pending_count is not None:
        device.pending_operations = request.pending_count
    if request.app_version:
        device.app_version = request.app_version
    if request.device_time and abs(request.device_time - now) > CLOCK_SKEW_TOLERANCE:
        await raise_flag(
            db,
            company_id=principal.company_id,
            flag_type=FlagType.CLOCK_SKEW,
            entity_type="device",
            entity_id=device.id,
            branch_id=device.branch_id,
            details={
                "device_time": request.device_time.isoformat(),
                "server_time": now.isoformat(),
            },
        )
    await db.commit()
