"""Base Pydantic schemas."""

from typing import Any

from pydantic import BaseModel, ConfigDict


class Schema(BaseModel):
    """Base for request/response bodies.

    `from_attributes` lets responses be built directly from ORM objects.
    `extra="forbid"` rejects unknown fields so typos in clients fail loudly.
    """

    model_config = ConfigDict(from_attributes=True, extra="forbid", str_strip_whitespace=True)


class ResponseSchema(BaseModel):
    """Base for response bodies (ignore extra ORM attributes)."""

    model_config = ConfigDict(from_attributes=True)


class Page[T](BaseModel):
    items: list[T]
    total: int
    limit: int
    offset: int


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = {}


class ErrorResponse(BaseModel):
    error: ErrorBody
