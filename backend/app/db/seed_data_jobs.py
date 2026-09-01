from __future__ import annotations

import json
import uuid
from copy import deepcopy
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

SEED_NAMESPACE = uuid.UUID("9f5068b6-3a5f-4d6a-b2da-7f0e6db31f16")
DEMO_FIXTURE_PATH = Path(__file__).resolve().parents[3] / "fixtures" / "demo_job_marketplace.json"


def _stable_uuid(seed_key: str) -> uuid.UUID:
    return uuid.uuid5(SEED_NAMESPACE, seed_key)


def _fixture() -> dict[str, Any]:
    with DEMO_FIXTURE_PATH.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    if payload.get("version") != 1:
        raise RuntimeError("Unsupported demo job marketplace fixture version")
    return payload


DEMO_MARKETPLACE = _fixture()
DEMO_JOB_SPECS: tuple[dict[str, Any], ...] = tuple(DEMO_MARKETPLACE["jobs"])
DEMO_IDENTITY_SPECS: tuple[dict[str, Any], ...] = tuple(DEMO_MARKETPLACE["identities"])
DEMO_JOB_IDS: tuple[uuid.UUID, ...] = tuple(_stable_uuid(item["key"]) for item in DEMO_JOB_SPECS)

# Older versions of the repository shipped job_25 and job_26. Existing development
# databases may still contain those deterministic fixture rows. The ordinary seed
# command retires them to ``closed`` instead of deleting them, while fresh databases
# receive only the 24 records in the shared fixture.
RETIRED_DEMO_JOB_IDS: tuple[uuid.UUID, ...] = (_stable_uuid("job_25"), _stable_uuid("job_26"))


def demo_user_id(owner_key: str) -> uuid.UUID:
    return _stable_uuid(f"demo-owner:{owner_key}")


def demo_identity_id(identity_key: str) -> uuid.UUID:
    return _stable_uuid(f"demo-identity:{identity_key}")


def demo_users() -> list[dict[str, Any]]:
    by_owner: dict[str, dict[str, Any]] = {}
    for spec in DEMO_IDENTITY_SPECS:
        owner_key = spec["owner_key"]
        by_owner.setdefault(
            owner_key,
            {
                "id": demo_user_id(owner_key),
                "email": spec["email"],
                "username": spec["username"],
                "display_name": spec["owner_name"],
                "account_type": "EMPLOYER",
                "onboarding_intent": "HIRING_CREATOR_TALENT",
                "avatar_mode": "generic",
                "skills": [],
                "public_links": [],
                "profile_experience": [],
                "collaboration_styles": [],
                "hiring_platforms": [],
                "hiring_niches": [],
                "hiring_genres": [],
                "hiring_formats": [],
                "creator_platforms": [],
                "privacy_settings": {
                    "show_bio": True,
                    "show_links": True,
                    "show_skills": True,
                    "show_location": False,
                    "show_availability": False,
                    "show_youtube_badge": True,
                },
            },
        )
    return list(by_owner.values())


def demo_hiring_identities() -> list[dict[str, Any]]:
    now = datetime.now(UTC)
    payloads: list[dict[str, Any]] = []
    for spec in DEMO_IDENTITY_SPECS:
        key = spec["key"]
        verified = spec["verification_status"] == "VERIFIED"
        payloads.append(
            {
                "id": demo_identity_id(key),
                "owner_user_id": demo_user_id(spec["owner_key"]),
                "type": spec["type"],
                "platform": spec["platform"],
                "display_name": spec["display_name"],
                "handle": spec.get("handle"),
                "url": f"https://example.com/creatorjobs-demo/{key}",
                # Demo identities use the client's honest missing-avatar
                # fallback. Random public images are not identity evidence and
                # would make local seeds depend on an unrelated third party.
                "avatar_url": None,
                "description": spec["description"],
                "managed_by_agency_name": spec.get("managed_by_agency_name"),
                "is_agency_represented": spec["type"] == "AGENCY_REPRESENTED_CHANNEL",
                "verification_status": spec["verification_status"],
                "verification_method": "MANUAL_ADMIN_REVIEW" if verified else "NONE",
                "verified_at": now if verified else None,
            }
        )
    return payloads


def _source_inputs(items: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    return [
        {
            "type": item["type"],
            "custom_label": item.get("custom_label"),
            "sensitive_access_confirmed": bool(item.get("sensitive_access_confirmed")),
        }
        for item in items or []
    ]


def _reference(spec: dict[str, Any]) -> list[dict[str, Any]]:
    if not spec.get("reference"):
        return []
    key = spec["key"]
    return [
        {
            "id": f"{key}-reference",
            "title": "Fictional style and workflow reference",
            "url": f"https://example.com/creatorjobs-demo/references/{key}",
            "platform": "Demo reference",
            "description": "A stable non-playable fixture link used only in local development.",
            "what_to_reference": "Use the pacing, hierarchy, or workflow notes in the supplied fictional brief; do not copy creative assets.",
            "timestamp_notes": [
                {
                    "id": f"{key}-reference-opening",
                    "time": "0:00",
                    "seconds": 0,
                    "title": "Opening expectation",
                    "description": "The first beat states the audience promise clearly.",
                },
                {
                    "id": f"{key}-reference-handoff",
                    "time": "0:35",
                    "seconds": 35,
                    "title": "Execution detail",
                    "description": "Use this note to calibrate the requested polish and handoff quality.",
                },
                {
                    "id": f"{key}-reference-finish",
                    "time": "1:10",
                    "seconds": 70,
                    "title": "Finish standard",
                    "description": "This checkpoint documents the expected final delivery quality.",
                },
            ],
        }
    ]


def materialize_job_payload(
    spec: dict[str, Any],
    *,
    identity_spec: dict[str, Any],
    role_id: uuid.UUID,
    now: datetime,
    existing_deadline: datetime | None = None,
    existing_start_date: date | None = None,
) -> dict[str, Any]:
    """Turn a shared semantic fixture row into the ordinary JobCreate contract."""

    compensation = spec["compensation"]
    engagement = spec["engagement"]
    revision = spec["revision"]
    autonomy = spec["autonomy"]
    trial = spec["trial"]
    start = spec["start"]
    application = spec["application"]

    deadline = existing_deadline
    comparable_deadline = (
        deadline.replace(tzinfo=UTC) if deadline is not None and deadline.tzinfo is None else deadline
    )
    if comparable_deadline is None or comparable_deadline <= now + timedelta(days=1):
        deadline = now + timedelta(days=int(spec["deadline_days"]))

    start_date = existing_start_date
    if start.get("timing") == "specific_date" and (start_date is None or start_date < now.date()):
        start_date = (now + timedelta(days=int(start["start_days"]))).date()

    hiring_process = [{"stage": stage} for stage in application.get("process", [])]
    payload: dict[str, Any] = {
        "title": spec["title"],
        "primary_role_id": role_id,
        "role_specialization": spec.get("specialization"),
        "location": (
            None
            if engagement.get("work_mode") == "remote"
            and engagement.get("location") == "Remote"
            else engagement.get("location")
        ),
        "compensation_mode": compensation["mode"],
        "budget_amount": compensation.get("amount"),
        "budget_max": compensation.get("max"),
        "budget_note": compensation.get("note"),
        "budget_currency": compensation.get("currency"),
        "budget_unit": compensation["unit"],
        "budget_unit_custom": compensation.get("custom_unit"),
        "experience_level": spec["experience"],
        "platforms": spec["platforms"],
        "start_timeframe": {
            "immediate": "ASAP",
            "within_two_weeks": "<1mo",
            "specific_date": "<2mo",
            "flexible": "Flexible",
        }[start["timing"]],
        "work_mode": engagement["work_mode"],
        "engagement_type": engagement["type"],
        "timezone_overlap": engagement.get("timezone_overlap"),
        "expected_weekly_hours_min": engagement.get("weekly_min"),
        "expected_weekly_hours_max": engagement.get("weekly_max"),
        "turnaround_value": engagement.get("turnaround_value"),
        "turnaround_unit": engagement.get("turnaround_unit"),
        "turnaround_basis": engagement.get("turnaround_basis"),
        "application_mode": application["mode"],
        "external_apply_url": application.get("external_url"),
        "deadline_at": deadline,
        "start_timing": start["timing"],
        "start_date": start_date,
        "duration_type": start["duration_type"],
        "duration_value": start.get("duration_value"),
        "duration_unit": start.get("duration_unit"),
        "about_channel": spec["about"],
        "responsibilities": spec["responsibilities"],
        "requirements": spec["requirements"],
        "application_requirements": application.get("requirements", []),
        "how_to_apply": application["how_to_apply"],
        "reference_videos": _reference(spec),
        "tags": spec["tags"],
        "languages": [item["language"] for item in spec.get("languages", [])],
        "content_niches": spec["niches"],
        "content_genres": spec["genres"],
        "formats_hired_for": spec["formats"],
        "required_tool_keys": spec.get("required_tools", []),
        "other_required_tools": spec.get("other_required_tools", []),
        "deliverables": deepcopy(spec["deliverables"]),
        "required_skill_keys": spec.get("required_skills", []),
        "preferred_skill_keys": spec.get("preferred_skills", []),
        "other_required_skills": spec.get("required_custom_skills", []),
        "other_preferred_skills": spec.get("preferred_custom_skills", []),
        "required_skills_note": spec.get("required_skills_note"),
        "preferred_skills_note": spec.get("preferred_skills_note"),
        "revision_policy": revision["policy"],
        "revision_rounds": revision.get("rounds"),
        "revision_notes": revision.get("notes"),
        "source_inputs": _source_inputs(spec.get("source_inputs")),
        "source_inputs_notes": spec.get("source_inputs_notes"),
        "creative_autonomy": autonomy["level"],
        "creative_autonomy_notes": autonomy.get("notes"),
        "language_requirements": deepcopy(spec.get("languages", [])),
        "trial_status": trial["status"],
        "trial_scope": trial.get("scope"),
        "trial_effort_value": trial.get("effort_value"),
        "trial_effort_unit": trial.get("effort_unit"),
        "trial_compensation_amount": trial.get("amount"),
        "trial_compensation_currency": trial.get("currency"),
        "trial_compensation_basis": trial.get("basis"),
        "trial_work_usage": trial.get("work_usage"),
        "trial_portfolio_permission": trial.get("portfolio_permission"),
        "trial_attribution": trial.get("attribution"),
        "unpaid_trial_confirmed": trial.get("unpaid_confirmed"),
        "trial_notes": trial.get("notes"),
        "hiring_process": hiring_process,
        "screening_questions": deepcopy(application.get("screening", [])),
        "employer_context_type": identity_spec["employer_context_type"],
        "channel_subscribers": identity_spec["subscribers"],
        "channel_profile_slug": identity_spec["username"],
        "hiring_identity_id": demo_identity_id(identity_spec["key"]),
        "status": spec["status"],
    }
    return payload


def identity_specs_by_key() -> dict[str, dict[str, Any]]:
    return {spec["key"]: spec for spec in DEMO_IDENTITY_SPECS}


def job_specs() -> list[dict[str, Any]]:
    return [deepcopy(spec) for spec in DEMO_JOB_SPECS]


# Compatibility exports used by older focused tests and reset helpers.
_JOB_FIRST_MESSAGE_REQUIREMENTS = {
    spec["key"]: list(spec["application"].get("requirements", [])) for spec in DEMO_JOB_SPECS
}
SEEDED_JOBS = [{"id": _stable_uuid(spec["key"]), "application_requirements": list(spec["application"].get("requirements", []))} for spec in DEMO_JOB_SPECS]
