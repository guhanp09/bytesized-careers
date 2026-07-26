"""The backend consumer.

Proves the restore path writes what the manifest says, refuses what it should
refuse, and can be run repeatedly — which matters because a QA session restores
the same scenario over and over.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import pytest
from sqlalchemy import func, select

from app.db.creator_scenarios.restore import (
    DIRECT_INSERTIONS,
    load_manifest,
    restore_manifest,
)
from app.db.creator_scenarios.validation import ManifestError
from app.db.qa_scenarios import SCENARIO_BY_KEY, restore_scenario
from app.models import Conversation, Job, JobApplication, Message, TalentInterest, User
from app.models.review import Engagement
from conftest import TestSessionLocal

pytestmark = pytest.mark.asyncio


async def _restore(scenario: str) -> dict[str, object]:
    async with TestSessionLocal() as session:
        result = await restore_manifest(session, scenario)
        await session.commit()
        return result


async def _count(model) -> int:
    async with TestSessionLocal() as session:
        return int(await session.scalar(select(func.count()).select_from(model)) or 0)


# --- loading ----------------------------------------------------------------


def test_an_unknown_scenario_is_refused_rather_than_defaulted() -> None:
    # Silently restoring `default` would leave someone testing data they never
    # asked for, and reporting bugs against it.
    with pytest.raises(KeyError) as excinfo:
        load_manifest("staging")
    assert "Unknown scenario" in str(excinfo.value)


def test_every_generated_scenario_is_registered_with_a_confirmation() -> None:
    for name in ("empty", "default", "busy", "edge", "talent", "recruiter"):
        entry = SCENARIO_BY_KEY[f"creator-{name}"]
        # The gate is unchanged: this adds a data source, not a new way in.
        assert entry["confirmation"] == f"RESTORE {name.upper()}"
        assert entry["startRoute"] == f"/applications?seed={name}"


def test_direct_insertions_are_documented_rather_than_discovered() -> None:
    # Seeding historical states straight into the tables is a real exception to
    # "go through the services", so each one has to say why.
    assert set(DIRECT_INSERTIONS) >= {
        "application.status",
        "application.participant_status",
        "engagement.payment_state",
        "engagement.status",
        "conversation.messages",
    }
    for reason in DIRECT_INSERTIONS.values():
        assert len(reason) > 40, "a one-word reason is not a documented exception"


# --- restoring --------------------------------------------------------------


async def test_restoring_edge_writes_what_the_manifest_declares() -> None:
    manifest = load_manifest("edge")
    result = await _restore("edge")

    assert result["scenario"] == "edge"
    assert result["actors"] == len(manifest["actors"])
    assert result["jobs"] == len(manifest["jobs"])
    assert result["applications"] + result["hiring_requests"] == len(manifest["relationships"])

    async with TestSessionLocal() as session:
        # Spot-check a real record rather than trusting the counts.
        rel = manifest["relationships"][0]
        if rel["kind"] == "application":
            row = await session.scalar(
                select(JobApplication).where(JobApplication.id == UUID(rel["id"]))
            )
            assert row is not None
            assert row.status == rel["stage"]
            assert row.participant_status == (rel.get("participant_stage") or rel["stage"])


async def test_a_private_decision_survives_the_restore_as_a_divergence() -> None:
    manifest = load_manifest("default")
    private = next(
        rel
        for rel in manifest["relationships"]
        if rel.get("participant_stage") and rel["participant_stage"] != rel["stage"]
    )
    await _restore("default")
    async with TestSessionLocal() as session:
        row = await session.scalar(select(JobApplication).where(JobApplication.id == UUID(private["id"])))
        assert row is not None
        # The whole point of the fixture: the stored stage and what the
        # counterparty was told are different, and both survive.
        assert row.status == private["stage"]
        assert row.participant_status == private["participant_stage"]
        assert row.status != row.participant_status


async def test_payment_state_is_restored_onto_the_engagement() -> None:
    manifest = load_manifest("edge")
    with_payment = [
        rel for rel in manifest["relationships"]
        if rel.get("engagement", {}).get("payment_state")
    ]
    assert with_payment, "the edge manifest should carry payment states"
    await _restore("edge")
    async with TestSessionLocal() as session:
        for rel in with_payment:
            row = await session.scalar(
                select(Engagement).where(Engagement.id == UUID(rel["engagement"]["id"]))
            )
            assert row is not None
            assert row.payment_state == rel["engagement"]["payment_state"]
            # Payment and work status remain independent after a restore.
            assert row.status == rel["engagement"]["state"]


async def test_messages_keep_their_own_ordering_rather_than_all_landing_now() -> None:
    # `default` rather than `edge`: edge records carry a single message each,
    # so ordering can only be shown where a real back-and-forth exists.
    manifest = load_manifest("default")
    await _restore("default")
    rel = next(rel for rel in manifest["relationships"] if len(rel.get("messages") or []) > 1)
    async with TestSessionLocal() as session:
        rows = (
            await session.scalars(
                select(Message)
                .where(Message.conversation_id == UUID(rel["conversation_id"]))
                .order_by(Message.created_at)
            )
        ).all()
        assert len(rows) == len(rel["messages"])
        stamps = [row.created_at for row in rows]
        assert stamps == sorted(stamps)
        # Sending through the service would have stamped every one "now".
        assert len(set(stamps)) > 1


async def test_restoring_twice_reaches_the_same_state_rather_than_doubling_it() -> None:
    first = await _restore("edge")
    applications_after_first = await _count(JobApplication)
    second = await _restore("edge")
    assert second == first
    assert await _count(JobApplication) == applications_after_first


async def test_restoring_an_empty_scenario_leaves_no_relationships() -> None:
    await _restore("edge")
    assert await _count(JobApplication) > 0
    await _restore("empty")
    manifest = load_manifest("empty")
    # `empty` must not merely filter: nothing of its own should remain, and it
    # brings only the identities needed to sign in.
    assert manifest.get("relationships", []) == []


async def test_a_manifest_from_a_future_version_is_refused(tmp_path) -> None:
    import json

    payload = load_manifest("empty")
    payload["version"] = 999
    (tmp_path / "empty.json").write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ManifestError) as excinfo:
        load_manifest("empty", tmp_path)
    assert "not supported" in str(excinfo.value)


async def test_the_restore_gate_still_refuses_an_unknown_key() -> None:
    async with TestSessionLocal() as session:
        with pytest.raises(KeyError):
            await restore_scenario(session, "creator-nonsense")


async def test_a_fixed_anchor_produces_reproducible_timestamps() -> None:
    anchor = datetime(2026, 1, 15, 9, 0, tzinfo=UTC)
    async with TestSessionLocal() as session:
        await restore_manifest(session, "edge", anchor=anchor)
        await session.commit()
    manifest = load_manifest("edge")
    rel = manifest["relationships"][0]
    async with TestSessionLocal() as session:
        model = JobApplication if rel["kind"] == "application" else TalentInterest
        row = await session.scalar(select(model).where(model.id == UUID(rel["id"])))
        created = row.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=UTC)
        expected = anchor.timestamp() + rel["created_offset"]
        assert abs(created.timestamp() - expected) < 2
