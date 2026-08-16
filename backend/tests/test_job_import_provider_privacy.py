"""What leaves this system when an import is sent to a provider.

The payload is already minimal — source text, the schema being filled in, and
the rules for filling it. No account, no email, no session, no internal ids.
That is worth pinning rather than admiring, because the way personal data
reaches a third party is almost never a decision to send it. It is a field added
to a request object for a good local reason by someone who did not know that
object crosses a boundary.

So these tests fail when the payload GROWS, not merely when it is wrong today.
They enumerate what a provider is allowed to receive, and anything new has to be
added deliberately — which is the moment to ask whether it should be.
"""

from __future__ import annotations

import json
import uuid

import pytest
from pydantic import ValidationError

from app.schemas.job_import import (
    JobImportExtractionRequest,
    JobImportSourceRepresentation,
)

#: Everything a provider is allowed to be told, at the top level of the request.
#: Adding to this set is a decision about a third party, not a refactor.
PERMITTED_REQUEST_FIELDS = {
    "extraction_schema_version",
    "target_listing_schema_version",
    "source",
    "allowed_taxonomies",
    "field_definitions",
    "inference_restrictions",
    "output_validation_instructions",
}

#: What the provider learns about where the text came from. Note what is absent:
#: who owns it, which draft it belongs to, and which account is paying.
PERMITTED_SOURCE_FIELDS = {
    "source_type",
    "original_text",
    "source_url",
    "original_filename",
    "content_type",
    "storage_references",
}


class TestThePayloadCannotQuietlyGrow:
    def test_the_request_carries_only_what_is_permitted(self) -> None:
        assert set(JobImportExtractionRequest.model_fields) == PERMITTED_REQUEST_FIELDS

    def test_the_source_carries_only_what_is_permitted(self) -> None:
        assert set(JobImportSourceRepresentation.model_fields) == PERMITTED_SOURCE_FIELDS

    @pytest.mark.parametrize(
        "field",
        [
            "owner_user_id",
            "user_id",
            "email",
            "draft_id",
            "account_id",
            "session_id",
            "access_token",
        ],
    )
    def test_identity_cannot_be_smuggled_in(self, field: str) -> None:
        """`extra="forbid"` is what makes this a boundary rather than a habit.

        Without it a caller could attach an account id to the request and every
        test would still pass, because nothing else looks.
        """

        with pytest.raises(ValidationError):
            JobImportSourceRepresentation(
                source_type="pasted_text",
                original_text="Video editor wanted.",
                **{field: str(uuid.uuid4())},
            )


class TestNothingIdentifyingIsSerialized:
    def _request(self) -> JobImportExtractionRequest:
        return JobImportExtractionRequest(
            extraction_schema_version=1,
            target_listing_schema_version=3,
            source=JobImportSourceRepresentation(
                source_type="pasted_text",
                original_text="Video editor wanted for a weekly finance channel.",
            ),
            allowed_taxonomies={"work_mode": ["remote", "onsite"]},
            field_definitions=[],
            inference_restrictions=["Do not infer compensation."],
            output_validation_instructions=["Return only fields you were given."],
        )

    def test_the_serialized_payload_names_no_account(self) -> None:
        """Checked on the JSON, because that is what actually crosses the wire —
        a field can be absent from a model and still appear in what is sent.
        """

        payload = json.dumps(self._request().model_dump(mode="json")).lower()

        for forbidden in (
            "owner_user_id",
            "user_id",
            "@example",
            "access_token",
            "refresh_token",
            "authorization",
            "session",
            "password",
        ):
            assert forbidden not in payload, forbidden

    def test_the_recruiters_own_answers_are_not_included(self) -> None:
        """recruiter_prefill lives on the draft and is deliberately not part of
        the provider contract: it is what the person told US, and the provider
        is being asked to read a job posting."""

        assert "recruiter_prefill" not in JobImportExtractionRequest.model_fields
        assert "recruiter_prefill" not in JobImportSourceRepresentation.model_fields


class TestTheAdapterDoesNotAskTheProviderToKeepAnything:
    def test_responses_are_not_stored_by_the_provider(self) -> None:
        """`store=False` on every call. The source text is a recruiter's private
        draft of a job they have not published, and leaving copies of it in a
        third party's retention window is not ours to agree to."""

        from pathlib import Path

        adapter = Path(__file__).resolve().parents[1] / (
            "app/integrations/openai/job_import_adapter.py"
        )
        source_text = adapter.read_text(encoding="utf8")

        assert "store=False" in source_text
        assert "store=True" not in source_text
