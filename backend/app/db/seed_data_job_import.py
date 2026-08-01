"""Development-only processed job-import fixture.

This data exercises the real private review state machine without calling a
provider. It is consumed only by the dev-gated endpoint in ``dev_personas``.
"""

from __future__ import annotations

from app.schemas.job_import import JobImportExtractionResponse


def processed_review_fixture() -> JobImportExtractionResponse:
    return JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": "title",
                    "value": "YouTube video editor for a finance creator",
                    "provenance": "extracted_from_source",
                    "evidence": [
                        {
                            "snippet": "Hiring a YouTube video editor for our finance channel."
                        }
                    ],
                },
                {
                    "field_path": "primary_role_key",
                    "value": "video-editor",
                    "provenance": "suggested_inference",
                    "evidence": [
                        {
                            "snippet": "Hiring a YouTube video editor for our finance channel."
                        }
                    ],
                    "explanation": "The responsibilities most closely match the Video Editor role.",
                    "provider_confidence": {"score": 0.7, "label": "medium"},
                },
                {
                    "field_path": "platforms",
                    "value": ["youtube"],
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "our finance YouTube channel"}],
                },
                {
                    "field_path": "work_mode",
                    "value": "remote",
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "The role is fully remote."}],
                },
                {
                    "field_path": "engagement_type",
                    "value": "ongoing_freelance",
                    "provenance": "suggested_inference",
                    "explanation": "Weekly delivery suggests an ongoing freelance engagement.",
                },
                {
                    "field_path": "about_channel",
                    "value": (
                        "A creator-led personal finance channel publishing practical "
                        "weekly explainers for early-career audiences."
                    ),
                    "provenance": "extracted_from_source",
                    "evidence": [
                        {
                            "snippet": (
                                "We publish practical personal finance explainers every week."
                            )
                        }
                    ],
                },
                {
                    "field_path": "responsibilities",
                    "value": [
                        "Edit one polished 8–12 minute video each week",
                        "Build a clear narrative with supporting motion graphics",
                    ],
                    "provenance": "extracted_from_source",
                    "evidence": [
                        {
                            "snippet": (
                                "Edit one 8–12 minute weekly video and add supporting motion graphics."
                            )
                        }
                    ],
                },
                {
                    "field_path": "requirements",
                    "value": [
                        "Strong pacing and storytelling judgment",
                        "Experience editing creator-led educational content",
                    ],
                    "provenance": "extracted_from_source",
                    "evidence": [
                        {
                            "snippet": (
                                "You should understand pacing, storytelling, and educational content."
                            )
                        }
                    ],
                },
                {
                    "field_path": "start_timeframe",
                    "value": "ASAP",
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "Looking to start as soon as possible."}],
                },
                {
                    "field_path": "application_mode",
                    "value": "internal",
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "Apply through CreatorJobs."}],
                },
                {
                    "field_path": "compensation_mode",
                    "value": "range",
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "Budget is ₹30,000–₹40,000 per month."}],
                },
                {
                    "field_path": "budget_currency",
                    "value": "INR",
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "₹30,000–₹40,000"}],
                },
                {
                    "field_path": "budget_max",
                    "value": 40000,
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "Budget is ₹30,000–₹40,000 per month."}],
                },
                {
                    "field_path": "budget_unit",
                    "value": "per month",
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "per month"}],
                },
                {
                    "field_path": "expected_weekly_hours_min",
                    "value": 15,
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "Expect around 15–20 hours each week."}],
                },
                {
                    "field_path": "expected_weekly_hours_max",
                    "value": 20,
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "Expect around 15–20 hours each week."}],
                },
                {
                    "field_path": "required_tool_keys",
                    "value": ["premiere-pro", "after-effects"],
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "Premiere Pro and After Effects are required."}],
                },
                {
                    "field_path": "trial_status",
                    "value": "paid",
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "The shortlisted editor will complete a paid test."}],
                },
                {
                    "field_path": "trial_compensation_amount",
                    "value": 2500,
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "The test is paid at ₹2,500."}],
                },
                {
                    "field_path": "trial_compensation_currency",
                    "value": "INR",
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "₹2,500"}],
                },
                {
                    "field_path": "trial_compensation_basis",
                    "value": "flat",
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "The test has a flat payment of ₹2,500."}],
                },
                {
                    "field_path": "trial_work_usage",
                    "value": "evaluation_only",
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "The test is for evaluation only."}],
                },
                {
                    "field_path": "trial_portfolio_permission",
                    "value": "allowed",
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "You may include the test in your portfolio."}],
                },
                {
                    "field_path": "trial_attribution",
                    "value": "credited",
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "Published test work will be credited."}],
                },
            ],
            "conflicts": [
                {
                    "field_path": "budget_amount",
                    "values": [
                        {
                            "value": 30000,
                            "evidence": [{"snippet": "Budget starts at ₹30,000."}],
                        },
                        {
                            "value": 35000,
                            "evidence": [{"snippet": "Base monthly budget: ₹35,000."}],
                        },
                    ],
                    "explanation": "Two different base amounts appear in the source.",
                }
            ],
            "missing_fields": [
                {
                    "field_path": "deadline_at",
                    "explanation": "No application deadline was included.",
                },
                {
                    "field_path": "turnaround_value",
                    "explanation": "A first-draft turnaround was not stated.",
                },
            ],
            "warnings": [
                {
                    "code": "development_fixture",
                    "message": "This local example contains demonstration data only.",
                }
            ],
        }
    )
