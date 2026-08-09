from __future__ import annotations

import logging
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from app.core.job_application_instructions import contains_external_routing
from app.core.job_domain_taxonomy import OUTPUT_COMPENSATION_UNITS
from app.core.job_taxonomy import (
    COMPENSATION_UNITS,
    CURRENT_LISTING_SCHEMA_VERSION,
    OTHER_CREATOR_ROLE_SLUG,
    P0_LISTING_SCHEMA_VERSION,
    legacy_category_for_role_slug,
)
from app.core.tool_catalog import TOOL_CATALOG, find_tool, find_tool_by_key
from app.models import HiringIdentity, Job
from app.notifications import dispatch_notification
from app.repositories.job_repository import JobRepository
from app.schemas import JobCreate, JobUpdate

logger = logging.getLogger(__name__)


class JobNotFoundError(Exception):
    pass


class JobValidationError(Exception):
    def __init__(self, field_errors: dict[str, list[str]], message: str = "This job is not ready to publish."):
        super().__init__(message)
        self.field_errors = field_errors
        self.message = message

    def as_detail(self) -> dict[str, object]:
        return {
            "code": "JOB_PUBLISH_VALIDATION_FAILED",
            "message": self.message,
            "field_errors": self.field_errors,
        }


class JobAuthRequiredError(Exception):
    pass


class JobForbiddenError(Exception):
    pass


class JobVerificationRequiredError(Exception):
    pass


class JobService:
    def __init__(self, repository: JobRepository):
        self.repository = repository

    @staticmethod
    def _to_payload(data: dict[str, Any]) -> dict[str, Any]:
        payload = dict(data)
        if "reference_videos" in payload and payload["reference_videos"] is not None:
            normalized_reference_videos: list[str | dict[str, Any]] = []
            for item in payload["reference_videos"]:
                if isinstance(item, str):
                    normalized_reference_videos.append(str(item))
                    continue

                if isinstance(item, dict):
                    url = item.get("url")
                    if not url:
                        continue
                    normalized_item: dict[str, Any] = {"url": str(url)}
                    for key in ("id", "title", "platform", "description", "what_to_reference"):
                        value = item.get(key)
                        if isinstance(value, str) and value.strip():
                            normalized_item[key] = " ".join(value.split())
                    thumbnail_url = item.get("thumbnail_url")
                    if thumbnail_url:
                        normalized_item["thumbnail_url"] = str(thumbnail_url)
                    timestamp_notes = item.get("timestamp_notes")
                    if isinstance(timestamp_notes, list):
                        normalized_notes: list[dict[str, Any]] = []
                        for note in timestamp_notes[:8]:
                            if not isinstance(note, dict):
                                continue
                            seconds = note.get("seconds")
                            title = note.get("title")
                            time = note.get("time")
                            if not isinstance(seconds, int) or seconds < 0 or not isinstance(title, str) or not title.strip():
                                continue
                            normalized_notes.append(
                                {
                                    "id": note.get("id") if isinstance(note.get("id"), str) else None,
                                    "time": str(time).strip() if time else str(seconds),
                                    "seconds": seconds,
                                    "title": " ".join(title.split())[:60],
                                    "description": " ".join(str(note.get("description") or "").split())[:220],
                                }
                            )
                        normalized_item["timestamp_notes"] = normalized_notes
                    normalized_reference_videos.append(normalized_item)
                    continue

                url = getattr(item, "url", None)
                if url is None:
                    continue
                normalized_item = {"url": str(url)}
                for key in ("id", "title", "platform", "description", "what_to_reference"):
                    value = getattr(item, key, None)
                    if isinstance(value, str) and value.strip():
                        normalized_item[key] = " ".join(value.split())
                thumbnail_url = getattr(item, "thumbnail_url", None)
                if thumbnail_url:
                    normalized_item["thumbnail_url"] = str(thumbnail_url)
                timestamp_notes = getattr(item, "timestamp_notes", None)
                if isinstance(timestamp_notes, list):
                    normalized_item["timestamp_notes"] = [note.model_dump() for note in timestamp_notes[:8]]
                normalized_reference_videos.append(normalized_item)

            payload["reference_videos"] = normalized_reference_videos
        if "channel_logo_url" in payload and payload["channel_logo_url"] is not None:
            payload["channel_logo_url"] = str(payload["channel_logo_url"])
        if "external_apply_url" in payload and payload["external_apply_url"] is not None:
            payload["external_apply_url"] = str(payload["external_apply_url"])
        return payload

    @staticmethod
    def _clean_unique(values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        cleaned: list[str] = []
        seen: set[str] = set()
        for value in values:
            normalized = " ".join(str(value).split())
            if not normalized or normalized.casefold() in seen:
                continue
            seen.add(normalized.casefold())
            cleaned.append(normalized)
        return cleaned

    @classmethod
    def _tools_from_legacy(cls, values: list[str] | None) -> tuple[list[str] | None, list[str] | None]:
        if values is None:
            return None, None
        selected_keys: set[str] = set()
        custom: list[str] = []
        seen_custom: set[str] = set()
        for value in cls._clean_unique(values) or []:
            entry = find_tool(value)
            if entry is not None:
                selected_keys.add(entry.key)
                continue
            folded = value.casefold()
            if folded not in seen_custom:
                seen_custom.add(folded)
                custom.append(value)
        keys = [entry.key for entry in TOOL_CATALOG if entry.key in selected_keys]
        return keys, custom

    @classmethod
    def _normalize_tools(cls, data: dict[str, Any], *, supplied_fields: set[str] | None = None) -> None:
        supplied = supplied_fields if supplied_fields is not None else set(data)
        has_legacy = "tools" in supplied
        has_canonical = "required_tool_keys" in supplied or "other_required_tools" in supplied
        if not has_legacy and not has_canonical:
            data.pop("tools", None)
            data.pop("required_tool_keys", None)
            data.pop("other_required_tools", None)
            return
        legacy_keys: list[str] | None = None
        legacy_custom: list[str] | None = None
        if has_legacy:
            legacy_keys, legacy_custom = cls._tools_from_legacy(data.get("tools"))

        if has_canonical:
            raw_keys = cls._clean_unique(data.get("required_tool_keys"))
            unknown_keys = [key for key in raw_keys or [] if find_tool_by_key(key) is None]
            if unknown_keys:
                raise JobValidationError(
                    {"required_tool_keys": [f"Unknown tool key: {key}" for key in unknown_keys]},
                    "The supplied job fields are invalid.",
                )
            selected_keys = {
                entry.key for key in raw_keys or [] if (entry := find_tool_by_key(key)) is not None
            }
            canonical_keys = [entry.key for entry in TOOL_CATALOG if entry.key in selected_keys]
            canonical_custom = cls._clean_unique(data.get("other_required_tools"))
            if has_legacy and (
                legacy_keys != canonical_keys
                or {value.casefold() for value in legacy_custom or []}
                != {value.casefold() for value in canonical_custom or []}
            ):
                raise JobValidationError(
                    {"tools": ["Legacy and canonical tool fields describe different selections."]},
                    "The supplied job fields are invalid.",
                )
            data["required_tool_keys"] = canonical_keys if raw_keys is not None else None
            data["other_required_tools"] = canonical_custom
        elif has_legacy:
            data["required_tool_keys"] = legacy_keys
            data["other_required_tools"] = legacy_custom
        data.pop("tools", None)

    async def _apply_primary_role(self, data: dict[str, Any], *, existing_job: Job | None) -> None:
        if "primary_role_id" not in data:
            return
        role_id = data.get("primary_role_id")
        if role_id is None:
            data["primary_role_name_snapshot"] = None
            if existing_job is None or existing_job.listing_schema_version >= P0_LISTING_SCHEMA_VERSION:
                data["category"] = None
            return
        role = await self.repository.get_active_role_by_id(role_id)
        if role is None:
            raise JobValidationError(
                {"primary_role_id": ["Select an active creator role."]},
                "The supplied job fields are invalid.",
            )
        data["primary_role_name_snapshot"] = role.name
        if existing_job is None or existing_job.listing_schema_version >= P0_LISTING_SCHEMA_VERSION:
            legacy_category = legacy_category_for_role_slug(role.slug)
            supplied_category = data.get("category")
            if supplied_category is not None and supplied_category != legacy_category:
                raise JobValidationError(
                    {"category": ["Legacy category conflicts with the selected creator role."]},
                    "The supplied job fields are invalid.",
                )
            data["category"] = legacy_category

    @staticmethod
    def _add_error(errors: dict[str, list[str]], field: str, message: str) -> None:
        errors.setdefault(field, []).append(message)

    def _validate_domain_structure(self, data: dict[str, Any]) -> None:
        errors: dict[str, list[str]] = {}

        required_keys = set(data.get("required_skill_keys") or [])
        preferred_keys = set(data.get("preferred_skill_keys") or [])
        duplicate_keys = sorted(required_keys & preferred_keys)
        if duplicate_keys:
            self._add_error(
                errors,
                "preferred_skill_keys",
                "A controlled skill cannot be both required and preferred.",
            )
        required_custom = {
            str(value).casefold() for value in data.get("other_required_skills") or []
        }
        preferred_custom = {
            str(value).casefold() for value in data.get("other_preferred_skills") or []
        }
        if required_custom & preferred_custom:
            self._add_error(
                errors,
                "other_preferred_skills",
                "A custom skill cannot be both required and preferred.",
            )

        revision_policy = data.get("revision_policy")
        revision_rounds = data.get("revision_rounds")
        if revision_rounds is not None and revision_policy != "fixed":
            self._add_error(
                errors,
                "revision_rounds",
                "Revision rounds are only valid with a fixed revision policy.",
            )

        start_timing = data.get("start_timing")
        start_date = data.get("start_date")
        if start_date is not None and start_timing != "specific_date":
            self._add_error(
                errors,
                "start_date",
                "A start date is only valid when start timing is specific date.",
            )

        duration_type = data.get("duration_type")
        duration_value = data.get("duration_value")
        duration_unit = data.get("duration_unit")
        engagement_end_date = data.get("engagement_end_date")
        if (duration_value is not None or duration_unit is not None) and duration_type != "fixed_period":
            self._add_error(
                errors,
                "duration_value",
                "Duration value and unit are only valid for a fixed period.",
            )
        if engagement_end_date is not None and duration_type != "until_date":
            self._add_error(
                errors,
                "engagement_end_date",
                "An engagement end date is only valid for until-date work.",
            )
        if duration_type == "ongoing" and data.get("engagement_type") == "one_time_project":
            self._add_error(
                errors,
                "duration_type",
                "A one-time project cannot have an ongoing duration.",
            )
        if start_date is not None and engagement_end_date is not None and engagement_end_date <= start_date:
            self._add_error(
                errors,
                "engagement_end_date",
                "Engagement end date must be after the start date.",
            )

        trial_status = data.get("trial_status")
        trial_detail_fields = (
            "trial_scope",
            "trial_effort_value",
            "trial_effort_unit",
            "trial_compensation_amount",
            "trial_compensation_currency",
            "trial_compensation_basis",
            "trial_work_usage",
            "trial_portfolio_permission",
            "trial_attribution",
            "unpaid_trial_confirmed",
        )
        supplied_trial_details = [field for field in trial_detail_fields if data.get(field) is not None]
        if trial_status in {None, "none", "undecided"} and supplied_trial_details:
            self._add_error(
                errors,
                "trial_status",
                "Trial details require a paid or unpaid trial status.",
            )
        if trial_status == "unpaid" and any(
            data.get(field) is not None
            for field in (
                "trial_compensation_amount",
                "trial_compensation_currency",
                "trial_compensation_basis",
            )
        ):
            self._add_error(
                errors,
                "trial_compensation_amount",
                "Unpaid trials cannot include compensation fields.",
            )
        if trial_status == "paid" and data.get("unpaid_trial_confirmed") is not None:
            self._add_error(
                errors,
                "unpaid_trial_confirmed",
                "Unpaid-trial confirmation is only valid for an unpaid trial.",
            )

        if errors:
            raise JobValidationError(errors, "The supplied job fields are invalid.")

    def _validate_domain_for_publication(self, data: dict[str, Any]) -> None:
        errors: dict[str, list[str]] = {}

        # Imported wording is sanitised on the way in, which covers the source's
        # own instructions but not the recruiter's. Someone can still type "send
        # your portfolio to us on WhatsApp" into the public note, and until this
        # ran, publishing it worked — the listing then told candidates to apply
        # somewhere CreatorJobs cannot see, record or protect them in.
        #
        # This is the server's decision, not the form's. A stale client, a
        # hand-built request or an old draft all arrive here, so refusing here is
        # what actually makes the rule true.
        #
        # The text is never rewritten. It stays in the private draft exactly as
        # written, because prose someone typed is theirs to edit; the publish is
        # what gets refused, with the offending phrase named.
        routing = contains_external_routing(data.get("how_to_apply"))
        if routing is not None:
            self._add_error(
                errors,
                "how_to_apply",
                "Applications are handled through CreatorJobs. Keep the requested "
                "materials, but remove the WhatsApp, email, phone number or "
                f"external submission destination ({routing.strip()}).",
            )

        if data.get("budget_unit") in OUTPUT_COMPENSATION_UNITS and not data.get("deliverables"):
            self._add_error(
                errors,
                "deliverables",
                "Add at least one structured deliverable for output-based compensation.",
            )

        if data.get("revision_policy") == "fixed" and data.get("revision_rounds") is None:
            self._add_error(errors, "revision_rounds", "Add the number of included revision rounds.")

        start_timing = data.get("start_timing")
        start_date = data.get("start_date")
        if start_timing == "specific_date" and start_date is None:
            self._add_error(errors, "start_date", "Add the specific start date.")
        if start_date is not None and start_date < datetime.now(UTC).date():
            self._add_error(errors, "start_date", "Start date cannot be in the past.")

        duration_type = data.get("duration_type")
        if duration_type == "fixed_period" and (
            data.get("duration_value") is None or data.get("duration_unit") is None
        ):
            self._add_error(
                errors,
                "duration_value",
                "Add both the value and unit for a fixed engagement period.",
            )
        if duration_type == "until_date" and data.get("engagement_end_date") is None:
            self._add_error(errors, "engagement_end_date", "Add the engagement end date.")
        if data.get("engagement_type") == "fixed_term" and duration_type not in {
            "fixed_period",
            "until_date",
        }:
            self._add_error(
                errors,
                "duration_type",
                "Fixed-term work requires a fixed period or end date.",
            )

        trial_status = data.get("trial_status")
        if trial_status in {"paid", "unpaid"}:
            for field, message in (
                ("trial_scope", "Describe the trial scope."),
                ("trial_effort_value", "Add the expected trial effort."),
                ("trial_effort_unit", "Select the trial effort unit."),
                ("trial_work_usage", "State how the trial work may be used."),
                ("trial_portfolio_permission", "State whether portfolio use is allowed."),
                ("trial_attribution", "State the trial attribution terms."),
            ):
                if data.get(field) is None:
                    self._add_error(errors, field, message)
        if trial_status == "paid":
            for field, message in (
                ("trial_compensation_amount", "Add the paid-trial compensation amount."),
                ("trial_compensation_currency", "Add the paid-trial compensation currency."),
                ("trial_compensation_basis", "Select the paid-trial compensation basis."),
            ):
                if data.get(field) is None:
                    self._add_error(errors, field, message)
            if data.get("trial_compensation_basis") == "custom" and not data.get("trial_notes"):
                self._add_error(errors, "trial_notes", "Describe the custom trial compensation basis.")
        if trial_status == "unpaid" and data.get("unpaid_trial_confirmed") is not True:
            self._add_error(
                errors,
                "unpaid_trial_confirmed",
                "Explicitly confirm that this is an unpaid trial.",
            )

        stages = [stage.get("stage") for stage in data.get("hiring_process") or []]
        if "paid_trial" in stages and trial_status != "paid":
            self._add_error(errors, "hiring_process", "A paid-trial stage requires paid trial terms.")
        if "unpaid_trial" in stages and trial_status != "unpaid":
            self._add_error(errors, "hiring_process", "An unpaid-trial stage requires unpaid trial terms.")

        if errors:
            raise JobValidationError(errors)

    async def _validate_for_publication(
        self, data: dict[str, Any], *, target_schema_version: int
    ) -> None:
        errors: dict[str, list[str]] = {}
        title = str(data.get("title") or "").strip()
        if len(title) < 3:
            self._add_error(errors, "title", "Enter a job title with at least 3 characters.")

        role = None
        role_id = data.get("primary_role_id")
        if role_id is None:
            self._add_error(errors, "primary_role_id", "Select a creator role.")
        else:
            role = await self.repository.get_active_role_by_id(role_id)
            if role is None:
                self._add_error(errors, "primary_role_id", "Select an active creator role.")
            elif role.slug == OTHER_CREATOR_ROLE_SLUG and not str(data.get("role_specialization") or "").strip():
                self._add_error(errors, "role_specialization", "Describe the creator role.")

        engagement = data.get("engagement_type")
        if not engagement:
            self._add_error(errors, "engagement_type", "Select an engagement type.")
        if not data.get("platforms"):
            self._add_error(errors, "platforms", "Select at least one platform.")

        work_mode = str(data.get("work_mode") or "").lower()
        if work_mode not in {"remote", "hybrid", "onsite"}:
            self._add_error(errors, "work_mode", "Select remote, hybrid, or onsite.")
        elif work_mode in {"hybrid", "onsite"} and not str(data.get("location") or "").strip():
            self._add_error(errors, "location", "Add a location for hybrid or onsite work.")

        if len(str(data.get("about_channel") or "").strip()) < 20:
            self._add_error(errors, "about_channel", "Add at least 20 characters about the channel or employer.")
        if not data.get("responsibilities"):
            self._add_error(errors, "responsibilities", "Add at least one responsibility.")
        if not data.get("requirements"):
            self._add_error(errors, "requirements", "Add at least one requirement.")
        if not str(data.get("start_timeframe") or "").strip() and not data.get("start_timing"):
            self._add_error(errors, "start_timeframe", "Select a start timeframe.")

        application_mode = data.get("application_mode")
        if application_mode not in {"internal", "external"}:
            self._add_error(errors, "application_mode", "Select an application mode.")
        elif application_mode == "external" and not str(data.get("external_apply_url") or "").strip():
            self._add_error(errors, "external_apply_url", "Add the external application URL.")

        deadline = data.get("deadline_at")
        if deadline is not None:
            comparable_deadline = deadline.replace(tzinfo=UTC) if deadline.tzinfo is None else deadline.astimezone(UTC)
            if comparable_deadline <= datetime.now(UTC):
                self._add_error(errors, "deadline_at", "Application deadline must be in the future.")

        mode = data.get("compensation_mode")
        unit = data.get("budget_unit")
        amount = data.get("budget_amount")
        maximum = data.get("budget_max")
        currency = str(data.get("budget_currency") or "").strip()
        note = str(data.get("budget_note") or "").strip()
        if mode not in {"fixed", "range", "negotiable"}:
            self._add_error(errors, "compensation_mode", "Select fixed, range, or negotiable compensation.")
        if unit not in COMPENSATION_UNITS:
            self._add_error(errors, "budget_unit", "Select a supported compensation unit.")
        if mode == "fixed":
            if amount is None or Decimal(amount) <= 0:
                self._add_error(errors, "budget_amount", "Enter a positive compensation amount.")
            if maximum is not None:
                self._add_error(errors, "budget_max", "Fixed compensation cannot include a maximum.")
        elif mode == "range":
            if amount is None and maximum is None:
                self._add_error(errors, "budget_max", "Enter at least one end of the compensation range.")
            elif amount is not None and maximum is not None and Decimal(maximum) < Decimal(amount):
                self._add_error(errors, "budget_max", "Maximum must be at least the minimum.")
        elif mode == "negotiable" and (amount is not None or maximum is not None):
            self._add_error(errors, "budget_amount", "Negotiable compensation cannot include fixed amounts.")
        if mode in {"fixed", "range"} and not currency:
            self._add_error(errors, "budget_currency", "Select a compensation currency.")
        if mode == "negotiable" and unit not in {"commission", "mixed"} and not currency:
            self._add_error(errors, "budget_currency", "Select a compensation currency.")
        if unit in {"commission", "mixed"} and not note:
            self._add_error(errors, "budget_note", "Describe the commission or mixed compensation terms.")
        if unit == "custom" and not str(data.get("budget_unit_custom") or "").strip():
            self._add_error(errors, "budget_unit_custom", "Describe the custom compensation unit.")

        weekly_min = data.get("expected_weekly_hours_min")
        weekly_max = data.get("expected_weekly_hours_max")
        if weekly_max is not None and weekly_min is None:
            self._add_error(errors, "expected_weekly_hours_min", "Add minimum weekly hours when a maximum is set.")
        if weekly_min is not None and weekly_max is not None and Decimal(weekly_max) < Decimal(weekly_min):
            self._add_error(errors, "expected_weekly_hours_max", "Maximum weekly hours must be at least the minimum.")
        has_turnaround = all(
            data.get(field) is not None for field in ("turnaround_value", "turnaround_unit", "turnaround_basis")
        )
        if engagement in {"part_time", "full_time", "fixed_term", "internship"} and weekly_min is None:
            self._add_error(errors, "expected_weekly_hours_min", "Add expected weekly hours for this engagement.")
        if engagement == "one_time_project" and not has_turnaround:
            self._add_error(errors, "turnaround_value", "Add complete turnaround expectations.")
        if engagement in {"ongoing_freelance", "retainer"} and weekly_min is None and not has_turnaround:
            self._add_error(errors, "expected_weekly_hours_min", "Add weekly hours or turnaround expectations.")

        if data.get("posted_by_user_id") is None:
            self._add_error(errors, "owner", "An authenticated owner is required to publish.")
        if errors:
            raise JobValidationError(errors)
        if target_schema_version >= CURRENT_LISTING_SCHEMA_VERSION:
            self._validate_domain_for_publication(data)

    @staticmethod
    def _apply_hiring_identity_snapshot(
        data: dict[str, Any],
        identity: HiringIdentity,
        *,
        default_employer_context: bool = True,
    ) -> None:
        data["hiring_identity_id"] = identity.id
        data["hiring_display_name_snapshot"] = identity.display_name
        data["hiring_platform_snapshot"] = identity.platform
        data["hiring_verification_status_snapshot"] = identity.verification_status
        data["hiring_external_url_snapshot"] = identity.url
        data["managed_by_agency_name_snapshot"] = (
            identity.managed_by_agency_name if identity.is_agency_represented else None
        )
        if default_employer_context and not data.get("employer_context_type"):
            data["employer_context_type"] = (
                "agency" if identity.is_agency_represented else "creator"
            )
        data["channel_name"] = data.get("channel_name") or identity.display_name
        data["channel_logo_url"] = data.get("channel_logo_url") or identity.avatar_url
        data["posted_platform"] = identity.platform.lower()
        data["posted_by_agency"] = bool(identity.is_agency_represented)
        data["is_verified"] = identity.verification_status == "VERIFIED"

    @staticmethod
    def _published_status(value: Any) -> bool:
        return isinstance(value, str) and value.lower() == "published"

    @staticmethod
    def _requires_representation_verification(identity: HiringIdentity | None, status: Any) -> bool:
        return bool(
            identity is not None
            and identity.is_agency_represented
            and identity.verification_status != "VERIFIED"
            and JobService._published_status(status)
        )

    @staticmethod
    def _raise_representation_verification_required() -> None:
        raise JobVerificationRequiredError(
            "This job cannot go live until authorization to hire for this channel/page is verified."
        )

    @staticmethod
    def _public_filter_values(values: list[str] | None) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for raw in values or []:
            for part in raw.split(","):
                value = " ".join(part.split()).casefold()
                if not value or value in seen:
                    continue
                seen.add(value)
                normalized.append(value)
        return normalized

    async def list_jobs(
        self,
        *,
        limit: int,
        offset: int,
        q: str | None,
        role: list[str] | None,
        platform: list[str] | None,
        format_filter: list[str] | None,
        work_mode: list[str] | None,
        engagement_type: list[str] | None,
        budget_unit: list[str] | None,
        language: list[str] | None,
        location: str | None,
        start_timeframe: str | None,
    ) -> tuple[list[Job], int]:
        return await self.repository.list_public_jobs(
            limit=limit,
            offset=offset,
            q=q,
            role_slugs=self._public_filter_values(role),
            platforms=self._public_filter_values(platform),
            formats=self._public_filter_values(format_filter),
            work_modes=self._public_filter_values(work_mode),
            engagement_types=self._public_filter_values(engagement_type),
            budget_units=self._public_filter_values(budget_unit),
            # Language is no longer a public job-discovery dimension. The ``language``
            # query parameter is still accepted so old shared URLs do not error, but it
            # no longer filters results.
            required_languages=[],
            location=location,
            start_timeframe=start_timeframe,
        )

    async def get_public_job(self, job_id: UUID) -> Job:
        job = await self.repository.get_public_by_id(job_id)
        if not job:
            raise JobNotFoundError("Job not found")
        return job

    async def get_job_internal(self, job_id: UUID) -> Job:
        job = await self.repository.get_by_id_internal(job_id)
        if not job:
            raise JobNotFoundError("Job not found")
        return job

    async def prepare_job_create(
        self, payload: JobCreate, *, actor_user_id: UUID | None = None
    ) -> dict[str, Any]:
        """Resolve server-owned create fields and run the real publication contract.

        The development fixture uses this same preparation path before an idempotent
        upsert. Ordinary API callers continue through ``create_job`` below.
        """
        if actor_user_id is None:
            raise JobAuthRequiredError("Authentication required to create a job")
        data = self._to_payload(payload.model_dump())
        data["listing_schema_version"] = CURRENT_LISTING_SCHEMA_VERSION
        self._normalize_tools(data, supplied_fields=set(payload.model_fields_set))
        await self._apply_primary_role(data, existing_job=None)
        # The verified badge is server-derived, never client-supplied: it is set
        # only by _apply_hiring_identity_snapshot below (identity VERIFIED) or by
        # an audited admin decision. A client-sent is_verified is discarded.
        data["is_verified"] = False
        hiring_identity_id = data.get("hiring_identity_id")
        selected_identity: HiringIdentity | None = None
        if hiring_identity_id is not None:
            if actor_user_id is None:
                raise JobAuthRequiredError("Authentication required to post with a hiring identity")
            selected_identity = await self.repository.get_hiring_identity_for_user(
                user_id=actor_user_id,
                identity_id=hiring_identity_id,
            )
            if selected_identity is None:
                raise JobForbiddenError("Selected hiring identity does not belong to this user")
            self._apply_hiring_identity_snapshot(data, selected_identity)
            if self._requires_representation_verification(selected_identity, data.get("status")):
                self._raise_representation_verification_required()

        platforms = [platform.strip().lower() for platform in data.get("platforms", []) if platform]
        posted_platform = (data.get("posted_platform") or "").strip().lower()
        is_youtube_post = "youtube" in platforms or posted_platform == "youtube"

        if is_youtube_post and selected_identity is None:
            posted_youtube_channel_id = (data.get("posted_youtube_channel_id") or "").strip()
            data["posted_platform"] = "youtube"
            if posted_youtube_channel_id:
                if actor_user_id is None:
                    logger.warning("youtube_post_blocked_auth_required")
                    raise JobAuthRequiredError("Authentication required to post as a YouTube channel")
                owns_channel = await self.repository.user_has_youtube_channel(
                    user_id=actor_user_id, channel_id=posted_youtube_channel_id
                )
                if not owns_channel:
                    logger.warning(
                        "youtube_post_blocked_channel_not_linked",
                        extra={
                            "actor_user_id": str(actor_user_id),
                            "posted_youtube_channel_id": posted_youtube_channel_id,
                        },
                    )
                    raise JobForbiddenError("Selected YouTube channel is not linked to this user")
                data["posted_by_user_id"] = actor_user_id
            elif actor_user_id is not None:
                logger.info(
                    "youtube_post_without_linked_channel",
                    extra={"actor_user_id": str(actor_user_id)},
                )
                data["posted_by_user_id"] = actor_user_id
        elif actor_user_id is not None:
            data["posted_by_user_id"] = actor_user_id

        actor_user = await self.repository.get_user_by_id(actor_user_id)
        if actor_user is not None and actor_user.username:
            if selected_identity is not None and selected_identity.is_agency_represented:
                data["agency_profile_slug"] = data.get("agency_profile_slug") or actor_user.username
            elif not data.get("channel_profile_slug"):
                data["channel_profile_slug"] = actor_user.username

        self._validate_domain_structure(data)
        if self._published_status(data.get("status")):
            await self._validate_for_publication(
                data,
                target_schema_version=CURRENT_LISTING_SCHEMA_VERSION,
            )

        return data

    async def create_job(
        self,
        payload: JobCreate,
        *,
        actor_user_id: UUID | None = None,
        commit_transaction: bool = True,
    ) -> Job:
        data = await self.prepare_job_create(payload, actor_user_id=actor_user_id)
        job = await self.repository.create(data)
        if self._published_status(job.status) and job.posted_by_user_id is not None:
            # Best-effort: a notification failure must never block job creation.
            try:
                await dispatch_notification(
                    self.repository.session,
                    event_key="job_posted_successfully",
                    recipient_user_id=job.posted_by_user_id,
                    title="Your job is live",
                    body=f"{job.title} is now published and visible to talent.",
                    category="job",
                    resource_type="job",
                    resource_id=str(job.id),
                    action_url=f"/jobs/{job.id}",
                    payload={"job_title": job.title},
                )
            except Exception:
                logger.exception(
                    "job_posted_notification_failed", extra={"job_id": str(job.id)}
                )
        if commit_transaction:
            await self.repository.session.commit()
        return job

    async def update_job(self, job_id: UUID, payload: JobUpdate) -> Job:
        job = await self.get_job_internal(job_id)
        return await self.update_job_record(job, payload)

    async def update_job_record(
        self, job: Job, payload: JobUpdate, *, actor_user_id: UUID | None = None
    ) -> Job:
        updates = self._to_payload(payload.model_dump(exclude_unset=True))
        self._normalize_tools(updates)
        await self._apply_primary_role(updates, existing_job=job)
        selected_identity: HiringIdentity | None = None
        if "hiring_identity_id" in updates:
            hiring_identity_id = updates.get("hiring_identity_id")
            if hiring_identity_id is None:
                updates["hiring_display_name_snapshot"] = None
                updates["hiring_platform_snapshot"] = None
                updates["hiring_verification_status_snapshot"] = None
                updates["hiring_external_url_snapshot"] = None
                updates["managed_by_agency_name_snapshot"] = None
                updates["is_verified"] = False
            else:
                if actor_user_id is None:
                    raise JobAuthRequiredError("Authentication required to update hiring identity")
                selected_identity = await self.repository.get_hiring_identity_for_user(
                    user_id=actor_user_id,
                    identity_id=hiring_identity_id,
                )
                if selected_identity is None:
                    raise JobForbiddenError("Selected hiring identity does not belong to this user")
                self._apply_hiring_identity_snapshot(
                    updates,
                    selected_identity,
                    default_employer_context=job.employer_context_type is None,
                )
                if selected_identity.is_agency_represented:
                    actor_user = await self.repository.get_user_by_id(actor_user_id)
                    if actor_user is not None and actor_user.username:
                        updates["agency_profile_slug"] = updates.get("agency_profile_slug") or actor_user.username
        elif job.hiring_identity_id is not None and actor_user_id is not None:
            selected_identity = await self.repository.get_hiring_identity_for_user(
                user_id=actor_user_id,
                identity_id=job.hiring_identity_id,
            )

        effective_status = updates.get("status", job.status)
        if self._requires_representation_verification(selected_identity, effective_status):
            self._raise_representation_verification_required()
        if (
            selected_identity is not None
            and "hiring_identity_id" not in updates
            and self._published_status(effective_status)
        ):
            self._apply_hiring_identity_snapshot(
                updates,
                selected_identity,
                default_employer_context=False,
            )

        validation_fields = (
            "title",
            "primary_role_id",
            "primary_role_name_snapshot",
            "role_specialization",
            "engagement_type",
            "platforms",
            "work_mode",
            "location",
            "about_channel",
            "responsibilities",
            "requirements",
            "start_timeframe",
            "application_mode",
            "external_apply_url",
            "deadline_at",
            "compensation_mode",
            "budget_amount",
            "budget_max",
            "budget_currency",
            "budget_unit",
            "budget_unit_custom",
            "budget_note",
            "expected_weekly_hours_min",
            "expected_weekly_hours_max",
            "turnaround_value",
            "turnaround_unit",
            "turnaround_basis",
            "posted_by_user_id",
            "deliverables",
            "required_skill_keys",
            "preferred_skill_keys",
            "other_required_skills",
            "other_preferred_skills",
            "required_skills_note",
            "preferred_skills_note",
            "revision_policy",
            "revision_rounds",
            "revision_notes",
            "source_inputs",
            "source_inputs_notes",
            "creative_autonomy",
            "creative_autonomy_notes",
            "language_requirements",
            "trial_status",
            "trial_scope",
            "trial_effort_value",
            "trial_effort_unit",
            "trial_compensation_amount",
            "trial_compensation_currency",
            "trial_compensation_basis",
            "trial_work_usage",
            "trial_portfolio_permission",
            "trial_attribution",
            "unpaid_trial_confirmed",
            "trial_notes",
            "start_timing",
            "start_date",
            "duration_type",
            "duration_value",
            "duration_unit",
            "engagement_end_date",
            "hiring_process",
            "hiring_process_notes",
            "screening_questions",
            "employer_context_type",
        )
        effective = {field: getattr(job, field, None) for field in validation_fields}
        effective.update(updates)
        self._validate_domain_structure(effective)
        should_validate = self._published_status(effective_status) and (
            job.listing_schema_version >= CURRENT_LISTING_SCHEMA_VERSION
            or not self._published_status(job.status)
        )
        if should_validate:
            await self._validate_for_publication(
                effective,
                target_schema_version=CURRENT_LISTING_SCHEMA_VERSION,
            )
            if job.listing_schema_version < CURRENT_LISTING_SCHEMA_VERSION:
                updates["listing_schema_version"] = CURRENT_LISTING_SCHEMA_VERSION

        if "status" in updates and updates["status"] != job.status:
            now = datetime.now(UTC)
            if updates["status"] == "paused":
                updates["paused_at"] = now
            elif updates["status"] in {"closed", "archived"}:
                updates["closed_at"] = now
            elif updates["status"] == "published":
                updates["paused_at"] = None
                updates["closed_at"] = None

        if updates:
            job = await self.repository.update(job, updates)
            await self.repository.session.commit()
        return job

    async def delete_job(self, job_id: UUID) -> Job:
        job = await self.get_job_internal(job_id)
        return await self.delete_job_record(job)

    async def delete_job_record(self, job: Job) -> Job:
        job = await self.repository.soft_delete(job)
        await self.repository.session.commit()
        return job
