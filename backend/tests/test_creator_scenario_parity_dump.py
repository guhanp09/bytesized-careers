"""Emit what the backend consumer actually produces, for the parity suite.

Real parity has to compare *the two code paths*, not two readings of the same
file. So this restores a manifest through the backend QA consumer, reads it back
through the production activity serializer, and writes that payload to a scratch
file. `tests/scenarioParity.test.mjs` then runs it through the same
`mapActivityToOwnerInteractions` the live app uses and compares the result with
the frontend Mock adaptation of the same manifest.

The dump is scratch output, not a committed corpus — committing it would create
exactly the second dataset this phase exists to remove, and it would go stale
silently. The Node side skips when it is absent, and the validation matrix runs
pytest before Node so it is present when it matters.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.security import create_access_token
from app.db.creator_scenarios.restore import restore_manifest
from app.models import User
from conftest import TestSessionLocal

pytestmark = pytest.mark.asyncio

#: Kept out of the repository. Overridable so CI can place it elsewhere.
DUMP_DIR = Path(
    os.environ.get("CREATOR_PARITY_DUMP_DIR")
    or Path(__file__).resolve().parents[2] / ".parity-dumps"
)

#: One anchor for both sides. Timestamps are only comparable if the two
#: consumers materialise offsets against the same instant.
PARITY_ANCHOR_ISO = "2026-01-15T09:00:00+00:00"

#: Scenarios worth dumping. `default` carries every hero journey; `edge` carries
#: the identity, portfolio and conflict cases.
PARITY_SCENARIOS = ("default", "edge")


def _token(user_id) -> str:
    """Mint directly rather than logging in.

    The generated accounts use `.invalid` emails — correct for fixtures, since
    the TLD is reserved and can never route — which the login endpoint's email
    validation rejects. Authenticating is not what this test is proving, so it
    takes the token straight from the same helper login would have used.
    """

    return create_access_token(str(user_id))


@pytest.mark.parametrize("scenario", PARITY_SCENARIOS)
async def test_dump_backend_activity_for_parity(client: AsyncClient, scenario: str) -> None:
    from datetime import datetime

    anchor = datetime.fromisoformat(PARITY_ANCHOR_ISO)
    async with TestSessionLocal() as session:
        await restore_manifest(session, scenario, anchor=anchor)
        await session.commit()

    # Dump from both sides of the marketplace: direction-dependent mapping can
    # only be checked if each persona's own view is captured.
    payloads: dict[str, object] = {"scenario": scenario, "anchor": PARITY_ANCHOR_ISO, "views": {}}
    async with TestSessionLocal() as session:
        recruiters = (
            await session.scalars(
                select(User).where(User.email.like(f"{scenario}-%@scenario.invalid")).limit(400)
            )
        ).all()

    seen = 0
    for user in recruiters:
        token = _token(user.id)
        response = await client.get(
            "/api/v1/me/activity/summary", headers={"Authorization": f"Bearer {token}"}
        )
        # The edge scenario deliberately contains a deactivated account, and the
        # product correctly refuses it. That is the fixture working, not a dump
        # failure, so it is skipped rather than asserted on.
        if response.status_code == 403:
            continue
        assert response.status_code == 200, response.text
        summary = response.json()
        # Only accounts that actually hold relationships are worth dumping; the
        # rest would be empty views that prove nothing.
        if not any(
            summary.get(key)
            for key in (
                "received_applications",
                "sent_applications",
                "received_interests",
                "sent_interests",
            )
        ):
            continue
        payloads["views"][user.email] = summary
        seen += 1
        # Wide enough to reach the personas holding indexed hero records; the
        # parity assertions are only as good as the accounts captured.
        if seen >= 40:
            break

    assert seen > 0, f"no {scenario} account returned any activity to compare"
    DUMP_DIR.mkdir(parents=True, exist_ok=True)
    (DUMP_DIR / f"{scenario}.json").write_text(
        json.dumps(payloads, indent=2, sort_keys=True), encoding="utf-8"
    )
