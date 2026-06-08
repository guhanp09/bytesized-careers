from __future__ import annotations

from typing import Literal

from app.models import User

AccountType = Literal["TALENT", "EMPLOYER", "BOTH", "ADMIN"]
PublicAccountType = Literal["TALENT", "EMPLOYER", "BOTH"]

ACCOUNT_TYPE_TALENT: AccountType = "TALENT"
ACCOUNT_TYPE_EMPLOYER: AccountType = "EMPLOYER"
ACCOUNT_TYPE_BOTH: AccountType = "BOTH"
ACCOUNT_TYPE_ADMIN: AccountType = "ADMIN"

PUBLIC_ACCOUNT_TYPES: set[PublicAccountType] = {"TALENT", "EMPLOYER", "BOTH"}
ALL_ACCOUNT_TYPES: set[AccountType] = {"TALENT", "EMPLOYER", "BOTH", "ADMIN"}


def normalize_account_type(value: str | None) -> AccountType:
    normalized = (value or ACCOUNT_TYPE_TALENT).strip().upper()
    if normalized in ALL_ACCOUNT_TYPES:
        return normalized  # type: ignore[return-value]
    return ACCOUNT_TYPE_TALENT


def can_act_as_talent(user: User) -> bool:
    # Public users are not permanently split into talent/employer roles.
    # Action readiness should come from profile capabilities, not onboarding intent.
    return normalize_account_type(user.account_type) in ALL_ACCOUNT_TYPES


def can_act_as_employer(user: User) -> bool:
    # Public users are not permanently split into talent/employer roles.
    # Action readiness should come from profile capabilities, not onboarding intent.
    return normalize_account_type(user.account_type) in ALL_ACCOUNT_TYPES


def is_admin(user: User) -> bool:
    return normalize_account_type(user.account_type) == "ADMIN"


canActAsTalent = can_act_as_talent
canActAsEmployer = can_act_as_employer
isAdmin = is_admin
