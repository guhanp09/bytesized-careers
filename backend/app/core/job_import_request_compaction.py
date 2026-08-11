"""What the model actually needs, and nothing it cannot act on.

The extraction request was sent to the provider in full: seventy-three field
definitions, each carrying the complete server policy for that field. Measured on
a 933-character pasted listing, that was 63 KB — of which the source itself was
938 bytes and the field definitions were 90%.

Most of that weight was policy the model can do nothing with. ``confirmation_policy``,
``allowed_provenance``, ``missing_requirement``, ``review_section``,
``requires_recruiter_review`` and the auto-fill thresholds all describe how
*the server* will treat a returned value. The server re-validates every field
against exactly those rules when the reply comes back.

What replaces them is smaller and more useful: one sentence per field saying what
belongs in it, plus only the authority boundaries the model can act on: allowed
inference origins, risk, and concrete forbidden semantics. Platform-decided
fields are omitted entirely.

Nothing here weakens the contract. Structured output, evidence grounding, field
path validation, provenance rules and recruiter precedence are all enforced
server-side and are unchanged; this only stops describing them twice.
"""

from __future__ import annotations

from typing import Any

from app.core.job_import_field_descriptions import describe
from app.core.job_import_intelligence_matrix import intelligence_for
from app.schemas.job_import import JobImportExtractionRequest

#: Policy the server owns and re-validates, so the model never needs to see it.
SERVER_ENFORCED_KEYS: frozenset[str] = frozenset(
    {
        "confirmation_policy",
        "nested_confirmation_policies",
        "allowed_provenance",
        "missing_requirement",
        "review_section",
        "requires_recruiter_review",
        "auto_fill_confidence",
        "suggestion_confidence",
        "custom_values_allowed",
        # An internal column name. The model answers by field_path.
        "native_field",
    }
)


def compact_field_definition(definition: Any) -> dict[str, Any]:
    """One field, described rather than governed."""

    field_path = definition.field_path
    compact: dict[str, Any] = {
        "field_path": field_path,
        "value_schema": definition.value_schema,
    }
    description = describe(field_path)
    if description:
        compact["description"] = description
    intelligence = intelligence_for(field_path)
    compact["answer_classification"] = intelligence.answer_classification
    compact["allowed_decision_origins"] = list(intelligence.allowed_origins)
    compact["inference_risk"] = intelligence.inference_risk
    if intelligence.forbidden_semantics:
        compact["forbidden_semantics"] = list(intelligence.forbidden_semantics)
    if intelligence.answer_classification == "enum_plus_custom":
        compact["taxonomy_values_are_suggestions"] = True
    if definition.evidence_required_for_extraction:
        # This one does change what the model must produce, so it stays.
        compact["evidence_required"] = True
    return compact


def compact_provider_request(request: JobImportExtractionRequest) -> dict[str, Any]:
    """The provider-facing projection of an extraction request.

    The private source text is deliberately absent: the model reads the job post
    through the server-owned evidence spans, which are supplied separately and
    are what every citation must point at.
    """

    return {
        "extraction_schema_version": request.extraction_schema_version,
        "target_listing_schema_version": request.target_listing_schema_version,
        # Type only. The text itself reaches the model as evidence spans, and the
        # URL is not something the model should reason about.
        "source": {"source_type": request.source.source_type},
        "allowed_taxonomies": request.allowed_taxonomies,
        "field_definitions": [
            compact_field_definition(definition)
            for definition in request.field_definitions
            if intelligence_for(definition.field_path).provider_visible
        ],
        "inference_restrictions": request.inference_restrictions,
        "output_validation_instructions": request.output_validation_instructions,
    }
