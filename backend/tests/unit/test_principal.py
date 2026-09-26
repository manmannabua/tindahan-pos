import uuid

import pytest

from app.modules.auth.principal import Principal
from app.modules.users.permissions import DEFAULT_ROLES, PERMISSION_DESCRIPTIONS, P
from app.shared.exceptions import PermissionDeniedError

BRANCH_A = uuid.uuid4()
BRANCH_B = uuid.uuid4()


def make(
    global_perms: set[P] = frozenset(), per_branch: dict[uuid.UUID, set[P]] | None = None
) -> Principal:  # type: ignore[assignment]
    return Principal(
        user_id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        username="u",
        global_permissions=frozenset(global_perms),
        branch_permissions={b: frozenset(p) for b, p in (per_branch or {}).items()},
    )


def test_global_permission_applies_to_every_branch() -> None:
    p = make({P.SALES_VOID})
    assert p.has(P.SALES_VOID)
    assert p.has(P.SALES_VOID, BRANCH_A)
    assert p.branch_scope(P.SALES_VOID) is None


def test_branch_permission_is_limited_to_that_branch() -> None:
    p = make(per_branch={BRANCH_A: {P.SALES_VOID}})
    assert p.has(P.SALES_VOID, BRANCH_A)
    assert not p.has(P.SALES_VOID, BRANCH_B)
    assert not p.has(P.SALES_VOID)  # no branch given → only global counts
    assert p.has_in_any_scope(P.SALES_VOID)
    assert p.branch_scope(P.SALES_VOID) == {BRANCH_A}
    with pytest.raises(PermissionDeniedError):
        p.require(P.SALES_VOID, BRANCH_B)


def test_every_permission_is_described() -> None:
    assert set(PERMISSION_DESCRIPTIONS) == set(P)


def test_default_role_hierarchy() -> None:
    owner = DEFAULT_ROLES["OWNER"][2]
    manager = DEFAULT_ROLES["MANAGER"][2]
    cashier = DEFAULT_ROLES["CASHIER"][2]
    assert owner == frozenset(P)
    assert cashier < manager < owner
    assert P.POS_ACCESS in cashier
    assert P.SALES_VOID not in cashier
