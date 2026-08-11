from __future__ import annotations

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.integrations.openai.job_import_adapter import (
    OpenAIJobImportAdapter,
    OpenAIJobImportConfig,
)
from app.integrations.openai.job_import_output import (
    OpenAIJobImportConflict,
    OpenAIJobImportExtractionField,
    OpenAIJobImportMissingField,
)
from app.schemas.job_import import (
    JobImportConflict,
    JobImportExtractionField,
    JobImportExtractionRequest,
    JobImportMissingField,
)
from app.services.job_import_provider import JobImportProviderError


def _domain_field(
    *,
    provenance: str,
    epistemic_status: str | None,
    inference_type: str | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "field_path": "primary_role_key",
        "value": "video-editor",
        "provenance": provenance,
        "evidence": [{"snippet": "Video Editor"}],
        "explanation": "The source supports the selected creator role.",
    }
    if epistemic_status is not None:
        payload["epistemic_status"] = epistemic_status
    if inference_type is not None:
        payload["inference_type"] = inference_type
    return payload


def _wire_field(
    *,
    provenance: str,
    epistemic_status: str | None,
    inference_type: str | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "field_path": "primary_role_key",
        "value_json": '"video-editor"',
        "provenance": provenance,
        "evidence_span_ids": ["E0001"],
        "explanation": "The source supports the selected creator role.",
        "provider_confidence": None,
    }
    if epistemic_status is not None:
        payload["epistemic_status"] = epistemic_status
    if inference_type is not None:
        payload["inference_type"] = inference_type
    return payload


@pytest.mark.parametrize(
    ("provenance", "epistemic_status", "inference_type"),
    [
        ("directly_supplied", "explicit", None),
        ("extracted_from_source", "explicit", None),
        ("extracted_from_source", "normalized_explicit", "taxonomy_normalization"),
        ("suggested_inference", "logically_entailed", "role_title_entailment"),
        (
            "suggested_inference",
            "plausible_interpretation",
            "creator_role_interpretation",
        ),
    ],
)
def test_coherent_epistemic_claims_cross_both_provider_contracts(
    provenance: str,
    epistemic_status: str,
    inference_type: str | None,
) -> None:
    domain = JobImportExtractionField.model_validate(
        _domain_field(
            provenance=provenance,
            epistemic_status=epistemic_status,
            inference_type=inference_type,
        )
    )
    wire = OpenAIJobImportExtractionField.model_validate(
        _wire_field(
            provenance=provenance,
            epistemic_status=epistemic_status,
            inference_type=inference_type,
        )
    )

    assert domain.epistemic_status == epistemic_status
    assert wire.epistemic_status == epistemic_status


@pytest.mark.parametrize(
    ("provenance", "epistemic_status", "inference_type"),
    [
        ("suggested_inference", "explicit", None),
        ("suggested_inference", "normalized_explicit", "normalization"),
        ("extracted_from_source", "logically_entailed", "entailment"),
        ("directly_supplied", "plausible_interpretation", "interpretation"),
    ],
)
def test_incoherent_epistemic_claims_are_rejected_by_both_provider_contracts(
    provenance: str,
    epistemic_status: str,
    inference_type: str | None,
) -> None:
    with pytest.raises(ValidationError):
        JobImportExtractionField.model_validate(
            _domain_field(
                provenance=provenance,
                epistemic_status=epistemic_status,
                inference_type=inference_type,
            )
        )
    with pytest.raises(ValidationError):
        OpenAIJobImportExtractionField.model_validate(
            _wire_field(
                provenance=provenance,
                epistemic_status=epistemic_status,
                inference_type=inference_type,
            )
        )


@pytest.mark.parametrize(
    "epistemic_status",
    ["normalized_explicit", "logically_entailed", "plausible_interpretation"],
)
def test_nonliteral_epistemic_claims_require_a_named_inference(
    epistemic_status: str,
) -> None:
    provenance = (
        "extracted_from_source"
        if epistemic_status == "normalized_explicit"
        else "suggested_inference"
    )
    for inference_type in (None, "", "   "):
        with pytest.raises(ValidationError):
            JobImportExtractionField.model_validate(
                _domain_field(
                    provenance=provenance,
                    epistemic_status=epistemic_status,
                    inference_type=inference_type,
                )
            )
        with pytest.raises(ValidationError):
            OpenAIJobImportExtractionField.model_validate(
                _wire_field(
                    provenance=provenance,
                    epistemic_status=epistemic_status,
                    inference_type=inference_type,
                )
            )


def test_legacy_domain_fields_may_omit_epistemic_annotations_but_wire_may_not() -> None:
    domain = JobImportExtractionField.model_validate(
        _domain_field(
            provenance="extracted_from_source",
            epistemic_status=None,
        )
    )

    assert domain.epistemic_status is None
    assert domain.inference_type is None
    with pytest.raises(ValidationError):
        OpenAIJobImportExtractionField.model_validate(
            _wire_field(
                provenance="extracted_from_source",
                epistemic_status=None,
            )
        )


def test_conflicts_distinguish_ambiguity_from_contradiction() -> None:
    domain_conflict = {
        "field_path": "budget_amount",
        "values": [
            {"value": 10, "evidence": [{"snippet": "Budget 10"}]},
            {"value": 20, "evidence": [{"snippet": "Budget 20"}]},
        ],
    }
    wire_conflict = {
        "field_path": "budget_amount",
        "values": [
            {"value_json": "10", "evidence_span_ids": ["E0001"]},
            {"value_json": "20", "evidence_span_ids": ["E0002"]},
        ],
    }

    assert JobImportConflict.model_validate(domain_conflict).epistemic_status == "conflicting"
    with pytest.raises(ValidationError):
        OpenAIJobImportConflict.model_validate(wire_conflict)
    assert (
        OpenAIJobImportConflict.model_validate(
            {**wire_conflict, "epistemic_status": "conflicting"}
        ).epistemic_status
        == "conflicting"
    )
    assert (
        JobImportConflict.model_validate(
            {**domain_conflict, "epistemic_status": "ambiguous"}
        ).epistemic_status
        == "ambiguous"
    )
    assert (
        OpenAIJobImportConflict.model_validate(
            {**wire_conflict, "epistemic_status": "ambiguous"}
        ).epistemic_status
        == "ambiguous"
    )
    assert JobImportMissingField(field_path="deadline_at").epistemic_status == "absent"
    with pytest.raises(ValidationError):
        OpenAIJobImportMissingField(field_path="deadline_at")
    assert (
        OpenAIJobImportMissingField(
            field_path="deadline_at",
            epistemic_status="absent",
        ).epistemic_status
        == "absent"
    )

    with pytest.raises(ValidationError):
        JobImportMissingField(
            field_path="deadline_at",
            epistemic_status="technically_unavailable",
        )
    with pytest.raises(ValidationError):
        OpenAIJobImportMissingField(
            field_path="deadline_at",
            epistemic_status="technically_unavailable",
        )


class _FakeResponses:
    def __init__(self, parsed: object) -> None:
        self.parsed = parsed

    async def parse(self, **_kwargs: object) -> object:
        return SimpleNamespace(
            status="completed",
            output=[],
            output_parsed=self.parsed,
            model="gpt-test",
            _request_id="req_epistemic_contract",
            usage=SimpleNamespace(
                model_dump=lambda **_kwargs: {
                    "input_tokens": 10,
                    "output_tokens": 5,
                    "total_tokens": 15,
                }
            ),
        )


def _adapter(parsed: object) -> OpenAIJobImportAdapter:
    client = SimpleNamespace(responses=_FakeResponses(parsed))
    return OpenAIJobImportAdapter(
        OpenAIJobImportConfig(
            api_key="test-placeholder-not-a-real-key",
            model="gpt-test",
            request_timeout_seconds=5,
            max_retries=0,
            instruction_version="job-import-test-v1",
        ),
        client=client,
    )


def _request() -> JobImportExtractionRequest:
    return JobImportExtractionRequest.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "source": {
                "source_type": "pasted_text",
                "original_text": "Video Editor",
            },
            "allowed_taxonomies": {},
            "field_definitions": [],
            "inference_restrictions": [],
            "output_validation_instructions": [],
        }
    )


def _wire_response(field: dict[str, object]) -> dict[str, object]:
    return {
        "extraction_schema_version": 1,
        "target_listing_schema_version": 3,
        "fields": [field],
        "conflicts": [],
        "missing_fields": [],
        "warnings": [],
    }


@pytest.mark.asyncio
async def test_fake_provider_cannot_smuggle_an_incoherent_epistemic_claim() -> None:
    payload = _wire_response(
        _wire_field(
            provenance="suggested_inference",
            epistemic_status="explicit",
        )
    )

    with pytest.raises(JobImportProviderError) as caught:
        await _adapter(payload).extract(_request())

    assert caught.value.code == "OPENAI_SCHEMA_MISMATCH"
    assert caught.value.metadata.metadata["processing_stage"] == "provider_wire_validation"


@pytest.mark.asyncio
async def test_fake_provider_payload_without_annotations_is_rejected() -> None:
    payload = _wire_response(
        _wire_field(
            provenance="extracted_from_source",
            epistemic_status=None,
        )
    )

    with pytest.raises(JobImportProviderError) as caught:
        await _adapter(payload).extract(_request())

    assert caught.value.code == "OPENAI_SCHEMA_MISMATCH"
    assert caught.value.metadata.metadata["processing_stage"] == "provider_wire_validation"
