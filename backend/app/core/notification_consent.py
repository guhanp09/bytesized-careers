"""What a person can switch off, and what they cannot.

Every email this platform sends falls into one of two groups, and the line
between them is the whole of this module.

Some mail is the product doing what the person asked for: verifying the address
they just typed, the reset they just requested, the invitation that lets them in
at all. Letting someone unsubscribe from those means letting them lock
themselves out of their own account by clicking a link at the bottom of an
email — and they will click it, because it was in an email they did not want.

Everything else is the platform deciding to write to them: a new applicant, a
status change, a digest. That is theirs to refuse, completely and without
argument, and refusing it must be one click from the message itself rather than
four screens deep in settings.

The asymmetry mirrors the one in suppression, deliberately: a hard bounce stops
everything because the mailbox does not exist, while a complaint stops only what
the platform chose to send. Same reasoning, different trigger.

Consent is stored as an OPT-OUT: absence of a row means subscribed. That way a
new event category does not silently arrive switched off for everyone who
registered before it existed — which would be a feature nobody could find,
failing quietly.
"""

from __future__ import annotations

from app.notifications.email import AUTH_EVENT_KEYS
from app.notifications.registry import (
    CATEGORY_DIGEST,
    CATEGORY_LIFECYCLE,
    CATEGORY_TRANSACTIONAL,
    EVENT_REGISTRY,
)

#: Categories a person may switch off. Transactional mail is absent on purpose:
#: it is the product answering something they did.
OPTIONAL_CATEGORIES = frozenset({CATEGORY_LIFECYCLE, CATEGORY_DIGEST})

#: Categories that are sent regardless of preference.
ESSENTIAL_CATEGORIES = frozenset({CATEGORY_TRANSACTIONAL})


def category_for_event(event_key: str) -> str:
    """Which group an event belongs to.

    Authentication mail is essential by identity rather than by registry entry —
    it does not appear in the notification registry at all, and treating an
    unknown key as optional would let a password reset be switched off by
    something as small as a typo.
    """

    if event_key in AUTH_EVENT_KEYS:
        return CATEGORY_TRANSACTIONAL

    event = EVENT_REGISTRY.get(event_key)
    if event is None:
        # Unknown, so treated as essential. The failure directions are not
        # symmetric: wrongly sending one email is a nuisance, wrongly
        # withholding a password reset locks someone out of their account.
        return CATEGORY_TRANSACTIONAL
    return event.category


def is_essential(event_key: str) -> bool:
    return category_for_event(event_key) in ESSENTIAL_CATEGORIES


def may_send(event_key: str, *, opted_out_categories: frozenset[str] | set[str]) -> bool:
    """Whether this event may be emailed to someone with these opt-outs.

    Pure, and takes the opt-outs rather than a user, so the rule can be read in
    one place and tested without a database.
    """

    if is_essential(event_key):
        return True
    return category_for_event(event_key) not in opted_out_categories


def selectable_categories() -> tuple[str, ...]:
    """What a preferences screen may legitimately offer.

    Offering an essential category would be presenting a switch that does
    nothing, which is worse than not offering it: the person believes they have
    unsubscribed and then keeps receiving mail.
    """

    return tuple(sorted(OPTIONAL_CATEGORIES))
