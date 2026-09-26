import uuid

from pydantic import Field

from app.shared.schemas import ResponseSchema, Schema


class BrandRead(ResponseSchema):
    id: uuid.UUID
    name: str
    is_active: bool


class BrandCreate(Schema):
    name: str = Field(min_length=1, max_length=100)


class BrandUpdate(Schema):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    is_active: bool | None = None
