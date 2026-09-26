import uuid

from pydantic import Field

from app.shared.schemas import ResponseSchema, Schema


class CategoryRead(ResponseSchema):
    id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    sort_order: int
    is_active: bool


class CategoryCreate(Schema):
    name: str = Field(min_length=1, max_length=100)
    parent_id: uuid.UUID | None = None
    sort_order: int = 0


class CategoryUpdate(Schema):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    parent_id: uuid.UUID | None = None
    sort_order: int | None = None
    is_active: bool | None = None
