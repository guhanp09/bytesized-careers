"""Authoritative application and hiring-request transition policy.

The manager-facing pipeline state is intentionally distinct from the status
visible to the sender. This keeps ordinary organization private while ensuring
real relationship outcomes are shared consistently.
"""

from __future__ import annotations


APPLICATION_TRANSITIONS: dict[str, frozenset[str]] = {
    "new": frozenset({"reviewing", "shortlisted", "interviewing", "hired", "rejected"}),
    "reviewing": frozenset({"shortlisted", "interviewing", "hired", "rejected"}),
    "shortlisted": frozenset({"reviewing", "interviewing", "hired", "rejected"}),
    "interviewing": frozenset({"hired", "rejected"}),
    "rejected": frozenset({"reviewing", "shortlisted", "interviewing", "hired"}),
    "withdrawn": frozenset(),
    "hired": frozenset(),
    "archived": frozenset(),
}

INTEREST_TRANSITIONS: dict[str, frozenset[str]] = {
    "new": frozenset({"reviewing", "accepted", "declined"}),
    "reviewing": frozenset({"accepted", "declined"}),
    "declined": frozenset(),
    "withdrawn": frozenset(),
    "accepted": frozenset(),
    "archived": frozenset(),
}

APPLICATION_SHARED_STATUSES = frozenset({"interviewing", "hired"})
INTEREST_SHARED_STATUSES = frozenset({"accepted", "declined"})

# Shortlisting may be communicated deliberately from the Pipeline prompt, but
# it is private until that explicit action occurs.
APPLICATION_OPTIONAL_SHARED_STATUSES = frozenset({"shortlisted", "rejected"})

# Old globally archived interactions did not preserve the private pipeline stage
# they were archived from. A manager must explicitly choose the current stage
# once; these are the only legitimate resolution targets.
LEGACY_APPLICATION_RESOLUTION_TARGETS = frozenset(
    {"new", "reviewing", "shortlisted", "interviewing", "hired", "rejected"}
)
LEGACY_INTEREST_RESOLUTION_TARGETS = frozenset(
    {"new", "reviewing", "accepted", "declined"}
)


def application_targets(current_status: str) -> frozenset[str]:
    return APPLICATION_TRANSITIONS.get(current_status, frozenset())


def interest_targets(current_status: str) -> frozenset[str]:
    return INTEREST_TRANSITIONS.get("accepted" if current_status == "contacted" else current_status, frozenset())


def application_transition_allowed(current_status: str, next_status: str) -> bool:
    return next_status == current_status or next_status in application_targets(current_status)


def interest_transition_allowed(current_status: str, next_status: str) -> bool:
    current = "accepted" if current_status == "contacted" else current_status
    target = "accepted" if next_status == "contacted" else next_status
    return target == current or target in interest_targets(current)


def application_status_is_automatically_shared(status: str) -> bool:
    return status in APPLICATION_SHARED_STATUSES


def interest_status_is_automatically_shared(status: str) -> bool:
    return status in INTEREST_SHARED_STATUSES


def application_status_can_be_shared(status: str) -> bool:
    return status in APPLICATION_SHARED_STATUSES or status in APPLICATION_OPTIONAL_SHARED_STATUSES


def interest_status_can_be_shared(status: str) -> bool:
    return status in INTEREST_SHARED_STATUSES
