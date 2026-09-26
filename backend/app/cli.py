"""Command-line utilities.

python -m app.cli seed-dev        create a demo company with sample staff (development only)
python -m app.cli create-company  create a real company + owner interactively
python -m app.cli set-password EMAIL   set a user's password from $POS_PASSWORD (ops/deploys)
"""

import argparse
import asyncio
import getpass
import os
import sys
from datetime import UTC, datetime

from sqlalchemy import func, select

from app import models  # noqa: F401  (register models)
from app.core.config import get_settings
from app.core.database import get_engine, get_sessionmaker
from app.core.security import hash_secret
from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.companies import service as company_service
from app.modules.companies.models import Company
from app.modules.companies.schemas import SignupRequest
from app.modules.users.models import Role, User
from app.modules.users.permissions import ALL_PERMISSIONS
from app.modules.users.schemas import RoleAssignment, UserCreate
from app.modules.users.service import create_user

DEMO_PASSWORD = "demo-password-123"
DEMO_STAFF = [
    # username, full name, role, PIN
    ("manager", "Mara Manager", "MANAGER", "246810"),
    ("cashier1", "Carlo Cashier", "CASHIER", "135790"),
    ("cashier2", "Cora Cashier", "CASHIER", "975310"),
    ("stock", "Ian Inventory", "INVENTORY_CLERK", "864209"),
]


async def seed_dev() -> None:
    if get_settings().is_production:
        sys.exit("Refusing to seed demo data in production.")
    async with get_sessionmaker()() as db:
        if await db.scalar(select(Company.id).where(Company.code == "DEMO")):
            print("Demo company already exists.")
            return
        company, owner, branch = await company_service.signup(
            db,
            SignupRequest(
                company_name="Demo Mini Mart",
                company_code="DEMO",
                owner_full_name="Olivia Owner",
                owner_email="owner@demo.example.com",
                owner_username="owner",
                owner_password=DEMO_PASSWORD,
            ),
        )
        company.onboarding_completed_at = datetime.now(UTC)  # the demo is already set up
        roles = {
            r.code: r.id
            for r in await db.scalars(select(Role).where(Role.company_id == company.id))
        }
        owner_principal = Principal(
            user_id=owner.id,
            company_id=company.id,
            username=owner.username,
            global_permissions=frozenset(ALL_PERMISSIONS),
        )
        actor = AuditActor(company_id=company.id, user_id=owner.id)
        for username, full_name, role, pin in DEMO_STAFF:
            await create_user(
                db,
                owner_principal,
                UserCreate(
                    email=f"{username}@demo.example.com",
                    username=username,
                    full_name=full_name,
                    password=DEMO_PASSWORD,
                    pin=pin,
                    roles=[RoleAssignment(role_id=roles[role], branch_id=branch.id)],
                ),
                actor,
            )
    await get_engine().dispose()
    print("Demo company DEMO created.")
    print(f"  Admin login: owner@demo.example.com / {DEMO_PASSWORD}")
    for username, _, role, pin in DEMO_STAFF:
        print(f"  {role:<16} {username:<9} password {DEMO_PASSWORD}  PIN {pin}")


def prompt_company() -> SignupRequest:
    return SignupRequest(
        company_name=input("Company name: ").strip(),
        company_code=input("Company code (A-Z, 0-9): ").strip().upper(),
        owner_full_name=input("Owner full name: ").strip(),
        owner_email=input("Owner email: ").strip(),
        owner_username=input("Owner username: ").strip().lower(),
        owner_password=getpass.getpass("Owner password (min 10 chars): "),
    )


async def create_company(data: SignupRequest) -> None:
    async with get_sessionmaker()() as db:
        company, _, _ = await company_service.signup(db, data)
    await get_engine().dispose()
    print(f"Company {company.code} created.")


async def set_password(email: str, password: str) -> None:
    """Set a password without printing it (deploy scripts pass it via the environment)."""
    if len(password) < 10:
        sys.exit("Password must be at least 10 characters.")
    async with get_sessionmaker()() as db:
        user = await db.scalar(select(User).where(func.lower(User.email) == email.lower()))
        if user is None:
            sys.exit(f"No user with email {email}.")
        user.password_hash = hash_secret(password)
        await db.commit()
    await get_engine().dispose()
    print(f"Password set for {email}.")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    parser.add_argument("command", choices=["seed-dev", "create-company", "set-password"])
    parser.add_argument("email", nargs="?")
    args = parser.parse_args()
    if args.command == "seed-dev":
        asyncio.run(seed_dev())
    elif args.command == "set-password":
        password = os.environ.get("POS_PASSWORD", "")
        if not args.email or not password:
            sys.exit("usage: POS_PASSWORD=... python -m app.cli set-password EMAIL")
        asyncio.run(set_password(args.email, password))
    else:
        asyncio.run(create_company(prompt_company()))


if __name__ == "__main__":
    main()
