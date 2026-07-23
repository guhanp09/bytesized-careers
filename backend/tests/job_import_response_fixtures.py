from __future__ import annotations

from copy import deepcopy
from typing import Any


def evidence(
    snippet: str = "The source explicitly states this value.",
    **location: object,
) -> list[dict[str, object]]:
    item: dict[str, object] = {"snippet": snippet}
    if location:
        item["location"] = location
    return [item]


def extracted(field_path: str, value: object, **location: object) -> dict[str, object]:
    return {
        "field_path": field_path,
        "value": value,
        "provenance": "extracted_from_source",
        "evidence": evidence(f"Explicit source value for {field_path}.", **location),
    }


def directly_supplied(
    field_path: str,
    value: object,
    **location: object,
) -> dict[str, object]:
    return {
        "field_path": field_path,
        "value": value,
        "provenance": "directly_supplied",
        "evidence": evidence(f"Recruiter supplied {field_path}.", **location),
    }


def suggested(field_path: str, value: object, explanation: str) -> dict[str, object]:
    return {
        "field_path": field_path,
        "value": value,
        "provenance": "suggested_inference",
        "evidence": [],
        "explanation": explanation,
    }


def response(
    *,
    fields: list[dict[str, object]] | None = None,
    conflicts: list[dict[str, object]] | None = None,
    missing_fields: list[dict[str, object]] | None = None,
    warnings: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "extraction_schema_version": 1,
        "target_listing_schema_version": 3,
        "fields": fields or [],
        "conflicts": conflicts or [],
        "missing_fields": missing_fields or [],
        "warnings": warnings or [],
    }


COMPLETE_CREATOR_JOB = response(
    fields=[
        {
            **extracted("title", "Retention-focused video editor"),
            "provider_confidence": {
                "score": 1.0,
                "label": "provider-reported-high",
            },
        },
        suggested(
            "primary_role_key",
            "video-editor",
            "The described work most closely matches this active role key.",
        ),
        extracted("engagement_type", "one_time_project"),
        extracted("platforms", ["youtube"]),
        extracted("work_mode", "remote"),
        extracted(
            "about_channel",
            "A creator-led education channel publishing useful weekly explainers.",
        ),
        extracted("responsibilities", ["Edit one polished long-form video"]),
        extracted("requirements", ["Strong pacing and narrative judgment"]),
        extracted("start_timeframe", "ASAP"),
        extracted("application_mode", "internal"),
        extracted("compensation_mode", "fixed"),
        extracted("budget_amount", 1200),
        extracted("budget_currency", "USD"),
        extracted("budget_unit", "per video"),
        extracted(
            "deliverables",
            [
                {"type": "long_form_video", "quantity": 1, "frequency": "per_week"},
                {
                    "type": "other",
                    "custom_type": "Sponsor integration cut",
                    "quantity": 1,
                    "frequency": "one_time",
                },
            ],
        ),
        extracted("turnaround_value", 5),
        extracted("turnaround_unit", "business_days"),
        extracted("turnaround_basis", "first_draft"),
        extracted("required_tool_keys", ["premiere-pro"]),
        extracted("other_required_tools", ["Creator Review Rig"]),
        extracted("required_skill_keys", ["video_editing", "storytelling"]),
        extracted("other_required_skills", ["YouTube retention sense"]),
        suggested(
            "content_niches",
            ["Personal finance"],
            "The source context suggests this custom creator niche.",
        ),
    ]
)

VAGUE_ONE_LINE = response(
    fields=[directly_supplied("title", "Need a creator editor")],
    missing_fields=[
        {"field_path": "primary_role_key", "explanation": "No role was explicit."},
        {"field_path": "compensation_mode", "explanation": "No compensation was found."},
    ],
)

SCREENSHOT_DERIVED = response(
    fields=[
        extracted("title", "Short-form editor", screenshot_index=0),
        extracted("platforms", ["youtube", "instagram"], screenshot_index=1),
    ]
)

CONFLICTING_COMPENSATION = response(
    fields=[extracted("title", "Creator video editor")],
    conflicts=[
        {
            "field_path": "budget_amount",
            "values": [
                {"value": 30000, "evidence": evidence("₹30,000 per month.")},
                {"value": 40000, "evidence": evidence("Budget: ₹40,000.")},
            ],
            "explanation": "Two compensation amounts appear in the source.",
        }
    ],
)

MISSING_WORKLOAD = response(
    fields=[
        extracted("title", "Ongoing channel editor"),
        extracted("engagement_type", "ongoing_freelance"),
    ],
    missing_fields=[
        {
            "field_path": "expected_weekly_hours_min",
            "explanation": "Weekly workload is not stated.",
        },
        {
            "field_path": "turnaround_value",
            "explanation": "Turnaround is not stated.",
        },
    ],
)

MULTIPLE_ROLES = response(
    fields=[extracted("title", "All-round creator teammate")],
    conflicts=[
        {
            "field_path": "primary_role_key",
            "values": [
                {"value": "video-editor", "evidence": evidence("Edit weekly videos.")},
                {
                    "value": "thumbnail-designer",
                    "evidence": evidence("Design every thumbnail."),
                },
            ],
            "explanation": "The source combines two distinct primary roles.",
        }
    ],
)

PAID_TRIAL = response(
    fields=[
        extracted("title", "Creator editor with paid trial"),
        extracted("trial_status", "paid"),
        extracted("trial_compensation_amount", 100),
        extracted("trial_compensation_currency", "USD"),
        extracted("trial_compensation_basis", "flat"),
        extracted("trial_work_usage", "evaluation_only"),
        extracted("trial_portfolio_permission", "allowed"),
        extracted("trial_attribution", "credited"),
    ]
)

UNPAID_TRIAL = response(
    fields=[
        extracted("title", "Creator editor with unpaid trial"),
        extracted("trial_status", "unpaid"),
        extracted("unpaid_trial_confirmed", True),
        extracted("trial_work_usage", "evaluation_only"),
        extracted("trial_portfolio_permission", "allowed"),
        extracted("trial_attribution", "credited"),
    ]
)

SENSITIVE_ACCOUNT_ACCESS = response(
    fields=[
        extracted("title", "Channel manager"),
        extracted(
            "source_inputs",
            [{"type": "account_access", "sensitive_access_confirmed": True}],
        ),
    ]
)

EXTERNAL_APPLICATION = response(
    fields=[
        extracted("title", "External application creator editor"),
        extracted("application_mode", "external"),
        extracted("external_apply_url", "https://example.com/apply"),
    ]
)

INVALID_CONTROLLED_TAXONOMY = response(
    fields=[
        extracted("title", "Creator editor"),
        extracted("budget_unit", "per lunar cycle"),
    ]
)

MALFORMED_PROVIDER_OUTPUT: dict[str, Any] = {
    **response(fields=[extracted("title", "Malformed response")]),
    "unexpected_provider_payload": {"tool_call": "not-owned-by-creatorjobs"},
}

UNSUPPORTED_SERVER_FIELD = response(
    fields=[
        extracted("title", "Unsafe provider response"),
        extracted("status", "published"),
    ]
)

HISTORICAL_LANGUAGE_FIELD = response(
    fields=[
        extracted("title", "Language compatibility injection attempt"),
        extracted(
            "language_requirements",
            [
                {
                    "language": "Hindi",
                    "priority": "required",
                    "purposes": ["content_understanding"],
                }
            ],
        ),
    ]
)

REPROCESSED_SOURCE = response(
    fields=[
        extracted("title", "Reprocessed creator editor"),
        extracted("primary_role_key", "video-editor"),
    ],
    warnings=[
        {
            "code": "source.changed",
            "message": "The normalized source changed before this extraction.",
        }
    ],
)


SCENARIOS: dict[str, dict[str, Any]] = {
    "complete_creator_job": COMPLETE_CREATOR_JOB,
    "vague_one_line": VAGUE_ONE_LINE,
    "screenshot_derived": SCREENSHOT_DERIVED,
    "conflicting_compensation": CONFLICTING_COMPENSATION,
    "missing_workload": MISSING_WORKLOAD,
    "multiple_roles": MULTIPLE_ROLES,
    "paid_trial": PAID_TRIAL,
    "unpaid_trial": UNPAID_TRIAL,
    "sensitive_account_access": SENSITIVE_ACCOUNT_ACCESS,
    "external_application_url": EXTERNAL_APPLICATION,
    "invalid_controlled_taxonomy": INVALID_CONTROLLED_TAXONOMY,
    "malformed_provider_output": MALFORMED_PROVIDER_OUTPUT,
    "unsupported_fields": UNSUPPORTED_SERVER_FIELD,
    "historical_language_field": HISTORICAL_LANGUAGE_FIELD,
    "reprocessed_source": REPROCESSED_SOURCE,
}


def scenario(name: str) -> dict[str, Any]:
    return deepcopy(SCENARIOS[name])
