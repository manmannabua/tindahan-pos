import uuid
from typing import Annotated

from pydantic import Field, StringConstraints

from app.shared.schemas import ResponseSchema, Schema

UnitCode = Annotated[str, StringConstraints(min_length=1, max_length=16, pattern=r"^[A-Z0-9_]+$")]


class UnitRead(ResponseSchema):
    id: uuid.UUID
    code: str
    name: str
    allows_decimal: bool
    is_active: bool


class UnitCreate(Schema):
    code: UnitCode
    name: str = Field(min_length=1, max_length=50)
    allows_decimal: bool = False


class UnitUpdate(Schema):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    allows_decimal: bool | None = None
    is_active: bool | None = None
