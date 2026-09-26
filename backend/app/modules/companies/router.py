from fastapi import APIRouter, Depends, Request, status

from app.core.config import get_settings
from app.core.rate_limit import enforce_rate_limit
from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    client_ip,
    require_permission,
)
from app.modules.companies import service
from app.modules.companies.schemas import (
    CompanyRead,
    CompanyUpdate,
    FeaturesRead,
    FeaturesUpdate,
    SignupRequest,
    SignupResponse,
)
from app.modules.users.permissions import P
from app.shared.exceptions import PermissionDeniedError

router = APIRouter(prefix="/companies", tags=["companies"])


@router.post("/signup", response_model=SignupResponse, status_code=status.HTTP_201_CREATED)
async def signup(data: SignupRequest, request: Request, db: DbSession) -> SignupResponse:
    """Create a new business (company) with its owner account and first branch."""
    if not get_settings().allow_signup:
        raise PermissionDeniedError("Sign-up is disabled", code="company.signup_disabled")
    ip = client_ip(request)
    await enforce_rate_limit(f"signup:{ip}", limit=5, window_seconds=3600)
    company, owner, branch = await service.signup(db, data, ip=ip)
    return SignupResponse(
        company=CompanyRead.model_validate(company), owner_user_id=owner.id, branch_id=branch.id
    )


@router.get("/current", response_model=CompanyRead)
async def get_current_company(principal: CurrentPrincipal, db: DbSession) -> CompanyRead:
    return CompanyRead.model_validate(await service.get_company(db, principal.company_id))


@router.patch(
    "/current",
    response_model=CompanyRead,
    dependencies=[Depends(require_permission(P.COMPANY_MANAGE))],
)
async def update_current_company(
    data: CompanyUpdate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> CompanyRead:
    company = await service.update_company(
        db, principal.company_id, data, audit_actor(principal, request)
    )
    return CompanyRead.model_validate(company)


@router.get("/current/features", response_model=FeaturesRead)
async def get_features(principal: CurrentPrincipal, db: DbSession) -> FeaturesRead:
    """Optional features with their state, descriptions, dependencies and onboarding presets."""
    return service.features_view(await service.get_company(db, principal.company_id))


@router.put(
    "/current/features",
    response_model=FeaturesRead,
    dependencies=[Depends(require_permission(P.COMPANY_MANAGE))],
)
async def update_features(
    data: FeaturesUpdate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> FeaturesRead:
    company = await service.update_features(
        db, principal.company_id, data, audit_actor(principal, request)
    )
    return service.features_view(company)


@router.post(
    "/current/onboarding/complete",
    response_model=CompanyRead,
    dependencies=[Depends(require_permission(P.COMPANY_MANAGE))],
)
async def complete_onboarding(
    principal: CurrentPrincipal, request: Request, db: DbSession
) -> CompanyRead:
    company = await service.complete_onboarding(
        db, principal.company_id, audit_actor(principal, request)
    )
    return CompanyRead.model_validate(company)
