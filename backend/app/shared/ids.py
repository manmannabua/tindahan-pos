"""ID generation.

UUIDv7 is time-ordered: new rows land at the "end" of B-tree indexes like an auto-increment,
but IDs can be generated anywhere (server or offline POS) without coordination.
"""

import uuid

from uuid_utils.compat import uuid7


def new_id() -> uuid.UUID:
    return uuid7()


# Namespace for deterministic IDs derived from other IDs (e.g. inventory movement of a sale item).
POS_NAMESPACE = uuid.UUID("6f1c8a52-3d4e-4b7a-9c1e-2a5b8d0f4e11")


def derived_id(source: uuid.UUID, purpose: str) -> uuid.UUID:
    """Deterministic UUIDv5 so client and server derive the same id for the same fact."""
    return uuid.uuid5(POS_NAMESPACE, f"{source}:{purpose}")
