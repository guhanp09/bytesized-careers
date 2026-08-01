"""Development-only processed job-import fixture.

This data exercises the real private review state machine without calling a
provider. It is consumed only by the dev-gated endpoint in ``dev_personas``.
"""

from __future__ import annotations

from app.schemas.job_import import JobImportExtractionResponse

DEVELOPMENT_IMPORT_SCENARIOS = (
    "strong-decisions",
    "thumbnail-designer",
    "clean-import",
    "processing-failure",
)


def processed_review_fixture(
    scenario: str = "strong-decisions",
) -> JobImportExtractionResponse:
    if scenario == "thumbnail-designer":
        return _thumbnail_designer_fixture()
    if scenario == "clean-import":
        return _clean_import_fixture()
    if scenario != "strong-decisions":
        raise ValueError(f"Unsupported development import scenario: {scenario}")
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
                    "field_path": "work_mode",
                    "values": [
                        {
                            "value": "remote",
                            "evidence": [{"snippet": "The role is fully remote."}],
                        },
                        {
                            "value": "hybrid",
                            "evidence": [
                                {"snippet": "Meet the team in Mumbai twice each month."}
                            ],
                        },
                    ],
                    "explanation": "The source describes both remote work and recurring in-person meetings.",
                },
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
                    "field_path": "expected_weekly_hours_min",
                    "explanation": "The ongoing role does not state the weekly workload.",
                },
                {
                    "field_path": "application_mode",
                    "explanation": "The source does not say where candidates should apply.",
                },
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


def _thumbnail_designer_fixture() -> JobImportExtractionResponse:
    return JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": "title",
                    "value": "Thumbnail designer for a science channel",
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "Thumbnail designer for our science channel."}],
                },
                {
                    "field_path": "primary_role_key",
                    "value": "thumbnail-designer",
                    "provenance": "suggested_inference",
                    "evidence": [{"snippet": "Create bold thumbnails for weekly science videos."}],
                    "explanation": "The deliverables most closely match Thumbnail Designer.",
                    "provider_confidence": {"score": 0.74, "label": "medium"},
                },
                {
                    "field_path": "platforms",
                    "value": ["youtube"],
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "weekly YouTube science videos"}],
                },
                {
                    "field_path": "work_mode",
                    "value": "remote",
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "Work remotely from any location."}],
                },
                {
                    "field_path": "engagement_type",
                    "value": "ongoing_freelance",
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "This is an ongoing freelance collaboration."}],
                },
                {
                    "field_path": "about_channel",
                    "value": "An independent science channel making complex ideas approachable through weekly visual explainers.",
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "We make complex science approachable every week."}],
                },
                {
                    "field_path": "responsibilities",
                    "value": ["Design three distinct YouTube thumbnail concepts each week"],
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "Design three thumbnail concepts each week."}],
                },
                {
                    "field_path": "deliverables",
                    "value": [
                        {
                            "type": "thumbnail",
                            "quantity": 3,
                            "frequency": "per_week",
                        }
                    ],
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "Design three thumbnail concepts each week."}],
                },
                {
                    "field_path": "requirements",
                    "value": ["A portfolio showing strong visual hierarchy and curiosity-driven concepts"],
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "Share a portfolio with strong visual hierarchy."}],
                },
                {
                    "field_path": "start_timeframe",
                    "value": "Within 2 weeks",
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "We hope to start within two weeks."}],
                },
                {
                    "field_path": "application_mode",
                    "value": "internal",
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "Apply on CreatorJobs with your portfolio."}],
                },
                {
                    "field_path": "compensation_mode",
                    "value": "fixed",
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "$150 per thumbnail."}],
                },
                {
                    "field_path": "budget_amount",
                    "value": 150,
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "$150 per thumbnail."}],
                },
                {
                    "field_path": "budget_currency",
                    "value": "USD",
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "$150"}],
                },
                {
                    "field_path": "budget_unit",
                    "value": "per thumbnail",
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "per thumbnail"}],
                },
                {
                    "field_path": "turnaround_value",
                    "value": 2,
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "First concepts are due within two business days."}],
                },
                {
                    "field_path": "turnaround_unit",
                    "value": "business_days",
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "within two business days"}],
                },
                {
                    "field_path": "turnaround_basis",
                    "value": "first_draft",
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "First concepts are due"}],
                },
                {
                    "field_path": "source_inputs",
                    "value": [
                        {"type": "creative_brief"},
                        {"type": "thumbnail_assets"},
                    ],
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "We provide the brief, stills and brand assets."}],
                },
                {
                    "field_path": "trial_status",
                    "value": "none",
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "There is no design test."}],
                },
            ],
            "missing_fields": [
                {
                    "field_path": "revision_policy",
                    "explanation": "The number of thumbnail revisions is not stated.",
                },
                {
                    "field_path": "reference_videos",
                    "explanation": "No reference channel or thumbnail examples were included.",
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


def _clean_import_fixture() -> JobImportExtractionResponse:
    return JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {"field_path": "title", "value": "Content strategist for an education brand", "provenance": "extracted_from_source", "evidence": [{"snippet": "Content strategist for our education brand."}]},
                {"field_path": "primary_role_key", "value": "content-strategist", "provenance": "directly_supplied", "evidence": [{"snippet": "Content strategist"}]},
                {"field_path": "platforms", "value": ["youtube", "instagram"], "provenance": "directly_supplied", "evidence": [{"snippet": "YouTube and Instagram"}]},
                {"field_path": "work_mode", "value": "remote", "provenance": "directly_supplied", "evidence": [{"snippet": "Remote within India."}]},
                {"field_path": "engagement_type", "value": "full_time", "provenance": "directly_supplied", "evidence": [{"snippet": "Full-time position."}]},
                {"field_path": "expected_weekly_hours_min", "value": 40, "provenance": "directly_supplied", "evidence": [{"snippet": "40 hours each week."}]},
                {"field_path": "about_channel", "value": "A growing education brand helping early-career professionals learn practical business and technology skills.", "provenance": "extracted_from_source", "evidence": [{"snippet": "We teach practical business and technology skills."}]},
                {"field_path": "responsibilities", "value": ["Own the multi-platform content strategy", "Turn audience insights into monthly programming plans"], "provenance": "extracted_from_source", "evidence": [{"snippet": "Own strategy and monthly programming."}]},
                {"field_path": "requirements", "value": ["Experience translating audience research into creator-led programming"], "provenance": "extracted_from_source", "evidence": [{"snippet": "Translate audience research into creator-led programming."}]},
                {"field_path": "start_timeframe", "value": "Within 1 month", "provenance": "directly_supplied", "evidence": [{"snippet": "Start within one month."}]},
                {"field_path": "application_mode", "value": "internal", "provenance": "directly_supplied", "evidence": [{"snippet": "Apply through CreatorJobs."}]},
                {"field_path": "deadline_at", "value": "2035-12-01T12:00:00Z", "provenance": "directly_supplied", "evidence": [{"snippet": "Applications close 1 December 2035."}]},
                {"field_path": "compensation_mode", "value": "range", "provenance": "extracted_from_source", "evidence": [{"snippet": "INR 90,000–120,000 per month."}]},
                {"field_path": "budget_amount", "value": 90000, "provenance": "extracted_from_source", "evidence": [{"snippet": "INR 90,000"}]},
                {"field_path": "budget_max", "value": 120000, "provenance": "extracted_from_source", "evidence": [{"snippet": "120,000"}]},
                {"field_path": "budget_currency", "value": "INR", "provenance": "extracted_from_source", "evidence": [{"snippet": "INR"}]},
                {"field_path": "budget_unit", "value": "per month", "provenance": "extracted_from_source", "evidence": [{"snippet": "per month"}]},
                {"field_path": "trial_status", "value": "none", "provenance": "directly_supplied", "evidence": [{"snippet": "No trial assignment."}]},
                {"field_path": "creative_autonomy", "value": "own_creative_approach", "provenance": "directly_supplied", "evidence": [{"snippet": "You will own the creative approach."}]},
                {"field_path": "source_inputs", "value": [{"type": "creative_brief"}], "provenance": "directly_supplied", "evidence": [{"snippet": "A creative brief will be provided for each planning cycle."}]},
                {"field_path": "hiring_process", "value": [{"stage": "application_review"}, {"stage": "interview"}, {"stage": "offer"}], "provenance": "directly_supplied", "evidence": [{"snippet": "Application review, interview, then offer."}]},
            ],
            "warnings": [
                {
                    "code": "development_fixture",
                    "message": "This local example contains demonstration data only.",
                }
            ],
        }
    )
