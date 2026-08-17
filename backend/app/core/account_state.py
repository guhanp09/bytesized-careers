"""Whether an account may act, and why not — from two independent states.

An account can be stopped for two unrelated reasons, and conflating them has
already caused one privilege escape.

`suspended_at` is an ADMINISTRATIVE decision: somebody with authority decided
this account should stop. Only an administrator sets or clears it.

`deletion_hidden_at` is the ACCOUNT HOLDER'S OWN request taking effect. They
asked to be deleted; until that completes they stop being visible and stop being
able to act. Only they set or clear it, by requesting or cancelling.

They were once the same column, and the collision was not theoretical: the
suspend endpoint refuses an account that is already suspended, so an account
that had requested deletion could not be suspended at all — asking to be deleted
made you un-moderatable, and cancelling afterwards restored a clean account.

So they stay separate, and everything that asks "may this account act" asks HERE
rather than checking one column and forgetting the other. That is the whole
point of this module: a second enforcement point that consults only
`suspended_at` is how one of these states silently stops being enforced.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AccountBlock:
    """Why an account is stopped, in words safe to show its owner."""

    blocked: bool
    reason: str | None = None


#: Deliberately does not distinguish the two cases to the caller. Someone
#: suspended for abuse learns nothing useful from being told which flag it was,
#: and someone mid-deletion already knows what they asked for.
SUSPENDED_MESSAGE = "Account suspended. Contact support for details."
DELETION_PENDING_MESSAGE = "This account is being closed at its owner's request."


def account_block(user) -> AccountBlock:  # noqa: ANN001 - accepts any user-shaped row
    """Whether this account is stopped, checking BOTH states.

    Suspension is reported first when both apply: an administrative decision is
    the more consequential fact, and support needs to see it rather than a
    deletion notice that hides it.
    """

    if getattr(user, "suspended_at", None) is not None:
        return AccountBlock(blocked=True, reason=SUSPENDED_MESSAGE)
    if getattr(user, "deletion_hidden_at", None) is not None:
        return AccountBlock(blocked=True, reason=DELETION_PENDING_MESSAGE)
    return AccountBlock(blocked=False)


def account_is_blocked(user) -> bool:  # noqa: ANN001 - accepts any user-shaped row
    return account_block(user).blocked
