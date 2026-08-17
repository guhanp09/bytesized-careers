"""A blocked account cannot keep participating through a session it already has.

Moderation that only changes an admin screen is not moderation. The account that
matters is the one already logged in when the decision is made: it holds a valid
token, and every marketplace mutation it makes is authorised by that token unless
something checks the account itself on the way through.

Two states can block an account and they are independent — an administrative
suspension, and the account holder's own deletion request. The tests below run
the same enforcement checks against BOTH, because the failure this guards is not
"we forgot to enforce". It is "we enforced the state we were thinking about and
forgot the other one", which is exactly how a deletion request once made an
account un-suspendable.

The token is obtained BEFORE the account is blocked in every case. Checking
enforcement with a token issued afterwards would only prove that login is gated,
which is the easy half.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import User
from tests.conftest import TestSessionLocal, create_valid_published_job
from tests.test_messaging import _register_verified_login

NOW = datetime(2026, 6, 1, 12, 0, 0, tzinfo=UTC)


async def _block(email: str, *, state: str) -> None:
    """Block an account the way each lifecycle actually does.

    Written through a separate session so the change is committed, exactly as it
    would be when an administrator acts while somebody is mid-session.
    """

    async with TestSessionLocal() as session:
        user = (
            await session.execute(select(User).where(User.email == email))
        ).scalar_one()
        if state == "suspended":
            user.suspended_at = NOW
            user.suspension_reason = "Suspended by an administrator."
        else:
            user.deletion_hidden_at = NOW
        await session.commit()


BLOCKING_STATES = ["suspended", "deletion_requested"]


@pytest.mark.parametrize("state", BLOCKING_STATES)
class TestABlockedAccountCannotActThroughAnExistingSession:
    """Every case obtains the token first, then blocks, then acts."""

    async def test_it_cannot_post_a_job(
        self, client: AsyncClient, state: str
    ) -> None:
        label = f"enf_job_{state[:4]}_{uuid.uuid4().hex[:6]}"
        email = f"{label}@example.com"
        bearer = await _register_verified_login(client, email=email, username=label)

        await _block(email, state=state)

        response = await create_valid_published_job(
            client, bearer, title="A job posted after being blocked"
        )

        assert response.status_code == 403, response.text

    async def test_it_cannot_apply_to_a_job(
        self, client: AsyncClient, state: str
    ) -> None:
        owner_label = f"enf_own_{state[:4]}_{uuid.uuid4().hex[:6]}"
        owner = await _register_verified_login(
            client, email=f"{owner_label}@example.com", username=owner_label
        )
        job = await create_valid_published_job(client, owner, title="Editor wanted")
        job_id = job.json()["id"]

        label = f"enf_app_{state[:4]}_{uuid.uuid4().hex[:6]}"
        email = f"{label}@example.com"
        applicant = await _register_verified_login(client, email=email, username=label)

        await _block(email, state=state)

        response = await client.post(
            f"/api/v1/jobs/{job_id}/applications",
            headers={"Authorization": f"Bearer {applicant}"},
            json={"cover_note": "Applying after being blocked.", "portfolio_item_ids": []},
        )

        assert response.status_code == 403, response.text

    async def test_it_cannot_send_a_message(
        self, client: AsyncClient, state: str
    ) -> None:
        """The one that matters most for harassment: a suspended account must
        stop being able to reach the person who reported it."""

        owner_label = f"enf_mo_{state[:4]}_{uuid.uuid4().hex[:6]}"
        owner = await _register_verified_login(
            client, email=f"{owner_label}@example.com", username=owner_label
        )
        job = await create_valid_published_job(client, owner, title="Editor wanted")
        job_id = job.json()["id"]

        label = f"enf_msg_{state[:4]}_{uuid.uuid4().hex[:6]}"
        email = f"{label}@example.com"
        applicant = await _register_verified_login(client, email=email, username=label)
        headers = {"Authorization": f"Bearer {applicant}"}

        applied = await client.post(
            f"/api/v1/jobs/{job_id}/applications",
            headers=headers,
            json={"cover_note": "Hello.", "portfolio_item_ids": []},
        )
        application_id = applied.json()["id"]
        conversation = await client.get(
            f"/api/v1/me/applications/{application_id}/conversation", headers=headers
        )
        conversation_id = conversation.json()["conversation"]["id"]

        await _block(email, state=state)

        response = await client.post(
            f"/api/v1/me/conversations/{conversation_id}/messages",
            headers=headers,
            json={"body": "Still talking after being blocked."},
        )

        assert response.status_code == 403, response.text

    async def test_it_cannot_read_its_own_profile_api(
        self, client: AsyncClient, state: str
    ) -> None:
        """The door itself. Every authenticated route depends on this resolver,
        which is why enforcement lives there rather than on each route."""

        label = f"enf_me_{state[:4]}_{uuid.uuid4().hex[:6]}"
        email = f"{label}@example.com"
        bearer = await _register_verified_login(client, email=email, username=label)

        await _block(email, state=state)

        response = await client.get(
            "/api/v1/me", headers={"Authorization": f"Bearer {bearer}"}
        )

        assert response.status_code == 403


@pytest.mark.parametrize("state", BLOCKING_STATES)
class TestABlockedAccountDisappearsFromPublicSurfaces:
    async def test_its_public_profile_is_gone(
        self, client: AsyncClient, state: str
    ) -> None:
        """For deletion this is the point of the request: someone asking to be
        removed must not stay visible while the removal is pending."""

        label = f"enf_pub_{state[:4]}_{uuid.uuid4().hex[:6]}"
        email = f"{label}@example.com"
        await _register_verified_login(client, email=email, username=label)

        visible = await client.get(f"/api/v1/users/{label}/public-profile")
        assert visible.status_code == 200

        await _block(email, state=state)

        hidden = await client.get(f"/api/v1/users/{label}/public-profile")
        assert hidden.status_code == 404


@pytest.mark.parametrize("state", BLOCKING_STATES)
class TestABlockedAccountCannotObtainNewCredentials:
    async def test_it_cannot_log_in(self, client: AsyncClient, state: str) -> None:
        """Blocking only at the door would let a blocked account keep collecting
        fresh tokens and meet a 403 on every request — logged in and unable to
        do anything, which is both wrong and confusing."""

        label = f"enf_log_{state[:4]}_{uuid.uuid4().hex[:6]}"
        email = f"{label}@example.com"
        await _register_verified_login(client, email=email, username=label)

        await _block(email, state=state)

        response = await client.post(
            "/api/v1/auth/login", json={"email": email, "password": "Password123!"}
        )

        assert response.status_code == 403, response.text


class TestTheTwoStatesAreEnforcedByOneRead:
    def test_no_blocking_check_reads_a_single_column(self) -> None:
        """The structural guard. A new enforcement point that checks only
        `suspended_at` is how one of these states silently stops being
        enforced — which has already happened once.

        The admin router is exempt: its suspend and unsuspend endpoints are
        about suspension specifically, and reading the combined state there
        would be wrong.
        """

        import re
        from pathlib import Path

        app_root = Path(__file__).resolve().parents[1] / "app"
        exempt = {"account_state.py", "user.py", "admin.py"}

        offenders = []
        for path in app_root.rglob("*.py"):
            if "__pycache__" in str(path) or path.name in exempt:
                continue
            if re.search(r"\.suspended_at is (not )?None", path.read_text(encoding="utf8")):
                offenders.append(str(path.relative_to(app_root)))

        assert offenders == [], (
            "these decide something from suspension alone and would miss a "
            f"deletion request: {offenders}"
        )

    def test_the_guard_would_notice(self) -> None:
        """Guards the guard: the pattern must actually match the shape it
        claims to, or the assertion above is vacuous."""

        import re

        assert re.search(r"\.suspended_at is (not )?None", "if user.suspended_at is not None:")
