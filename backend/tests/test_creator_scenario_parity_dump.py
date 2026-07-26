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

from uuid import UUID

from app.core.security import create_access_token
from app.db.creator_scenarios.restore import load_manifest, restore_manifest
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

#: Scenarios worth dumping — every one that carries relationships. `empty` is
#: excluded because it has none by definition, and the Node suite asserts on the
#: rest. Dumping only two was how an earlier run reported parity for `default`
#: across zero received applications.
PARITY_SCENARIOS = ("default", "edge", "busy", "talent", "recruiter")


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
    #
    # Chosen from the relationships themselves rather than by scanning accounts
    # in whatever order the table returns them. Scanning is what an earlier
    # version did, and for `default` the first forty accounts with any activity
    # were all applicants — so the suite compared zero received applications and
    # reported parity. Taking the two sides explicitly, and interleaving them,
    # means a bounded dump still holds both directions.
    manifest = load_manifest(scenario)
    relationships = manifest.get("relationships", [])
    managers = list(dict.fromkeys(rel["recruiter_id"] for rel in relationships))
    participants = list(dict.fromkeys(rel["talent_id"] for rel in relationships))
    ordered_ids: list[str] = []
    for index in range(max(len(managers), len(participants))):
        if index < len(managers):
            ordered_ids.append(managers[index])
        if index < len(participants):
            ordered_ids.append(participants[index])

    payloads: dict[str, object] = {"scenario": scenario, "anchor": PARITY_ANCHOR_ISO, "views": {}}
    async with TestSessionLocal() as session:
        by_id = {
            str(user.id): user
            for user in (
                await session.scalars(
                    select(User).where(User.id.in_([UUID(value) for value in ordered_ids]))
                )
            ).all()
        }
    accounts = [by_id[value] for value in ordered_ids if value in by_id]

    seen = 0
    for user in accounts:
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
        if seen >= 60:
            break

    assert seen > 0, f"no {scenario} account returned any activity to compare"

    # A dump that captured one side of the marketplace would let the Node suite
    # pass while comparing nothing in the other direction. Assert the coverage
    # here, where the failure names the cause, rather than letting it surface as
    # a silently narrow comparison.
    views = payloads["views"].values()
    inbound = sum(len(v.get("received_applications", [])) + len(v.get("received_interests", [])) for v in views)
    outbound = sum(len(v.get("sent_applications", [])) + len(v.get("sent_interests", [])) for v in views)
    assert inbound > 0, f"{scenario} dump captured no received records"
    assert outbound > 0, f"{scenario} dump captured no sent records"
    DUMP_DIR.mkdir(parents=True, exist_ok=True)
    (DUMP_DIR / f"{scenario}.json").write_text(
        json.dumps(payloads, indent=2, sort_keys=True), encoding="utf-8"
    )
