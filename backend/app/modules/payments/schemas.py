import uuid
from typing import Annotated

from pydantic import Field, StringConstraints

from app.modules.payments.models import PaymentKind
from app.shared.schemas import ResponseSchema, Schema

MethodCode = Annotated[str, StringConstraints(min_length=1, max_length=16, pattern=r"^[A-Z0-9_]+$")]


class PaymentMethodRead(ResponseSchema):
    id: uuid.UUID
    code: str
    name: str
    kind: PaymentKind
    requires_reference: bool
    opens_drawer: bool
    sort_order: int
    is_active: bool


class PaymentMethodCreate(Schema):
    code: MethodCode
    name: str = Field(min_length=1, max_length=50)
    kind: PaymentKind
    requires_reference: bool = False
    opens_drawer: bool = False
    sort_order: int = 0


class PaymentMethodUpdate(Schema):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    requires_reference: bool | None = None
    opens_drawer: bool | None = None
    sort_order: int | None = None
    is_active: bool | None = None
