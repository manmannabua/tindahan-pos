import uuid

from pydantic import Field

from app.modules.branches.models import LocationType
from app.modules.companies.schemas import Code
from app.shared.schemas import ResponseSchema, Schema


class StockLocationRead(ResponseSchema):
    id: uuid.UUID
    branch_id: uuid.UUID
    code: str
    name: str
    location_type: LocationType
    is_default: bool
    is_active: bool


class StockLocationCreate(Schema):
    code: Code
    name: str = Field(min_length=2, max_length=200)
    location_type: LocationType = LocationType.STORE
    is_default: bool = False


class StockLocationUpdate(Schema):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    location_type: LocationType | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class BranchRead(ResponseSchema):
    id: uuid.UUID
    code: str
    name: str
    address: str | None
    phone: str | None
    tin: str | None
    receipt_header: str | None
    receipt_footer: str | None
    is_active: bool


class BranchDetail(BranchRead):
    locations: list[StockLocationRead]


class BranchCreate(Schema):
    code: Code
    name: str = Field(min_length=2, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, max_length=50)
    tin: str | None = Field(default=None, max_length=32)
    receipt_header: str | None = Field(default=None, max_length=1000)
    receipt_footer: str | None = Field(default=None, max_length=1000)


class BranchUpdate(Schema):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, max_length=50)
    tin: str | None = Field(default=None, max_length=32)
    receipt_header: str | None = Field(default=None, max_length=1000)
    receipt_footer: str | None = Field(default=None, max_length=1000)
    is_active: bool | None = None
