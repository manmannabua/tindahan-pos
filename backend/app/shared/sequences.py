"""Gap-free server-side document numbers (PO numbers, transfer numbers, internal barcodes).

`SELECT ... FOR UPDATE` on the sequence row serializes concurrent callers; the number is only
consumed if the surrounding transaction commits. POS receipt numbers do NOT use this — they are
generated on the device so they work offline.
"""

import uuid

from sqlalchemy import BigInteger, ForeignKey, String, UniqueConstraint, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.shared.models import Base, UUIDPrimaryKeyMixin


class DocumentSequence(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "document_sequences"
    __table_args__ = (
        UniqueConstraint("company_id", "scope", "doc_type", postgresql_nulls_not_distinct=True),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    # e.g. a branch id for per-branch numbering, or "" for company-wide.
    scope: Mapped[str] = mapped_column(String(64), server_default=text("''"))
    doc_type: Mapped[str] = mapped_column(String(32))
    next_value: Mapped[int] = mapped_column(BigInteger, server_default=text("1"))


async def next_number(
    db: AsyncSession, company_id: uuid.UUID, doc_type: str, scope: str = ""
) -> int:
    await db.execute(
        insert(DocumentSequence)
        .values(company_id=company_id, scope=scope, doc_type=doc_type)
        .on_conflict_do_nothing()
    )
    seq = await db.scalar(
        select(DocumentSequence)
        .where(
            DocumentSequence.company_id == company_id,
            DocumentSequence.scope == scope,
            DocumentSequence.doc_type == doc_type,
        )
        .with_for_update()
    )
    assert seq is not None  # noqa: S101 - row was just upserted
    value = seq.next_value
    seq.next_value = value + 1
    await db.flush()
    return value
