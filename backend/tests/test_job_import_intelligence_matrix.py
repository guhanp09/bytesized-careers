"""The semantic matrix must cover the complete live import registry."""

from app.core.job_import_intelligence_matrix import (
    intelligence_matrix,
    nested_intelligence_matrix,
)
from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES
from app.core.job_import_request_compaction import compact_field_definition
from app.integrations.openai.job_import_instructions import build_job_import_instructions
from app.integrations.openai.job_import_output import OpenAIJobImportExtractionField
from app.schemas.job_import import JobImportFieldDefinition


def test_every_importable_field_has_non_empty_semantics_and_a_control_class() -> None:
    matrix = intelligence_matrix()

    assert set(matrix) == set(JOB_IMPORT_FIELD_POLICIES)
    assert len(matrix) >= 70
    assert all(row.meaning.strip() for row in matrix.values())
    assert all(row.answer_classification for row in matrix.values())
    assert all(row.source_patterns for row in matrix.values())
    assert all(row.deterministic_coverage for row in matrix.values())
    assert all(row.safe_inference_rule for row in matrix.values())
    assert all(row.conflict_authority for row in matrix.values())
    assert all(row.validator for row in matrix.values())
    assert all(row.persistence for row in matrix.values())
    assert all(row.presentation for row in matrix.values())


def test_intelligence_matrix_is_cached_as_one_executable_inventory() -> None:
    assert intelligence_matrix() is intelligence_matrix()
    assert nested_intelligence_matrix() is nested_intelligence_matrix()


def test_every_nested_confirmation_boundary_is_in_the_executable_inventory() -> None:
    expected = {
        nested_path
        for policy in JOB_IMPORT_FIELD_POLICIES.values()
        for nested_path, _confirmation in policy.nested_confirmation_policies
    }
    nested = nested_intelligence_matrix()

    assert expected
    assert set(nested) == expected
    assert all(row.parent_field in JOB_IMPORT_FIELD_POLICIES for row in nested.values())
    assert all(row.validator for row in nested.values())
    sensitive = nested["source_inputs.sensitive_access_confirmed"]
    assert sensitive.provider_visible is False
    assert sensitive.forbidden_semantics
    for field_path in (
        "source_inputs.type.account_access",
        "source_inputs.type.analytics_access",
    ):
        access_type = nested[field_path]
        assert access_type.provider_visible is True
        assert "explicit source evidence" in " ".join(access_type.forbidden_semantics)
        assert "pending" in " ".join(access_type.forbidden_semantics)


def test_experience_is_open_with_suggestions_not_a_closed_band() -> None:
    row = intelligence_matrix()["experience_level"]

    assert row.answer_classification == "enum_plus_custom"
    assert row.custom_values_allowed is True
    assert "labelled" in " ".join(row.source_patterns).lower()
    assert row.historic_regressions
    assert row.regression_coverage


def test_structured_other_rows_are_classified_as_open_not_strict_enums() -> None:
    matrix = intelligence_matrix()

    for field_path in ("deliverables", "source_inputs", "hiring_process"):
        row = matrix[field_path]
        assert row.answer_classification == "structured_open"
        assert row.custom_values_allowed is True
        assert row.nested_fields
        assert row.regression_coverage


def test_matrix_records_question_validator_persistence_and_presentation_contracts() -> None:
    matrix = intelligence_matrix()

    assert matrix["experience_level"].question_eligibility == "helpful_optional"
    assert matrix["experience_level"].question_type == "choice"
    assert matrix["about_channel"].question_type is None
    assert matrix["primary_role_key"].validator == "active role catalog lookup"
    assert matrix["screening_questions"].presentation.startswith("private")
    assert matrix["application_mode"].question_type is None


def test_compacted_provider_contract_explains_open_taxonomies() -> None:
    policy = JOB_IMPORT_FIELD_POLICIES["experience_level"]
    definition = JobImportFieldDefinition(
        field_path="experience_level",
        native_field="experience_level",
        value_schema={"type": "string", "maxLength": 64},
        confirmation_policy=policy.confirmation_policy,
        nested_confirmation_policies={},
        allowed_provenance=["directly_supplied", "extracted_from_source", "suggested_inference"],
        evidence_required_for_extraction=True,
        requires_recruiter_review=True,
        missing_requirement=policy.missing_requirement,
        review_section=policy.review_section,
        custom_values_allowed=True,
        inference_risk=policy.inference_risk,
        allowed_decision_origins=sorted(policy.allowed_origins),
        auto_fill_confidence=policy.auto_fill_confidence,
        suggestion_confidence=policy.suggestion_confidence,
    )

    compact = compact_field_definition(definition)
    assert compact["answer_classification"] == "enum_plus_custom"
    assert compact["taxonomy_values_are_suggestions"] is True
    assert compact["allowed_decision_origins"] == sorted(policy.allowed_origins)
    assert compact["inference_risk"] == policy.inference_risk


def test_platform_owned_routes_are_not_provider_fields() -> None:
    matrix = intelligence_matrix()

    for field_path in ("application_mode", "external_apply_url"):
        row = matrix[field_path]
        assert row.answer_classification == "server_owned"
        assert row.provider_visible is False
        assert row.forbidden_semantics

    public_note = matrix["how_to_apply"]
    assert public_note.provider_visible is True
    assert any("destination" in rule for rule in public_note.forbidden_semantics)


def test_application_materials_and_screening_have_distinct_provider_rules() -> None:
    matrix = intelligence_matrix()

    requirement_rules = " ".join(
        matrix["application_requirements"].forbidden_semantics
    ).lower()
    screening_rules = " ".join(
        matrix["screening_questions"].forbidden_semantics
    ).lower()
    assert "canonical" in requirement_rules
    assert "destinations" in requirement_rules
    assert "resume" in screening_rules
    assert "invent requiredness" in screening_rules


def test_sensitive_input_types_remain_explicit_pending_provider_facts() -> None:
    source_input_rules = " ".join(
        intelligence_matrix()["source_inputs"].forbidden_semantics
    )

    assert "Never populate source_inputs.sensitive_access_confirmed" in source_input_rules
    for field_path in (
        "source_inputs.type.account_access",
        "source_inputs.type.analytics_access",
    ):
        assert f"{field_path} may be extracted only from explicit source evidence" in (
            source_input_rules
        )
        assert f"Never populate {field_path}" not in source_input_rules


def test_luna_contract_names_epistemic_states_and_whole_job_mission() -> None:
    instructions = build_job_import_instructions(version="job-import-text-v6")
    schema = OpenAIJobImportExtractionField.model_json_schema()

    assert "semantic reasoning layer" in instructions
    assert "logically_entailed" in instructions
    assert "dedicated labelled Experience row" in instructions
    assert "CreatorJobs owns the application route" in instructions
    assert "standard materials" in instructions.lower()
    assert "Never emit application_mode or" in instructions
    assert "epistemic_status" in schema["properties"]
    assert "epistemic_status" in schema["required"]
    assert "inference_type" in schema["properties"]
