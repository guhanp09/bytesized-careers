"""Authoritative application and hiring-request transition policy.

The manager-facing pipeline state is intentionally distinct from the status
visible to the sender. This keeps ordinary organization private while ensuring
real relationship outcomes are shared consistently.
"""

from __future__ import annotations


APPLICATION_TRANSITIONS: dict[str, frozenset[str]] = {
    "new": frozenset({"reviewing", "shortlisted", "interviewing", "hired", "rejected", "archived"}),
    "reviewing": frozenset({"shortlisted", "interviewing", "hired", "rejected", "archived"}),
    "shortlisted": frozenset({"reviewing", "interviewing", "hired", "rejected", "archived"}),
    "interviewing": frozenset({"shortlisted", "hired", "rejected", "archived"}),
    "rejected": frozenset({"archived"}),
    "withdrawn": frozenset({"archived"}),
    "hired": frozenset(),
    "archived": frozenset(),
}

INTEREST_TRANSITIONS: dict[str, frozenset[str]] = {
    "new": frozenset({"reviewing", "contacted", "declined", "archived"}),
    "reviewing": frozenset({"contacted", "declined", "archived"}),
    "declined": frozenset({"archived"}),
    "withdrawn": frozenset({"archived"}),
    "contacted": frozenset(),
    "archived": frozenset(),
}

APPLICATION_SHARED_STATUSES = frozenset({"interviewing", "hired", "rejected"})
INTEREST_SHARED_STATUSES = frozenset({"contacted", "declined"})

# Shortlisting may be communicated deliberately from the Pipeline prompt, but
# it is private until that explicit action occurs.
APPLICATION_OPTIONAL_SHARED_STATUSES = frozenset({"shortlisted"})


def application_targets(current_status: str) -> frozenset[str]:
    return APPLICATION_TRANSITIONS.get(current_status, frozenset())


def interest_targets(current_status: str) -> frozenset[str]:
    return INTEREST_TRANSITIONS.get(current_status, frozenset())


def application_transition_allowed(current_status: str, next_status: str) -> bool:
    return next_status == current_status or next_status in application_targets(current_status)


def interest_transition_allowed(current_status: str, next_status: str) -> bool:
    return next_status == current_status or next_status in interest_targets(current_status)


def application_status_is_automatically_shared(status: str) -> bool:
    return status in APPLICATION_SHARED_STATUSES


def interest_status_is_automatically_shared(status: str) -> bool:
    return status in INTEREST_SHARED_STATUSES


def application_status_can_be_shared(status: str) -> bool:
    return status in APPLICATION_SHARED_STATUSES or status in APPLICATION_OPTIONAL_SHARED_STATUSES


def interest_status_can_be_shared(status: str) -> bool:
    return status in INTEREST_SHARED_STATUSES
