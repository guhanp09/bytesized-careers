"""The provider request carries what the model can act on, and no more.

Measured on a 933-character pasted listing, the request sent to the provider was
63 KB — 90% of it field definitions, and most of that policy describing how the
*server* would treat a returned value. The server re-validates every field
against exactly those rules when the reply arrives, so the model was being
charged input tokens to be told about decisions it does not make.

Replacing that policy with one sentence per field cut the request by more than
half and, on a live page, raised the fields returned from 20 to 30 — including
``about_channel``, which had been asked of a recruiter whose page already
described the company.
"""

from __future__ import annotations

import json

import pytest

from app.core.job_import_field_descriptions import FIELD_DESCRIPTIONS, describe
from app.core.job_import_request_compaction import (
    SERVER_ENFORCED_KEYS,
    compact_field_definition,
    compact_provider_request,
)
from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES


class _Definition:
    def __init__(self, field_path: str, evidence: bool = True) -> None:
        self.field_path = field_path
        self.value_schema = {"type": "string"}
        self.evidence_required_for_extraction = evidence
        self.confirmation_policy = "extract_when_explicit"
        self.nested_confirmation_policies = {}
        self.allowed_provenance = ["extracted_from_source"]
        self.allowed_decision_origins = ["explicit"]
        self.missing_requirement = "recommended"
        self.review_section = "description"
        self.requires_recruiter_review = True
        self.custom_values_allowed = False
        self.inference_risk = "medium"
        self.auto_fill_confidence = None
        self.suggestion_confidence = None
        self.native_field = "about_channel"


def test_server_enforced_policy_never_reaches_the_provider() -> None:
    compact = compact_field_definition(_Definition("about_channel"))
    for key in SERVER_ENFORCED_KEYS:
        assert key not in compact, f"{key} is server policy and costs tokens to send"


def test_what_the_model_needs_survives() -> None:
    compact = compact_field_definition(_Definition("about_channel"))
    assert compact["field_path"] == "about_channel"
    assert compact["value_schema"] == {"type": "string"}
    assert compact["evidence_required"] is True
    assert "employer" in compact["description"].lower()


def test_every_askable_and_extractable_field_is_described() -> None:
    """A field path is an internal name, not an instruction.

    ``about_channel`` is the proof: a corporate listing has no channel, so the
    model returned nothing and the recruiter was asked to retype a description
    the page already carried.
    """

    undescribed = [
        path
        for path in JOB_IMPORT_FIELD_POLICIES
        if path not in FIELD_DESCRIPTIONS
        and JOB_IMPORT_FIELD_POLICIES[path].native_field is not None
    ]
    # A short, reviewable tail rather than a silent gap.
    assert len(undescribed) <= 25, sorted(undescribed)
    # The ones that carry the most meaning must never be bare.
    for path in ("about_channel", "responsibilities", "requirements", "deliverables"):
        assert describe(path), path


def test_about_channel_is_described_as_the_employer_not_a_channel() -> None:
    text = describe("about_channel") or ""
    lowered = text.lower()
    assert "employer" in lowered or "company" in lowered
    assert "about us" in lowered or "about <company>" in lowered


def test_descriptions_stay_short_because_they_ship_on_every_request() -> None:
    for path, text in FIELD_DESCRIPTIONS.items():
        assert len(text) <= 260, f"{path} description is too long to send every time"
        assert text.strip() == text


def test_the_private_source_text_is_not_duplicated_into_the_request() -> None:
    """The model reads the post through evidence spans, which are sent once."""

    class _Source:
        source_type = "public_url"
        original_text = "PRIVATE SOURCE BODY"
        source_url = "https://example.com/job"

    class _Request:
        extraction_schema_version = 1
        target_listing_schema_version = 3
        source = _Source()
        allowed_taxonomies = {"work_mode": ["remote"]}
        field_definitions = [_Definition("about_channel")]
        inference_restrictions = ["no guessing"]
        output_validation_instructions = ["cite spans"]

    payload = json.dumps(compact_provider_request(_Request()))
    assert "PRIVATE SOURCE BODY" not in payload
    assert "https://example.com/job" not in payload


@pytest.mark.anyio
async def test_the_compact_request_is_materially_smaller(client) -> None:
    """The reduction, measured on a real built request rather than asserted."""

    from uuid import UUID, uuid4

    from conftest import TestSessionLocal
    from test_job_import_checkpoint import _auth

    from app.repositories.job_import_repository import JobImportRepository
    from app.repositories.job_repository import JobRepository
    from app.schemas.job_import import JobImportDraftInitialize, JobImportSourceCreate
    from app.services.job_import_service import JobImportService
    from app.services.job_service import JobService

    _headers, owner_id = await _auth(client, "compaction-size")
    async with TestSessionLocal() as session:
        service = JobImportService(
            JobImportRepository(session), JobService(JobRepository(session))
        )
        source = await service.create_source(
            JobImportSourceCreate(
                source_type="pasted_text",
                source_title="compaction",
                original_text="Video editor wanted. Full time. Chennai. INR 30000 per month.",
                idempotency_key=uuid4().hex,
            ),
            owner_user_id=owner_id,
        )
        await session.commit()
        draft = await service.initialize_draft(
            source.id,
            JobImportDraftInitialize(
                extraction_schema_version=1,
                target_listing_schema_version=3,
                idempotency_key=uuid4().hex,
            ),
            owner_user_id=owner_id,
        )
        await session.commit()
        request = await service.build_extraction_request(
            UUID(str(draft.id)), owner_user_id=owner_id
        )

    full = len(request.model_dump_json())
    compact = len(json.dumps(compact_provider_request(request)))
    reduction = (full - compact) / full
    assert reduction >= 0.25, f"only {reduction:.1%} smaller"
    # Every field is still offered; this is compaction, not truncation.
    assert len(compact_provider_request(request)["field_definitions"]) == len(
        request.field_definitions
    )
