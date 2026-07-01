from __future__ import annotations

import base64
import binascii
import html
import re
import secrets
import unicodedata
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse, urlunparse
from uuid import UUID

import httpx

from app.core.account_types import is_admin
from app.core.config import settings
from app.models import HiringIdentity, PortfolioItem, User, YouTubeChannel
from app.repositories.auth_repository import AuthRepository
from app.schemas.creator_profile import (
    ContentStyleNichesResponse,
    ContentStyleRead,
    ContentStyleUpsertRequest,
    PortfolioYouTubeCreateRequest,
    ProfileCompletionResponse,
    RoleAnswerSummary,
    RoleQuestionRead,
    RoleQuestionsResponse,
    RoleRead,
    UserRoleAnswerRead,
    UserRoleAnswersUpsertRequest,
    UserRolesUpsertRequest,
)
from app.schemas.hiring_identity import (
    HiringIdentityCreate,
    HiringIdentityRead,
    HiringIdentityUpdate,
    HiringIdentityVerificationRequest,
    HiringIdentityVerificationResponse,
)
from app.schemas.profile import (
    AvatarUploadRequest,
    CollaborationPreferences,
    HiringInfo,
    PortfolioItemCreate,
    PortfolioItemRead,
    PortfolioItemUpdate,
    PortfolioYouTubePreviewResponse,
    PrivacySettings,
    PrivacyUpdateRequest,
    ProfileExperienceItem,
    ProfileRead,
    ProfileStats,
    ProfileUpdateRequest,
    PublicJobItem,
    PublicJobsListResponse,
    PublicPortfolioListResponse,
    PublicProfileResponse,
    PublicRepresentedChannel,
    PublicTalentListingItem,
    PublicYouTubeBadge,
    ReviewsSummary,
    SocialConnections,
    SocialInstagramConnection,
    SocialYouTubeConnection,
)
from app.schemas.profile_capabilities import ProfileCapabilities
from app.services.profile_rules import (
    DEFAULT_PRIVACY_SETTINGS,
    can_change_username,
    normalize_username,
    validate_username_format,
)
from app.services.youtube_service import (
    extract_video_id,
    fetch_youtube_video_metadata,
)

PAST_JOB_STATUSES = {"archived", "closed", "filled", "expired"}
CONTENT_STYLE_PRIMARY_NICHES = [
    "Education",
    "Business",
    "Finance",
    "Technology",
    "Gaming",
    "Lifestyle",
    "Health",
    "Productivity",
    "Entertainment",
    "Marketing",
    "Career",
]
CONTENT_STYLE_FORMAT_OPTIONS = {"Shorts", "Long-form", "Podcast", "Hybrid"}
CONTENT_STYLE_COMPLEXITY_OPTIONS = {"Light", "Moderate", "Advanced"}
HIRING_TYPE_OPTIONS = {
    "individual creator",
    "creator agency",
    "influencer marketing agency",
    "social media agency",
    "brand",
    "production house",
    "other",
}
HIRING_PRIMARY_PLATFORM_OPTIONS = {"YouTube", "Instagram", "Both"}
HIRING_VERIFICATION_STATUS_OPTIONS = {"unverified", "verified", "rejected"}
WORK_MODE_OPTIONS = {"Remote", "Hybrid", "On-site"}
# Cap on additive recruiter list fields to keep payloads/storage bounded.
MAX_HIRING_LIST_ITEMS = 24
MAX_ROLES_PER_USER = 12
MAX_ROLE_NAME_LENGTH = 60
CUSTOM_ROLE_CATEGORY = "Custom"
HIRING_IDENTITY_TYPE_OPTIONS = {"INDIVIDUAL_CHANNEL", "AGENCY_REPRESENTED_CHANNEL"}
HIRING_IDENTITY_PLATFORM_OPTIONS = {"YOUTUBE", "INSTAGRAM"}
HIRING_IDENTITY_CODE_TTL = timedelta(hours=24)
HIRING_IDENTITY_MAX_CODE_CHECKS = 8
HIRING_IDENTITY_PUBLIC_BIO_TIMEOUT = 5.0
HIRING_IDENTITY_PUBLIC_BIO_MAX_CHARS = 2_000_000
HIRING_IDENTITY_ALLOWED_HOSTS = {
    "YOUTUBE": {"youtube.com", "www.youtube.com", "m.youtube.com"},
    "INSTAGRAM": {"instagram.com", "www.instagram.com"},
}
HIRING_IDENTITY_PUBLIC_PAGE_READ_ERROR = (
    "We could not read the public page right now. Try again later or use another verification method."
)
HIRING_IDENTITY_INVALID_PUBLIC_URL_ERROR = "Enter a valid YouTube or Instagram channel/page URL."
HIRING_IDENTITY_UNSUPPORTED_PLATFORM_ERROR = "We cannot verify this platform yet."
AVATAR_UPLOAD_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}
MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_BANNER_UPLOAD_BYTES = 8 * 1024 * 1024


class ProfileValidationError(Exception):
    pass


class ProfileNotFoundError(Exception):
    pass


class PortfolioItemNotFoundError(Exception):
    pass


def _clean_str_list(values: list[str] | None) -> list[str] | None:
    if values is None:
        return None
    return [entry.strip() for entry in values if isinstance(entry, str) and entry.strip()]


def _normalize_unique_list(values: list[str] | None) -> list[str]:
    cleaned = _clean_str_list(values) or []
    unique: list[str] = []
    seen: set[str] = set()
    for value in cleaned:
        key = value.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(value)
    return unique


def _clean_portfolio_timestamp_notes(values: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not isinstance(values, list):
        return []
    cleaned: list[dict[str, Any]] = []
    for idx, raw in enumerate(values[:10]):
        if not isinstance(raw, dict):
            continue
        time = _clean_optional_text(raw.get("time"))
        seconds_raw = raw.get("seconds")
        seconds: int | None = None
        if isinstance(seconds_raw, (int, float)) and seconds_raw >= 0:
            seconds = int(seconds_raw)
        elif time:
            parts = time.split(":")
            try:
                numbers = [int(part) for part in parts]
            except ValueError:
                numbers = []
            if len(numbers) == 2 and numbers[1] < 60:
                seconds = numbers[0] * 60 + numbers[1]
            elif len(numbers) == 3 and numbers[1] < 60 and numbers[2] < 60:
                seconds = numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
        title = (_clean_optional_text(raw.get("title")) or "")[:60]
        description = (_clean_optional_text(raw.get("description")) or "")[:220]
        if seconds is None or (not title and not description):
            continue
        minutes, sec = divmod(seconds, 60)
        cleaned.append(
            {
                "id": _clean_optional_text(raw.get("id")) or f"note-{idx + 1}",
                "time": time or f"{minutes}:{sec:02d}",
                "seconds": seconds,
                "title": title or "Project moment",
                "description": description,
            }
        )
    return cleaned


def _merge_privacy_settings(raw: dict[str, bool] | None) -> dict[str, bool]:
    merged = dict(DEFAULT_PRIVACY_SETTINGS)
    if isinstance(raw, dict):
        for key in merged:
            if key in raw:
                merged[key] = bool(raw[key])
    return merged


def _clean_optional_text(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    return (value or "").strip() or None


def _is_http_url(value: str) -> bool:
    parsed = urlparse(value.strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _allowed_hiring_identity_url(value: str | None, platform: str) -> bool:
    if not value:
        return False
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"}:
        return False
    host = parsed.netloc.lower().split("@")[-1].split(":")[0]
    if host not in HIRING_IDENTITY_ALLOWED_HOSTS.get(platform, set()):
        return False
    parts = [part for part in parsed.path.split("/") if part]
    if platform == "YOUTUBE":
        if not parts:
            return False
        first = parts[0].lower()
        return first.startswith("@") or first in {"channel", "c", "user"}
    if platform == "INSTAGRAM":
        if not parts:
            return False
        first = parts[0].lower().lstrip("@")
        return first not in {"accounts", "explore", "p", "reel", "reels", "stories", "tv"}
    return False


def _canonical_hiring_identity_public_url(value: str, platform: str) -> str:
    parsed = urlparse(value.strip())
    parts = [part for part in parsed.path.split("/") if part]
    if platform == "YOUTUBE":
        first = parts[0]
        first_lower = first.lower()
        if first_lower.startswith("@"):
            path = f"/{first}"
        elif first_lower in {"channel", "c", "user"} and len(parts) >= 2:
            path = f"/{first}/{parts[1]}"
        else:
            path = parsed.path.rstrip("/") or parsed.path
        return urlunparse(parsed._replace(path=path, query="", fragment=""))
    if platform == "INSTAGRAM" and parts:
        return urlunparse(parsed._replace(path=f"/{parts[0].lstrip('@')}", query="", fragment=""))
    return urlunparse(parsed._replace(query="", fragment=""))


def _html_to_searchable_text(value: str) -> str:
    without_scripts = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", value, flags=re.IGNORECASE | re.DOTALL)
    without_tags = re.sub(r"<[^>]+>", " ", without_scripts)
    return re.sub(r"\s+", " ", html.unescape(without_tags)).strip()


def _decode_js_escaped_text(value: str) -> str:
    def replace_unicode(match: re.Match[str]) -> str:
        return chr(int(match.group(1), 16))

    decoded = re.sub(r"\\u([0-9a-fA-F]{4})", replace_unicode, value)
    decoded = re.sub(r"\\x([0-9a-fA-F]{2})", replace_unicode, decoded)
    return decoded.replace("\\/", "/")


def _public_verification_search_text(value: str) -> str:
    js_decoded = _decode_js_escaped_text(value)
    return "\n".join(
        (
            value,
            html.unescape(value),
            js_decoded,
            html.unescape(js_decoded),
            _html_to_searchable_text(value),
            _html_to_searchable_text(js_decoded),
        )
    )


def _normalize_verification_text(value: Any) -> str:
    normalized = unicodedata.normalize("NFKC", html.unescape(str(value or "")))
    normalized = _decode_js_escaped_text(normalized)
    normalized = re.sub(r"[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]", "-", normalized)
    normalized = re.sub(r"\s*-\s*", "-", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip().upper()


def _verification_code_found(expected_code: str | None, public_text: str) -> bool:
    normalized_code = _normalize_verification_text(expected_code)
    normalized_text = _normalize_verification_text(public_text)
    if not normalized_code:
        return False
    if normalized_code in normalized_text:
        return True

    expected_compact = re.sub(r"[^A-Z0-9]", "", normalized_code)
    if not re.fullmatch(r"CJ[A-Z0-9]{8}", expected_compact):
        return False

    for match in re.finditer(r"C\s*J(?:[\s-]*[A-Z0-9]){8}", normalized_text):
        if re.sub(r"[^A-Z0-9]", "", match.group(0)) == expected_compact:
            return True
    return False


def _new_hiring_identity_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    first = "".join(secrets.choice(alphabet) for _ in range(4))
    second = "".join(secrets.choice(alphabet) for _ in range(4))
    return f"CJ-{first}-{second}"


def _normalize_profile_experience(
    raw: Any,
    *,
    validate_urls: bool = False,
) -> list[ProfileExperienceItem]:
    if not isinstance(raw, list):
        return []

    normalized: list[ProfileExperienceItem] = []
    for index, item in enumerate(raw[:25]):
        if isinstance(item, ProfileExperienceItem):
            data = item.model_dump()
        elif isinstance(item, dict):
            data = dict(item)
        else:
            continue

        role = _clean_optional_text(data.get("role"))
        organization_name = _clean_optional_text(
            data.get("organization_name") or data.get("organizationName")
        )
        if not role or not organization_name:
            continue

        organization_url = _clean_optional_text(
            data.get("organization_url") or data.get("organizationUrl")
        )
        organization_logo_url = _clean_optional_text(
            data.get("organization_logo_url") or data.get("organizationLogoUrl")
        )
        if validate_urls:
            if organization_url and not _is_http_url(organization_url):
                raise ProfileValidationError("Experience organization URL must be a valid http(s) URL.")
            if organization_logo_url and not _is_http_url(organization_logo_url):
                raise ProfileValidationError("Experience logo URL must be a valid http(s) URL.")
        else:
            if organization_url and not _is_http_url(organization_url):
                organization_url = None
            if organization_logo_url and not _is_http_url(organization_logo_url):
                organization_logo_url = None

        item_id = _clean_optional_text(data.get("id")) or f"experience-{index + 1}"
        normalized.append(
            ProfileExperienceItem(
                id=item_id[:120],
                role=role,
                organization_name=organization_name,
                organization_url=organization_url,
                organization_logo_url=organization_logo_url,
                platform=_clean_optional_text(data.get("platform")),
                work_type=_clean_optional_text(data.get("work_type") or data.get("workType")),
                work_mode=_clean_optional_text(data.get("work_mode") or data.get("workMode")),
                start_month=_clean_optional_text(data.get("start_month") or data.get("startMonth")),
                start_year=_clean_optional_text(data.get("start_year") or data.get("startYear")),
                end_month=_clean_optional_text(data.get("end_month") or data.get("endMonth")),
                end_year=_clean_optional_text(data.get("end_year") or data.get("endYear")),
                is_current=bool(data.get("is_current") or data.get("isCurrent")),
                description=_clean_optional_text(data.get("description")),
                tools=_normalize_unique_list(data.get("tools") if isinstance(data.get("tools"), list) else []),
            )
        )
    return normalized


def _is_answer_present(answer: Any) -> bool:
    if answer is None:
        return False
    if isinstance(answer, str):
        return bool(answer.strip())
    if isinstance(answer, (list, tuple, set)):
        return len(answer) > 0
    if isinstance(answer, dict):
        return len(answer) > 0
    return True


def _normalize_instagram_handle(value: str | None) -> str | None:
    cleaned = (value or "").strip().lstrip("@").strip()
    return cleaned or None


def _status_from_portfolio_input(status: str | None, timeframe: str | None) -> str:
    normalized_status = (status or "").strip().lower()
    normalized_timeframe = (timeframe or "").strip().lower()
    if normalized_status in {"now", "past"}:
        return normalized_status
    if normalized_timeframe in {"now", "past"}:
        return normalized_timeframe
    return "now"


def _visibility_from_input(visibility: str | None, is_public: bool | None) -> str:
    normalized = (visibility or "").strip().lower()
    if normalized in {"public", "private"}:
        return normalized
    if is_public is None:
        return "public"
    return "public" if is_public else "private"


def _is_public_from_visibility(visibility: str | None, is_public: bool | None) -> bool:
    normalized = (visibility or "").strip().lower()
    if normalized == "private":
        return False
    if normalized == "public":
        return True
    return True if is_public is None else bool(is_public)


def _publish_status_from_input(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    if normalized in {"draft", "published"}:
        return normalized
    return "published"


def _clean_thumbnail_options(values: Any) -> list[dict[str, Any]]:
    if not isinstance(values, list):
        return []
    cleaned: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for entry in values:
        if not isinstance(entry, dict):
            continue
        url = _clean_optional_text(str(entry.get("url") or ""))
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        option: dict[str, Any] = {"url": url}
        quality = _clean_optional_text(str(entry.get("quality") or ""))
        if quality:
            option["quality"] = quality
        for dimension in ("width", "height"):
            number = _clean_metric_number(entry.get(dimension), field=dimension, minimum=0)
            if number is not None:
                option[dimension] = number
        cleaned.append(option)
    return cleaned


def _validate_publishable_portfolio_item(data: dict[str, Any]) -> None:
    if _publish_status_from_input(data.get("publish_status")) != "published":
        return
    if not _clean_optional_text(data.get("title")):
        raise ProfileValidationError("Project title is required before publishing.")
    if not _clean_optional_text(data.get("thumbnail_url")):
        raise ProfileValidationError("Choose a cover image before publishing.")
    if not _clean_optional_text(data.get("role_name")):
        raise ProfileValidationError("Select your exact role before publishing.")
    if not data.get("visibility"):
        raise ProfileValidationError("Choose project visibility before publishing.")
    if not _clean_optional_text(data.get("source_url")) and not _clean_optional_text(data.get("description")):
        raise ProfileValidationError("Add a proof URL or contribution summary before publishing.")


def _clean_metric_number(value: Any, *, field: str, minimum: float | None = None, maximum: float | None = None) -> int | float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ProfileValidationError(f"{field} must be numeric.")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ProfileValidationError(f"{field} must be numeric.") from exc
    if minimum is not None and number < minimum:
        raise ProfileValidationError(f"{field} must be at least {minimum}.")
    if maximum is not None and number > maximum:
        raise ProfileValidationError(f"{field} must be at most {maximum}.")
    return int(number) if number.is_integer() else number


def _clean_metrics(raw: dict[str, Any] | None, *, manual: bool) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    cleaned: dict[str, Any] = {}
    bounds = {
        "views": (0, None),
        "likes": (0, None),
        "comments": (0, None),
        "retention_percent": (0, 100),
        "ctr_percent": (0, 100),
        "turnaround_days": (0, None),
        "subscribers_gained": (0, None),
        "conversions": (0, None),
    }
    for key, value in raw.items():
        normalized_key = str(key).strip()
        if not normalized_key:
            continue
        if normalized_key in bounds:
            minimum, maximum = bounds[normalized_key]
            number = _clean_metric_number(value, field=normalized_key, minimum=minimum, maximum=maximum)
            if number is not None:
                cleaned[normalized_key] = number
            continue
        if normalized_key in {"duration", "notes"}:
            text = str(value).strip() if value is not None else ""
            if text:
                cleaned[normalized_key] = text
            continue
        if not manual:
            cleaned[normalized_key] = value
    return cleaned


class ProfileService:
    def __init__(self, repository: AuthRepository):
        self.repository = repository

    async def list_roles(self) -> list[RoleRead]:
        rows = await self.repository.list_roles()
        return [RoleRead.model_validate(row) for row in rows]

    async def _list_role_questions_with_options(self, *, role_id: UUID) -> list[RoleQuestionRead]:
        questions = await self.repository.list_role_questions_for_role(role_id=role_id)
        question_ids = [question.id for question in questions]
        options = await self.repository.list_role_question_options_for_questions(
            question_ids=question_ids
        )
        options_by_question: dict[UUID, list[dict[str, Any]]] = {}
        for option in options:
            options_by_question.setdefault(option.question_id, []).append(
                {"id": option.id, "value": option.value}
            )

        return [
            RoleQuestionRead(
                id=question.id,
                role_id=question.role_id,
                label=question.label,
                help_text=question.help_text,
                type=question.type,
                required=bool(question.required),
                options=options_by_question.get(question.id, []),
            )
            for question in questions
        ]

    async def list_role_questions(self, *, role_id: UUID) -> RoleQuestionsResponse:
        role = await self.repository.get_role_by_id(role_id)
        if role is None:
            raise ProfileNotFoundError("Role not found")
        items = await self._list_role_questions_with_options(role_id=role_id)
        return RoleQuestionsResponse(role_id=role_id, items=items)

    async def _load_selected_roles_for_user(self, *, user_id: UUID) -> list[RoleRead]:
        selected_links = await self.repository.list_user_roles(user_id=user_id)
        if not selected_links:
            return []
        all_roles = await self.repository.list_roles()
        role_map = {role.id: role for role in all_roles}
        selected_roles: list[RoleRead] = []
        for link in selected_links:
            role = role_map.get(link.role_id)
            if role is None:
                continue
            selected_roles.append(RoleRead.model_validate(role))
        return selected_roles

    async def set_user_roles(self, user: User, payload: UserRolesUpsertRequest) -> list[RoleRead]:
        available_roles = await self.repository.list_roles()
        role_map = {role.id: role for role in available_roles}
        name_map = {role.name.strip().lower(): role for role in available_roles}

        requested_ids: list[UUID] = []
        seen: set[UUID] = set()

        # Explicit catalog ids must reference known roles (unchanged behavior).
        unknown = [str(role_id) for role_id in payload.role_ids if role_id not in role_map]
        if unknown:
            raise ProfileValidationError(f"Unknown role ids: {', '.join(unknown)}")
        for role_id in payload.role_ids:
            if role_id in seen:
                continue
            seen.add(role_id)
            requested_ids.append(role_id)

        # Free-text names: reuse an existing role (case-insensitive) or create one,
        # so a user can add a specialization that isn't in the catalog yet.
        for raw_name in payload.role_names:
            name = " ".join(str(raw_name).split())
            if not name:
                continue
            if len(name) > MAX_ROLE_NAME_LENGTH:
                raise ProfileValidationError(
                    f"Specializations must be {MAX_ROLE_NAME_LENGTH} characters or fewer."
                )
            role = name_map.get(name.lower())
            if role is None:
                role = await self.repository.create_role(name=name, category=CUSTOM_ROLE_CATEGORY)
                name_map[name.lower()] = role
                role_map[role.id] = role
            if role.id in seen:
                continue
            seen.add(role.id)
            requested_ids.append(role.id)

        if len(requested_ids) > MAX_ROLES_PER_USER:
            raise ProfileValidationError(
                f"You can select up to {MAX_ROLES_PER_USER} specializations."
            )

        await self.repository.replace_user_roles(user_id=user.id, role_ids=requested_ids)
        selected_questions = await self.repository.list_role_questions_for_roles(role_ids=requested_ids)
        await self.repository.delete_user_role_answers_not_in_questions(
            user_id=user.id,
            question_ids=[question.id for question in selected_questions],
        )
        await self.repository.commit()

        return [RoleRead.model_validate(role_map[role_id]) for role_id in requested_ids]

    async def get_user_roles(self, user: User) -> list[RoleRead]:
        return await self._load_selected_roles_for_user(user_id=user.id)

    @staticmethod
    def _normalize_answer_for_question(*, question_type: str, answer: Any) -> Any:
        if answer is None:
            return None
        if question_type == "single_select":
            if not isinstance(answer, str):
                raise ProfileValidationError("single_select answers must be a string")
            return answer.strip() or None
        if question_type == "multi_select":
            if isinstance(answer, str):
                values = [answer]
            elif isinstance(answer, list):
                values = [value for value in answer if isinstance(value, str)]
            else:
                raise ProfileValidationError("multi_select answers must be a list of strings")
            return _normalize_unique_list(values)
        if question_type == "text":
            if not isinstance(answer, str):
                raise ProfileValidationError("text answers must be a string")
            return answer.strip() or None
        if question_type == "number":
            if isinstance(answer, (int, float)):
                return answer
            if isinstance(answer, str):
                candidate = answer.strip()
                if not candidate:
                    return None
                try:
                    return float(candidate)
                except ValueError as exc:
                    raise ProfileValidationError("number answers must be numeric") from exc
            raise ProfileValidationError("number answers must be numeric")
        raise ProfileValidationError("Unknown role question type")

    async def upsert_user_role_answers(
        self, user: User, payload: UserRoleAnswersUpsertRequest
    ) -> list[UserRoleAnswerRead]:
        selected_roles = await self.repository.list_user_roles(user_id=user.id)
        selected_role_ids = [item.role_id for item in selected_roles]
        if not selected_role_ids:
            raise ProfileValidationError("Select at least one role before answering questions.")

        selected_questions = await self.repository.list_role_questions_for_roles(role_ids=selected_role_ids)
        question_map = {question.id: question for question in selected_questions}
        question_options = await self.repository.list_role_question_options_for_questions(
            question_ids=list(question_map.keys())
        )
        options_by_question: dict[UUID, set[str]] = {}
        for option in question_options:
            options_by_question.setdefault(option.question_id, set()).add(option.value)

        for entry in payload.answers:
            question = question_map.get(entry.role_question_id)
            if question is None:
                raise ProfileValidationError("Question does not belong to selected roles.")
            normalized_answer = self._normalize_answer_for_question(
                question_type=question.type,
                answer=entry.answer,
            )
            allowed_options = options_by_question.get(question.id, set())
            if question.type == "single_select" and normalized_answer is not None and allowed_options:
                if normalized_answer not in allowed_options:
                    raise ProfileValidationError("Invalid option for single_select question.")
            if question.type == "multi_select" and isinstance(normalized_answer, list) and allowed_options:
                invalid_values = [value for value in normalized_answer if value not in allowed_options]
                if invalid_values:
                    raise ProfileValidationError("Invalid option for multi_select question.")

            await self.repository.upsert_user_role_answer(
                user_id=user.id,
                role_question_id=question.id,
                answer=normalized_answer,
            )

        await self.repository.commit()
        answer_rows = await self.repository.list_user_role_answers(user_id=user.id)
        return [
            UserRoleAnswerRead(role_question_id=row.role_question_id, answer=row.answer)
            for row in answer_rows
        ]

    async def get_user_role_answers(self, user: User) -> list[UserRoleAnswerRead]:
        rows = await self.repository.list_user_role_answers(user_id=user.id)
        return [UserRoleAnswerRead(role_question_id=row.role_question_id, answer=row.answer) for row in rows]

    async def get_user_content_style(self, user: User) -> ContentStyleRead:
        row = await self.repository.get_user_content_style(user_id=user.id)
        if row is None:
            return ContentStyleRead()
        return ContentStyleRead.model_validate(row)

    async def upsert_user_content_style(
        self, user: User, payload: ContentStyleUpsertRequest
    ) -> ContentStyleRead:
        # Formats and tone accept free-form custom values (capped) so the talent can
        # describe their work beyond the preset suggestions. Editing complexity stays a
        # constrained enum.
        cleaned_format = _normalize_unique_list(payload.format)[:MAX_HIRING_LIST_ITEMS]
        cleaned_tone = _normalize_unique_list(payload.tone)[:MAX_HIRING_LIST_ITEMS]
        cleaned_niche = _clean_optional_text(payload.primary_niche)
        cleaned_target_audience = _clean_optional_text(payload.target_audience)
        cleaned_complexity = _clean_optional_text(payload.editing_complexity)

        if cleaned_complexity and cleaned_complexity not in CONTENT_STYLE_COMPLEXITY_OPTIONS:
            raise ProfileValidationError(
                f"Invalid editing complexity '{cleaned_complexity}'. Allowed: {', '.join(sorted(CONTENT_STYLE_COMPLEXITY_OPTIONS))}"
            )

        row = await self.repository.upsert_user_content_style(
            user_id=user.id,
            data={
                "primary_niche": cleaned_niche,
                "format": cleaned_format,
                "tone": cleaned_tone,
                "target_audience": cleaned_target_audience,
                "editing_complexity": cleaned_complexity,
            },
        )
        await self.repository.commit()
        return ContentStyleRead.model_validate(row)

    @staticmethod
    def get_content_style_niches() -> ContentStyleNichesResponse:
        return ContentStyleNichesResponse(items=CONTENT_STYLE_PRIMARY_NICHES)

    async def _build_role_answer_summary(self, *, user_id: UUID) -> list[RoleAnswerSummary]:
        selected_roles = await self._load_selected_roles_for_user(user_id=user_id)
        role_name_by_id = {role.id: role.name for role in selected_roles}
        if not role_name_by_id:
            return []

        answer_rows = await self.repository.list_user_role_answers(user_id=user_id)
        question_ids = [row.role_question_id for row in answer_rows]
        question_rows = await self.repository.list_role_questions_by_ids(question_ids=question_ids)
        question_map = {question.id: question for question in question_rows}

        summary: list[RoleAnswerSummary] = []
        for row in answer_rows:
            question = question_map.get(row.role_question_id)
            if question is None:
                continue
            role_name = role_name_by_id.get(question.role_id)
            if not role_name:
                continue
            summary.append(
                RoleAnswerSummary(
                    role_question_id=question.id,
                    role_name=role_name,
                    question_label=question.label,
                    answer=row.answer,
                )
            )

        summary.sort(key=lambda item: (item.role_name.lower(), item.question_label.lower()))
        return summary

    async def _resolve_content_style_for_user(self, *, user_id: UUID) -> ContentStyleRead:
        row = await self.repository.get_user_content_style(user_id=user_id)
        if row is None:
            return ContentStyleRead()
        return ContentStyleRead.model_validate(row)

    async def get_profile_completion(self, user: User) -> ProfileCompletionResponse:
        missing: list[str] = []

        selected_roles = await self.repository.list_user_roles(user_id=user.id)
        selected_role_ids = [row.role_id for row in selected_roles]
        has_roles = len(selected_role_ids) > 0
        if not has_roles:
            missing.append("Select at least one role")

        required_answer_complete = False
        if has_roles:
            questions = await self.repository.list_role_questions_for_roles(role_ids=selected_role_ids)
            required_questions = [question for question in questions if question.required]
            if not required_questions:
                required_answer_complete = True
            else:
                answers = await self.repository.list_user_role_answers(user_id=user.id)
                answer_map = {entry.role_question_id: entry.answer for entry in answers}
                required_answer_complete = all(
                    _is_answer_present(answer_map.get(question.id)) for question in required_questions
                )
            if not required_answer_complete:
                missing.append("Answer required role questions")
        else:
            missing.append("Answer required role questions")

        content_style = await self.repository.get_user_content_style(user_id=user.id)
        content_style_complete = bool(
            content_style
            and _clean_optional_text(content_style.primary_niche)
            and len(_normalize_unique_list(content_style.format)) > 0
            and len(_normalize_unique_list(content_style.tone)) > 0
            and _clean_optional_text(content_style.target_audience)
        )
        if not content_style_complete:
            missing.append("Complete content style")

        portfolio_items = await self.repository.list_portfolio_items_for_user(user_id=user.id)
        has_portfolio = len(portfolio_items) > 0
        if not has_portfolio:
            missing.append("Add at least one portfolio item")

        checks = [has_roles, required_answer_complete, content_style_complete, has_portfolio]
        completion_percent = int(round((sum(1 for done in checks if done) / len(checks)) * 100))
        return ProfileCompletionResponse(
            completion_percent=completion_percent,
            missing_required_sections=missing,
        )

    async def create_portfolio_from_youtube(
        self,
        user: User,
        *,
        payload: PortfolioYouTubeCreateRequest,
    ) -> PortfolioItem:
        parsed_video_id = extract_video_id(payload.youtube_url)
        if not parsed_video_id:
            raise ProfileValidationError("Invalid YouTube URL")

        metadata = await fetch_youtube_video_metadata(parsed_video_id)
        public_metrics = {
            key: value
            for key, value in {
                "views": metadata.view_count,
                "likes": metadata.like_count,
                "comments": metadata.comment_count,
                "duration_iso": metadata.duration_iso,
                "duration_label": metadata.duration_label,
                "channel_name": metadata.channel_name,
                "channel_id": metadata.channel_id,
                "published_at": metadata.published_date.isoformat() if metadata.published_date else None,
            }.items()
            if value is not None
        }
        manual_metrics = _clean_metrics({"retention_percent": payload.retention_percent}, manual=True)
        data = {
            "source_type": "youtube",
            "source_url": metadata.video_url,
            "title": metadata.title,
            "description": metadata.description,
            "contribution_summary": None,
            "role_name": _clean_optional_text(payload.user_role_in_project),
            "role": _clean_optional_text(payload.user_role_in_project),
            "user_role_in_project": _clean_optional_text(payload.user_role_in_project),
            "media_url": metadata.video_url,
            "metrics": None,
            "youtube_url": metadata.video_url,
            "thumbnail_url": metadata.thumbnail_url,
            "thumbnail_options": metadata.thumbnail_options,
            "channel_name": metadata.channel_name,
            "channel_id": metadata.channel_id,
            "views": metadata.view_count,
            "published_date": metadata.published_date,
            "published_at": metadata.published_date,
            "duration": metadata.duration,
            "retention_percent": manual_metrics.get("retention_percent"),
            "links": [metadata.video_url],
            "tags": ["YouTube"],
            "contribution_tags": [],
            "tools": [],
            "public_metrics": public_metrics,
            "manual_metrics": manual_metrics,
            "verification_status": "youtube_metadata_verified",
            "visibility": "public" if payload.is_public else "private",
            "publish_status": "published",
            "portfolio_status": payload.status,
            "is_featured": False,
            "status": payload.status,
            "is_public": payload.is_public,
        }
        row = await self.repository.create_portfolio_item(user_id=user.id, data=data)
        await self.repository.commit()
        return row

    async def preview_portfolio_youtube(self, *, url: str) -> PortfolioYouTubePreviewResponse:
        parsed_video_id = extract_video_id(url)
        if not parsed_video_id:
            raise ProfileValidationError("Enter a valid YouTube video URL.")
        metadata = await fetch_youtube_video_metadata(parsed_video_id)
        public_metrics = {
            key: value
            for key, value in {
                "views": metadata.view_count,
                "likes": metadata.like_count,
                "comments": metadata.comment_count,
                "duration_iso": metadata.duration_iso,
                "duration_label": metadata.duration_label,
                "channel_name": metadata.channel_name,
                "channel_id": metadata.channel_id,
                "published_at": metadata.published_date.isoformat() if metadata.published_date else None,
            }.items()
            if value is not None
        }
        return PortfolioYouTubePreviewResponse(
            source_url=metadata.video_url,
            video_id=metadata.video_id,
            title=metadata.title,
            description=metadata.description,
            description_snippet=metadata.description,
            thumbnail_url=metadata.thumbnail_url,
            thumbnail_options=metadata.thumbnail_options,
            channel_name=metadata.channel_name,
            channel_id=metadata.channel_id,
            published_at=metadata.published_date,
            view_count=metadata.view_count,
            like_count=metadata.like_count,
            comment_count=metadata.comment_count,
            duration_iso=metadata.duration_iso,
            duration_label=metadata.duration_label,
            public_metrics=public_metrics,
        )

    async def list_portfolio_by_user(self, *, user_id: UUID, include_private: bool = False) -> list[PortfolioItem]:
        if include_private:
            return await self.repository.list_portfolio_items_for_user(user_id=user_id)
        return await self.repository.list_public_portfolio_items_for_user(user_id=user_id)

    @staticmethod
    def _build_collaboration_preferences(user: User) -> CollaborationPreferences:
        return CollaborationPreferences(
            project_type_preference=user.project_type_preference,
            turnaround=user.collaboration_turnaround,
            revisions=user.collaboration_revisions,
            working_hours=user.collaboration_working_hours,
            tools=user.collaboration_tools,
            styles=_normalize_unique_list(user.collaboration_styles),
            work_mode=_clean_optional_text(user.work_mode),
        )

    @staticmethod
    def _build_hiring_info(user: User) -> HiringInfo:
        verification_status = _clean_optional_text(user.hiring_verification_status) or "unverified"
        if verification_status not in HIRING_VERIFICATION_STATUS_OPTIONS:
            verification_status = "unverified"
        return HiringInfo(
            hiring_type=user.hiring_type if user.hiring_type in HIRING_TYPE_OPTIONS else None,
            website_or_social_url=_clean_optional_text(user.hiring_website_or_social_url),
            primary_platform=(
                user.hiring_primary_platform
                if user.hiring_primary_platform in HIRING_PRIMARY_PLATFORM_OPTIONS
                else None
            ),
            platforms=_normalize_unique_list(user.hiring_platforms),
            niches=_normalize_unique_list(user.hiring_niches),
            genres=_normalize_unique_list(user.hiring_genres),
            formats=_normalize_unique_list(user.hiring_formats),
            channels_or_pages_managed=_clean_optional_text(user.hiring_channels_or_pages_managed),
            verification_status=verification_status,
        )

    @staticmethod
    def _build_stats(*, jobs: list[object], projects_count: int) -> ProfileStats:
        jobs_completed_count = sum(
            1
            for job in jobs
            if getattr(job, "deleted_at", None) is not None
            or (str(getattr(job, "status", "") or "").lower() in PAST_JOB_STATUSES)
        )
        return ProfileStats(
            jobs_posted_count=len(jobs),
            jobs_completed_count=jobs_completed_count,
            projects_count=projects_count,
            reviews_count=0,
        )

    @staticmethod
    def _build_profile_capabilities(
        *,
        user: User,
        channels: list[YouTubeChannel],
        portfolio_rows: list[PortfolioItem],
        selected_roles: list[RoleRead],
        hiring_identities: list[HiringIdentity] | None = None,
    ) -> ProfileCapabilities:
        has_public_profile = bool(_clean_optional_text(user.username))
        has_portfolio = len(portfolio_rows) > 0
        hiring_identity_rows = hiring_identities or []
        has_hiring_identity_record = len(hiring_identity_rows) > 0
        has_hiring_identity_trust = any(
            _clean_optional_text(identity.url)
            or _clean_optional_text(identity.handle)
            for identity in hiring_identity_rows
        )
        has_verified_hiring_identity = any(
            identity.verification_status == "VERIFIED" for identity in hiring_identity_rows
        )
        has_verified_social_or_channel = len(channels) > 0 or has_verified_hiring_identity
        has_existing_trust_link = bool(
            _clean_optional_text(user.hiring_website_or_social_url)
            or len(_normalize_unique_list(user.public_links or [])) > 0
            or _clean_optional_text(user.instagram_handle)
            or _clean_optional_text(user.instagram_url)
            or has_verified_social_or_channel
            or has_hiring_identity_trust
        )
        has_talent_signal = (
            len(selected_roles) > 0
            or len(_normalize_unique_list(user.skills or [])) > 0
            or has_portfolio
        )
        has_hiring_identity = bool(
            _clean_optional_text(user.display_name)
            and _clean_optional_text(user.hiring_type)
            and _clean_optional_text(user.location)
            and has_hiring_identity_record
            and has_existing_trust_link
        )

        apply_missing_sections: list[str] = []
        if not has_public_profile:
            apply_missing_sections.append("Create public username")
        if not has_talent_signal:
            apply_missing_sections.append("Add roles, skills, or portfolio proof")

        post_missing_sections: list[str] = []
        if not _clean_optional_text(user.display_name):
            post_missing_sections.append("Add display name")
        if not _clean_optional_text(user.hiring_type):
            post_missing_sections.append("Choose hiring type")
        if not _clean_optional_text(user.location):
            post_missing_sections.append("Add location")
        if not has_hiring_identity_record:
            post_missing_sections.append("Add a YouTube channel or Instagram page you hire for")
        if not has_existing_trust_link:
            post_missing_sections.append("Add website, social link, Instagram, or verified YouTube channel")

        return ProfileCapabilities(
            can_apply_to_jobs=has_public_profile and has_talent_signal,
            can_post_jobs=has_hiring_identity,
            has_portfolio=has_portfolio,
            has_public_profile=has_public_profile,
            has_hiring_identity=has_hiring_identity,
            has_verified_social_or_channel=has_verified_social_or_channel,
            is_admin=is_admin(user),
            apply_missing_sections=apply_missing_sections,
            post_missing_sections=post_missing_sections,
            missing_hiring_fields=post_missing_sections,
        )

    def _build_social_connections(
        self,
        *,
        user: User,
        channels: list[YouTubeChannel],
        show_youtube: bool,
    ) -> SocialConnections:
        youtube = SocialYouTubeConnection(connected=False)
        if channels and show_youtube:
            first = channels[0]
            youtube = SocialYouTubeConnection(
                connected=True,
                channel_id=first.channel_id,
                channel_title=first.title,
                channel_handle=None,
                channel_avatar_url=first.thumbnail_url,
                channel_url=f"https://www.youtube.com/channel/{first.channel_id}",
            )

        instagram_handle = _normalize_instagram_handle(user.instagram_handle)
        instagram_url = _clean_optional_text(user.instagram_url)
        if instagram_handle and not instagram_url:
            instagram_url = f"https://www.instagram.com/{instagram_handle}"
        instagram = SocialInstagramConnection(
            connected=bool(instagram_handle or instagram_url),
            handle=instagram_handle,
            url=instagram_url,
        )

        return SocialConnections(youtube=youtube, instagram=instagram)

    @staticmethod
    def _portfolio_to_read(item: PortfolioItem) -> PortfolioItemRead:
        parsed = PortfolioItemRead.model_validate(item)
        if parsed.timeframe is None:
            parsed = parsed.model_copy(update={"timeframe": parsed.status})
        return parsed

    @staticmethod
    def _portfolio_metadata(portfolio_rows: list[PortfolioItem]) -> dict[str, list[str]]:
        tools: list[str] = []
        niches: list[str] = []
        genres: list[str] = []
        platforms: list[str] = []
        formats: list[str] = []
        for item in portfolio_rows:
            tools.extend(item.tools or [])
            niches.extend(item.content_niches or [])
            genres.extend(item.content_genres or [])
            platforms.extend(item.platforms or [])
            formats.extend(item.formats or [])
        return {
            "tools": _normalize_unique_list(tools),
            "niches": _normalize_unique_list(niches),
            "genres": _normalize_unique_list(genres),
            "platforms": _normalize_unique_list(platforms),
            "formats": _normalize_unique_list(formats),
        }

    @staticmethod
    def _content_style_with_portfolio_metadata(
        content_style: ContentStyleRead,
        metadata: dict[str, list[str]],
    ) -> ContentStyleRead:
        return content_style.model_copy(
            update={
                "primary_niche": content_style.primary_niche or (metadata["niches"][0] if metadata["niches"] else None),
                "format": _normalize_unique_list([*(content_style.format or []), *metadata["formats"]])[:12],
                "tone": _normalize_unique_list([*(content_style.tone or []), *metadata["genres"]])[:12],
            }
        )

    async def _resolve_avatar_url(
        self,
        *,
        user: User,
        channels: list[YouTubeChannel] | None = None,
    ) -> str | None:
        linked_channels = channels
        if linked_channels is None:
            linked_channels = await self.repository.list_user_youtube_channels(user_id=user.id)

        if user.avatar_mode == "youtube_channel" and user.avatar_youtube_channel_id:
            selected = next(
                (ch for ch in linked_channels if ch.channel_id == user.avatar_youtube_channel_id),
                None,
            )
            if selected and selected.thumbnail_url:
                return selected.thumbnail_url
        return user.avatar_url

    async def _build_profile_read(self, user: User) -> ProfileRead:
        privacy = _merge_privacy_settings(user.privacy_settings)
        now = datetime.now(UTC)
        can_change, next_change_at = can_change_username(
            username_change_count=user.username_change_count,
            username_last_changed_at=user.username_last_changed_at,
            now=now,
        )
        channels = await self.repository.list_user_youtube_channels(user_id=user.id)
        avatar_url = await self._resolve_avatar_url(user=user, channels=channels)
        jobs = await self.repository.list_jobs_for_user_public(user_id=user.id)
        portfolio_rows = await self.repository.list_portfolio_items_for_user(user_id=user.id)
        selected_roles = await self._load_selected_roles_for_user(user_id=user.id)
        hiring_identities = await self.repository.list_hiring_identities_for_user(user_id=user.id)
        role_answers_summary = await self._build_role_answer_summary(user_id=user.id)
        content_style = await self._resolve_content_style_for_user(user_id=user.id)
        portfolio_metadata = self._portfolio_metadata(portfolio_rows)
        content_style = self._content_style_with_portfolio_metadata(content_style, portfolio_metadata)

        social_connections = self._build_social_connections(
            user=user,
            channels=channels,
            show_youtube=True,
        )

        return ProfileRead(
            id=user.id,
            email=user.email,
            account_type=user.account_type,
            account_type_selected_at=user.account_type_selected_at,
            onboarding_intent=user.onboarding_intent,
            onboarding_intent_selected_at=user.onboarding_intent_selected_at,
            username=user.username,
            username_change_count=user.username_change_count,
            username_last_changed_at=user.username_last_changed_at,
            display_name=user.display_name,
            headline=user.headline,
            bio=user.bio,
            skills=_normalize_unique_list([*(user.skills or []), *portfolio_metadata["tools"]]),
            public_links=list(user.public_links or []),
            experience=_normalize_profile_experience(user.profile_experience),
            availability_status=(
                user.availability_status
                if user.availability_status in {"available", "selective", "unavailable"}
                else "selective"
            ),
            location=user.location,
            timezone=user.timezone,
            avatar_mode="youtube_channel" if user.avatar_mode == "youtube_channel" else "generic",
            avatar_url=avatar_url,
            avatar_youtube_channel_id=user.avatar_youtube_channel_id,
            banner_url=user.banner_url,
            social_connections=social_connections,
            stats=self._build_stats(jobs=jobs, projects_count=len(portfolio_rows)),
            reviews=ReviewsSummary(avg_rating=0.0, review_count=0),
            collaboration_preferences=self._build_collaboration_preferences(user),
            hiring_info=self._build_hiring_info(user),
            creator_platforms=_normalize_unique_list([*(user.creator_platforms or []), *portfolio_metadata["platforms"]]),
            roles=selected_roles,
            role_answers_summary=role_answers_summary,
            content_style=content_style,
            privacy_settings=PrivacySettings(**privacy),
            profile_capabilities=self._build_profile_capabilities(
                user=user,
                channels=channels,
                portfolio_rows=portfolio_rows,
                selected_roles=selected_roles,
                hiring_identities=hiring_identities,
            ),
            can_change_username=can_change,
            username_next_change_at=next_change_at,
        )

    async def get_my_profile(self, user: User) -> ProfileRead:
        return await self._build_profile_read(user)

    async def get_profile_capabilities(self, user: User) -> ProfileCapabilities:
        channels = await self.repository.list_user_youtube_channels(user_id=user.id)
        portfolio_rows = await self.repository.list_portfolio_items_for_user(user_id=user.id)
        selected_roles = await self._load_selected_roles_for_user(user_id=user.id)
        hiring_identities = await self.repository.list_hiring_identities_for_user(user_id=user.id)
        return self._build_profile_capabilities(
            user=user,
            channels=channels,
            portfolio_rows=portfolio_rows,
            selected_roles=selected_roles,
            hiring_identities=hiring_identities,
        )

    @staticmethod
    def _stringify_url(value: Any) -> str | None:
        if value is None:
            return None
        return _clean_optional_text(str(value))

    def _normalize_hiring_identity_data(
        self,
        user: User,
        data: dict[str, Any],
        *,
        current: HiringIdentity | None = None,
    ) -> dict[str, Any]:
        next_data = dict(data)
        identity_type = next_data.get("type") or (current.type if current is not None else None)
        if identity_type not in HIRING_IDENTITY_TYPE_OPTIONS:
            raise ProfileValidationError("Choose whether this is your own channel/page or represented by you.")
        next_data["type"] = identity_type
        next_data["is_agency_represented"] = identity_type == "AGENCY_REPRESENTED_CHANNEL"

        platform = next_data.get("platform") or (current.platform if current is not None else None)
        if platform not in HIRING_IDENTITY_PLATFORM_OPTIONS:
            raise ProfileValidationError("Choose YouTube or Instagram for this channel/page.")
        next_data["platform"] = platform

        if "display_name" in next_data:
            display_name = _clean_optional_text(next_data.get("display_name"))
            if not display_name:
                raise ProfileValidationError("Channel/page name is required.")
            next_data["display_name"] = display_name

        for field in ("handle", "description", "managed_by_agency_name"):
            if field in next_data:
                next_data[field] = _clean_optional_text(next_data.get(field))

        for field in ("url", "avatar_url", "proof_url"):
            if field in next_data:
                url = self._stringify_url(next_data.get(field))
                if url and not _is_http_url(url):
                    raise ProfileValidationError("Channel/page URLs must be valid http(s) URLs.")
                next_data[field] = url

        next_handle = (
            _clean_optional_text(next_data.get("handle"))
            if "handle" in next_data
            else _clean_optional_text(current.handle) if current is not None else None
        )
        next_url = (
            _clean_optional_text(next_data.get("url"))
            if "url" in next_data
            else _clean_optional_text(current.url) if current is not None else None
        )
        if not next_handle and not next_url:
            raise ProfileValidationError("Add a channel/page handle or URL.")

        if next_data["type"] == "AGENCY_REPRESENTED_CHANNEL":
            agency_name = _clean_optional_text(next_data.get("managed_by_agency_name"))
            if not agency_name:
                agency_name = _clean_optional_text(user.display_name) or _clean_optional_text(user.username)
            next_data["managed_by_agency_name"] = agency_name
        else:
            next_data["managed_by_agency_name"] = None

        return next_data

    @staticmethod
    def _hiring_identity_identity_fields_changed(updates: dict[str, Any]) -> bool:
        return any(
            field in updates
            for field in (
                "type",
                "platform",
                "display_name",
                "handle",
                "url",
                "managed_by_agency_name",
                "is_agency_represented",
            )
        )

    @staticmethod
    def _matches_linked_youtube_channel(
        identity: HiringIdentity, channels: list[YouTubeChannel]
    ) -> bool:
        url = _clean_optional_text(identity.url)
        stable_ids: set[str] = set()
        if url:
            parsed = urlparse(url)
            parts = [part for part in parsed.path.split("/") if part]
            if len(parts) >= 2 and parts[0].lower() == "channel":
                stable_ids.add(parts[1].lower())
            for match in re.findall(r"\bUC[\w-]{20,}\b", url):
                stable_ids.add(match.lower())
        if not stable_ids:
            return False
        for channel in channels:
            channel_id = _clean_optional_text(channel.channel_id) or ""
            if channel_id and channel_id.lower() in stable_ids:
                return True
        return False

    @staticmethod
    def _public_hiring_identity_urls(identity: HiringIdentity) -> list[str]:
        public_url = _clean_optional_text(identity.proof_url) or _clean_optional_text(identity.url)
        if identity.platform not in HIRING_IDENTITY_ALLOWED_HOSTS:
            raise ProfileValidationError(HIRING_IDENTITY_UNSUPPORTED_PLATFORM_ERROR)
        if public_url is None:
            raise ProfileValidationError(HIRING_IDENTITY_INVALID_PUBLIC_URL_ERROR)
        if not _allowed_hiring_identity_url(public_url, identity.platform):
            raise ProfileValidationError(HIRING_IDENTITY_INVALID_PUBLIC_URL_ERROR)

        canonical_url = _canonical_hiring_identity_public_url(public_url, identity.platform)
        candidates: list[str] = []
        if identity.platform == "YOUTUBE":
            parsed = urlparse(canonical_url)
            path = parsed.path.rstrip("/")
            if not path.lower().endswith("/about"):
                about_path = f"{path}/about" if path else "/about"
                candidates.append(
                    urlunparse(parsed._replace(path=about_path, query="", fragment=""))
                )
        candidates.append(canonical_url)
        if public_url != canonical_url:
            candidates.append(public_url)
        unique_candidates: list[str] = []
        seen: set[str] = set()
        for candidate in candidates:
            if candidate in seen:
                continue
            seen.add(candidate)
            unique_candidates.append(candidate)
        return unique_candidates

    @staticmethod
    async def _get_allowed_public_page(
        client: httpx.AsyncClient,
        public_url: str,
        platform: str,
    ) -> httpx.Response:
        next_url = public_url
        for _ in range(4):
            response = await client.get(next_url, follow_redirects=False)
            if response.status_code not in {301, 302, 303, 307, 308}:
                if not _allowed_hiring_identity_url(str(response.url), platform):
                    raise ProfileValidationError(HIRING_IDENTITY_PUBLIC_PAGE_READ_ERROR)
                return response
            location = response.headers.get("location")
            if not location:
                raise ProfileValidationError(HIRING_IDENTITY_PUBLIC_PAGE_READ_ERROR)
            redirected_url = urljoin(str(response.url), location)
            if not _allowed_hiring_identity_url(redirected_url, platform):
                raise ProfileValidationError(HIRING_IDENTITY_PUBLIC_PAGE_READ_ERROR)
            next_url = redirected_url
        raise ProfileValidationError(HIRING_IDENTITY_PUBLIC_PAGE_READ_ERROR)

    @staticmethod
    def _public_page_looks_unreadable(identity: HiringIdentity, response: httpx.Response, text: str) -> bool:
        final_url = str(response.url).lower()
        sample = text[:200_000].lower()
        if identity.platform == "YOUTUBE":
            return "consent.youtube.com" in final_url or "before you continue to youtube" in sample
        if identity.platform == "INSTAGRAM":
            return "login • instagram" in sample or "log in to instagram" in sample
        return False

    @staticmethod
    async def _fetch_public_hiring_identity_text(identity: HiringIdentity) -> str:
        public_urls = ProfileService._public_hiring_identity_urls(identity)
        chunks: list[str] = []
        last_error: ProfileValidationError | None = None

        try:
            async with httpx.AsyncClient(
                timeout=HIRING_IDENTITY_PUBLIC_BIO_TIMEOUT,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; CreatorJobsVerification/1.0)",
                    "Accept": "text/html,application/xhtml+xml",
                },
            ) as client:
                for public_url in public_urls:
                    try:
                        response = await ProfileService._get_allowed_public_page(
                            client,
                            public_url,
                            identity.platform,
                        )
                    except httpx.HTTPError as exc:
                        last_error = ProfileValidationError(HIRING_IDENTITY_PUBLIC_PAGE_READ_ERROR)
                        last_error.__cause__ = exc
                        continue
                    except ProfileValidationError as exc:
                        last_error = exc
                        continue
                    content_type = (response.headers.get("content-type") or "").lower()
                    if response.status_code >= 400 or "text/html" not in content_type:
                        last_error = ProfileValidationError(HIRING_IDENTITY_PUBLIC_PAGE_READ_ERROR)
                        continue
                    response_text = response.text[:HIRING_IDENTITY_PUBLIC_BIO_MAX_CHARS]
                    if not response_text.strip() or ProfileService._public_page_looks_unreadable(
                        identity,
                        response,
                        response_text,
                    ):
                        last_error = ProfileValidationError(HIRING_IDENTITY_PUBLIC_PAGE_READ_ERROR)
                        continue
                    chunks.append(response_text)
        except httpx.HTTPError as exc:
            raise ProfileValidationError(HIRING_IDENTITY_PUBLIC_PAGE_READ_ERROR) from exc

        if not chunks:
            if last_error is not None:
                raise last_error
            raise ProfileValidationError(HIRING_IDENTITY_PUBLIC_PAGE_READ_ERROR)
        return _public_verification_search_text("\n".join(chunks))

    @staticmethod
    def _verification_code_expired(identity: HiringIdentity, now: datetime) -> bool:
        expires_at = identity.verification_code_expires_at
        if expires_at is None:
            return True
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        return expires_at <= now

    async def list_my_hiring_identities(self, user: User) -> list[HiringIdentity]:
        return await self.repository.list_hiring_identities_for_user(user_id=user.id)

    async def create_my_hiring_identity(
        self, user: User, payload: HiringIdentityCreate
    ) -> HiringIdentity:
        data = payload.model_dump()
        data = self._normalize_hiring_identity_data(user, data)
        for key in ("url", "avatar_url", "proof_url"):
            if data.get(key) is not None:
                data[key] = str(data[key])
        data["verification_status"] = "UNVERIFIED"
        data["verification_method"] = "NONE"
        data["verification_code"] = None
        data["verification_code_expires_at"] = None
        data["verification_attempt_count"] = 0
        data["verification_last_checked_at"] = None
        data["verification_last_error"] = None
        data["verified_at"] = None
        row = await self.repository.create_hiring_identity(user_id=user.id, data=data)
        await self.repository.commit()
        return row

    async def update_my_hiring_identity(
        self,
        user: User,
        *,
        identity_id: UUID,
        payload: HiringIdentityUpdate,
    ) -> HiringIdentity:
        row = await self.repository.get_hiring_identity_for_user(
            user_id=user.id, identity_id=identity_id
        )
        if row is None:
            raise ProfileNotFoundError("Hiring identity not found")
        updates = payload.model_dump(exclude_unset=True)
        updates = self._normalize_hiring_identity_data(user, updates, current=row)
        for key in ("url", "avatar_url", "proof_url"):
            if updates.get(key) is not None:
                updates[key] = str(updates[key])
        if self._hiring_identity_identity_fields_changed(updates):
            updates["verification_status"] = "UNVERIFIED"
            updates["verification_method"] = "NONE"
            updates["verification_code"] = None
            updates["verification_code_expires_at"] = None
            updates["verification_attempt_count"] = 0
            updates["verification_last_checked_at"] = None
            updates["verification_last_error"] = None
            updates["verified_at"] = None
        self.repository.update_values(row, **updates)
        await self.repository.session.flush()
        await self.repository.session.refresh(row)
        await self.repository.commit()
        return row

    async def delete_my_hiring_identity(
        self,
        user: User,
        *,
        identity_id: UUID,
    ) -> None:
        row = await self.repository.get_hiring_identity_for_user(
            user_id=user.id, identity_id=identity_id
        )
        if row is None:
            raise ProfileNotFoundError("Hiring identity not found")
        await self.repository.delete_hiring_identity(row)
        await self.repository.commit()

    async def request_hiring_identity_verification(
        self,
        user: User,
        *,
        identity_id: UUID,
        payload: HiringIdentityVerificationRequest,
    ) -> HiringIdentityVerificationResponse:
        row = await self.repository.get_hiring_identity_for_user(
            user_id=user.id, identity_id=identity_id
        )
        if row is None:
            raise ProfileNotFoundError("Hiring identity not found")

        proof_url = self._stringify_url(payload.proof_url)
        if proof_url and not _is_http_url(proof_url):
            raise ProfileValidationError("Proof URL must be a valid http(s) URL.")
        if proof_url and not _allowed_hiring_identity_url(proof_url, row.platform):
            raise ProfileValidationError(HIRING_IDENTITY_INVALID_PUBLIC_URL_ERROR)
        row.proof_url = proof_url or row.proof_url
        now = datetime.now(UTC)

        if row.platform == "YOUTUBE":
            linked_channels = await self.repository.list_user_youtube_channels(user_id=user.id)
            if self._matches_linked_youtube_channel(row, linked_channels):
                row.verification_status = "VERIFIED"
                row.verification_method = "YOUTUBE_OAUTH"
                row.verification_code = None
                row.verification_code_expires_at = None
                row.verification_attempt_count = 0
                row.verification_last_checked_at = None
                row.verification_last_error = None
                row.verified_at = datetime.now(UTC)
                message = "This YouTube channel matches a linked account and is verified."
            else:
                row.verification_status = "PENDING"
                row.verification_method = "VERIFICATION_CODE"
                if not row.verification_code or self._verification_code_expired(row, now):
                    row.verification_code = _new_hiring_identity_code()
                    row.verification_attempt_count = 0
                row.verification_code_expires_at = now + HIRING_IDENTITY_CODE_TTL
                row.verification_last_error = None
                row.verified_at = None
                message = (
                    "Add this verification code to the public channel description, then check verification."
                )
        else:
            row.verification_status = "PENDING"
            row.verification_method = "INSTAGRAM_LINK_IN_BIO"
            if not row.verification_code or self._verification_code_expired(row, now):
                row.verification_code = _new_hiring_identity_code()
                row.verification_attempt_count = 0
            row.verification_code_expires_at = now + HIRING_IDENTITY_CODE_TTL
            row.verification_last_error = None
            row.verified_at = None
            message = "Add this verification code to the Instagram bio or link-in-bio, then check verification."

        await self.repository.session.flush()
        await self.repository.session.refresh(row)
        await self.repository.commit()
        return HiringIdentityVerificationResponse(
            identity=HiringIdentityRead.model_validate(row),
            message=message,
        )

    async def check_hiring_identity_bio_verification(
        self,
        user: User,
        *,
        identity_id: UUID,
    ) -> HiringIdentityVerificationResponse:
        row = await self.repository.get_hiring_identity_for_user(
            user_id=user.id, identity_id=identity_id
        )
        if row is None:
            raise ProfileNotFoundError("Hiring identity not found")

        now = datetime.now(UTC)
        row.verification_last_checked_at = now
        row.verification_attempt_count = (row.verification_attempt_count or 0) + 1

        if row.verification_status == "VERIFIED":
            message = "This channel/page is already verified."
        elif not row.verification_code:
            row.verification_last_error = "Generate a verification code first."
            await self.repository.session.flush()
            await self.repository.session.refresh(row)
            await self.repository.commit()
            raise ProfileValidationError(row.verification_last_error)
        elif self._verification_code_expired(row, now):
            row.verification_status = "UNVERIFIED"
            row.verification_last_error = "This verification code expired. Generate a new code."
            await self.repository.session.flush()
            await self.repository.session.refresh(row)
            await self.repository.commit()
            raise ProfileValidationError(row.verification_last_error)
        elif row.verification_attempt_count > HIRING_IDENTITY_MAX_CODE_CHECKS:
            row.verification_last_error = "Too many checks. Generate a new verification code."
            await self.repository.session.flush()
            await self.repository.session.refresh(row)
            await self.repository.commit()
            raise ProfileValidationError(row.verification_last_error)
        else:
            try:
                public_text = await self._fetch_public_hiring_identity_text(row)
            except ProfileValidationError as exc:
                row.verification_last_error = str(exc)
                await self.repository.session.flush()
                await self.repository.session.refresh(row)
                await self.repository.commit()
                raise

            if _verification_code_found(row.verification_code, public_text):
                row.verification_status = "VERIFIED"
                row.verification_method = (
                    "INSTAGRAM_LINK_IN_BIO" if row.platform == "INSTAGRAM" else "VERIFICATION_CODE"
                )
                row.verified_at = now
                row.verification_last_error = None
                message = "Authorization verified. You can now publish jobs for this channel/page."
            else:
                row.verification_status = "PENDING"
                row.verification_last_error = (
                    "We could not find the code in the public bio yet. Add it and try again."
                )
                await self.repository.session.flush()
                await self.repository.session.refresh(row)
                await self.repository.commit()
                raise ProfileValidationError(row.verification_last_error)

        await self.repository.session.flush()
        await self.repository.session.refresh(row)
        await self.repository.commit()
        return HiringIdentityVerificationResponse(
            identity=HiringIdentityRead.model_validate(row),
            message=message,
        )

    async def update_my_profile(self, user: User, payload: ProfileUpdateRequest) -> ProfileRead:
        updates = payload.model_dump(exclude_unset=True)
        now = datetime.now(UTC)

        if "username" in updates:
            raw_username = updates.get("username")
            if raw_username is not None:
                requested_username = normalize_username(raw_username)
                if not validate_username_format(requested_username):
                    raise ProfileValidationError(
                        "Username must be 3-20 characters, use lowercase letters/numbers/underscore, and cannot start with underscore."
                    )

                if user.username is None:
                    existing = await self.repository.get_user_by_username(requested_username)
                    if existing and existing.id != user.id:
                        raise ProfileValidationError("Username is already taken")
                    user.username = requested_username
                elif requested_username != user.username:
                    allowed, next_change_at = can_change_username(
                        username_change_count=user.username_change_count,
                        username_last_changed_at=user.username_last_changed_at,
                        now=now,
                    )
                    if not allowed:
                        if user.username_change_count >= 2:
                            raise ProfileValidationError("Username change limit reached.")
                        if next_change_at:
                            raise ProfileValidationError(
                                f"Username can be changed again after {next_change_at.isoformat()}."
                            )
                        raise ProfileValidationError("Username cannot be changed right now.")

                    existing = await self.repository.get_user_by_username(requested_username)
                    if existing and existing.id != user.id:
                        raise ProfileValidationError("Username is already taken")

                    if user.username:
                        await self.repository.create_username_history_entry(
                            user_id=user.id,
                            old_username=user.username,
                        )
                    user.username = requested_username
                    user.username_change_count = int(user.username_change_count) + 1
                    user.username_last_changed_at = now

        if "display_name" in updates:
            user.display_name = _clean_optional_text(updates.get("display_name"))
        if "headline" in updates:
            user.headline = _clean_optional_text(updates.get("headline"))
        if "bio" in updates:
            user.bio = _clean_optional_text(updates.get("bio"))
        if "availability_status" in updates:
            availability_status = updates.get("availability_status")
            if availability_status not in {"available", "selective", "unavailable"}:
                raise ProfileValidationError("Invalid availability status.")
            user.availability_status = availability_status
        if "location" in updates:
            user.location = _clean_optional_text(updates.get("location"))
        if "timezone" in updates:
            user.timezone = _clean_optional_text(updates.get("timezone"))
        if "skills" in updates:
            user.skills = _clean_str_list(updates.get("skills")) or []
        if "public_links" in updates:
            user.public_links = _clean_str_list(updates.get("public_links")) or []
        if "experience" in updates:
            user.profile_experience = [
                item.model_dump()
                for item in _normalize_profile_experience(
                    updates.get("experience"),
                    validate_urls=True,
                )
            ]
        if "avatar_url" in updates:
            user.avatar_url = _clean_optional_text(updates.get("avatar_url"))

        if "instagram_handle" in updates:
            user.instagram_handle = _normalize_instagram_handle(updates.get("instagram_handle"))
        if "instagram_url" in updates:
            user.instagram_url = _clean_optional_text(updates.get("instagram_url"))

        if "project_type_preference" in updates:
            project_type_preference = updates.get("project_type_preference")
            if project_type_preference not in {None, "oneOff", "retainer", "either"}:
                raise ProfileValidationError("Invalid project type preference.")
            user.project_type_preference = project_type_preference
        if "collaboration_turnaround" in updates:
            user.collaboration_turnaround = _clean_optional_text(updates.get("collaboration_turnaround"))
        if "collaboration_revisions" in updates:
            user.collaboration_revisions = _clean_optional_text(updates.get("collaboration_revisions"))
        if "collaboration_working_hours" in updates:
            user.collaboration_working_hours = _clean_optional_text(
                updates.get("collaboration_working_hours")
            )
        if "collaboration_tools" in updates:
            user.collaboration_tools = _clean_optional_text(updates.get("collaboration_tools"))
        if "collaboration_styles" in updates:
            user.collaboration_styles = _normalize_unique_list(
                updates.get("collaboration_styles")
            )[:MAX_HIRING_LIST_ITEMS]
        if "work_mode" in updates:
            work_mode = _clean_optional_text(updates.get("work_mode"))
            if work_mode is not None and work_mode not in WORK_MODE_OPTIONS:
                raise ProfileValidationError("Invalid work mode.")
            user.work_mode = work_mode
        if "hiring_type" in updates:
            hiring_type = updates.get("hiring_type")
            if hiring_type is not None and hiring_type not in HIRING_TYPE_OPTIONS:
                raise ProfileValidationError("Invalid hiring type.")
            user.hiring_type = hiring_type
        if "hiring_website_or_social_url" in updates:
            hiring_url = _clean_optional_text(updates.get("hiring_website_or_social_url"))
            if hiring_url and not _is_http_url(hiring_url):
                raise ProfileValidationError("Hiring website or social URL must be a valid http(s) URL.")
            user.hiring_website_or_social_url = hiring_url
        if "hiring_primary_platform" in updates:
            primary_platform = updates.get("hiring_primary_platform")
            if primary_platform is not None and primary_platform not in HIRING_PRIMARY_PLATFORM_OPTIONS:
                raise ProfileValidationError("Invalid hiring primary platform.")
            user.hiring_primary_platform = primary_platform
        if "hiring_platforms" in updates:
            platforms = _normalize_unique_list(updates.get("hiring_platforms"))[:MAX_HIRING_LIST_ITEMS]
            user.hiring_platforms = platforms
            # Keep the legacy single-enum primary_platform in sync so any existing
            # platform filters keep working — unless the caller set it explicitly in
            # the same request, in which case the explicit value wins.
            if "hiring_primary_platform" not in updates:
                has_youtube = any(p.strip().lower() == "youtube" for p in platforms)
                has_instagram = any(p.strip().lower() == "instagram" for p in platforms)
                if has_youtube and has_instagram:
                    user.hiring_primary_platform = "Both"
                elif has_youtube:
                    user.hiring_primary_platform = "YouTube"
                elif has_instagram:
                    user.hiring_primary_platform = "Instagram"
                else:
                    user.hiring_primary_platform = None
        if "hiring_niches" in updates:
            user.hiring_niches = _normalize_unique_list(updates.get("hiring_niches"))[
                :MAX_HIRING_LIST_ITEMS
            ]
        if "hiring_genres" in updates:
            user.hiring_genres = _normalize_unique_list(updates.get("hiring_genres"))[
                :MAX_HIRING_LIST_ITEMS
            ]
        if "hiring_formats" in updates:
            user.hiring_formats = _normalize_unique_list(updates.get("hiring_formats"))[
                :MAX_HIRING_LIST_ITEMS
            ]
        if "creator_platforms" in updates:
            user.creator_platforms = _normalize_unique_list(updates.get("creator_platforms"))[
                :MAX_HIRING_LIST_ITEMS
            ]
        if "hiring_channels_or_pages_managed" in updates:
            user.hiring_channels_or_pages_managed = _clean_optional_text(
                updates.get("hiring_channels_or_pages_managed")
            )

        if "avatar_mode" in updates:
            requested_mode = updates.get("avatar_mode")
            if requested_mode not in {"generic", "youtube_channel"}:
                raise ProfileValidationError("Invalid avatar mode.")
            user.avatar_mode = requested_mode

            if requested_mode == "generic":
                user.avatar_youtube_channel_id = None
            else:
                selected_channel_id = (updates.get("avatar_youtube_channel_id") or "").strip()
                if not selected_channel_id:
                    selected_channel_id = user.avatar_youtube_channel_id or ""
                if not selected_channel_id:
                    raise ProfileValidationError(
                        "Select a linked YouTube channel for channel-avatar mode."
                    )

                channel = await self.repository.get_user_youtube_channel_by_channel_id(
                    user_id=user.id,
                    channel_id=selected_channel_id,
                )
                if channel is None:
                    raise ProfileValidationError("Selected channel is not linked to your account.")
                user.avatar_youtube_channel_id = selected_channel_id

        elif "avatar_youtube_channel_id" in updates and user.avatar_mode == "youtube_channel":
            selected_channel_id = (updates.get("avatar_youtube_channel_id") or "").strip()
            if selected_channel_id:
                channel = await self.repository.get_user_youtube_channel_by_channel_id(
                    user_id=user.id,
                    channel_id=selected_channel_id,
                )
                if channel is None:
                    raise ProfileValidationError("Selected channel is not linked to your account.")
                user.avatar_youtube_channel_id = selected_channel_id

        await self.repository.commit()
        await self.repository.session.refresh(user)
        return await self._build_profile_read(user)

    async def upload_my_avatar(
        self,
        user: User,
        payload: AvatarUploadRequest,
        *,
        public_base_url: str,
    ) -> ProfileRead:
        content_type = payload.content_type.strip().lower()
        data_url = payload.data_url.strip()
        encoded = data_url

        if data_url.startswith("data:"):
            header, separator, encoded_body = data_url.partition(",")
            if separator != ",":
                raise ProfileValidationError("Invalid avatar image data.")
            header_content_type = header.removeprefix("data:").split(";", 1)[0].strip().lower()
            if header_content_type:
                content_type = header_content_type
            encoded = encoded_body

        extension = AVATAR_UPLOAD_EXTENSIONS.get(content_type)
        if not extension:
            raise ProfileValidationError("Avatar must be a PNG, JPG, WEBP, or GIF image.")

        try:
            image_bytes = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ProfileValidationError("Invalid avatar image data.") from exc

        if not image_bytes:
            raise ProfileValidationError("Avatar image is empty.")
        if len(image_bytes) > MAX_AVATAR_UPLOAD_BYTES:
            raise ProfileValidationError("Avatar image must be 5 MB or smaller.")

        avatars_dir = Path(settings.media_root) / "avatars"
        avatars_dir.mkdir(parents=True, exist_ok=True)
        file_name = f"{user.id}-{secrets.token_urlsafe(12)}.{extension}"
        file_path = avatars_dir / file_name
        file_path.write_bytes(image_bytes)

        media_base_path = f"/{settings.media_base_path.strip('/')}"
        user.avatar_mode = "generic"
        user.avatar_youtube_channel_id = None
        user.avatar_url = f"{public_base_url.rstrip('/')}{media_base_path}/avatars/{file_name}"

        await self.repository.commit()
        await self.repository.session.refresh(user)
        return await self._build_profile_read(user)

    async def upload_my_banner(
        self,
        user: User,
        payload: AvatarUploadRequest,
        *,
        public_base_url: str,
    ) -> ProfileRead:
        content_type = payload.content_type.strip().lower()
        data_url = payload.data_url.strip()
        encoded = data_url

        if data_url.startswith("data:"):
            header, separator, encoded_body = data_url.partition(",")
            if separator != ",":
                raise ProfileValidationError("Invalid banner image data.")
            header_content_type = header.removeprefix("data:").split(";", 1)[0].strip().lower()
            if header_content_type:
                content_type = header_content_type
            encoded = encoded_body

        extension = AVATAR_UPLOAD_EXTENSIONS.get(content_type)
        if not extension:
            raise ProfileValidationError("Banner must be a PNG, JPG, WEBP, or GIF image.")

        try:
            image_bytes = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ProfileValidationError("Invalid banner image data.") from exc

        if not image_bytes:
            raise ProfileValidationError("Banner image is empty.")
        if len(image_bytes) > MAX_BANNER_UPLOAD_BYTES:
            raise ProfileValidationError("Banner image must be 8 MB or smaller.")

        banners_dir = Path(settings.media_root) / "banners"
        banners_dir.mkdir(parents=True, exist_ok=True)
        file_name = f"{user.id}-{secrets.token_urlsafe(12)}.{extension}"
        file_path = banners_dir / file_name
        file_path.write_bytes(image_bytes)

        media_base_path = f"/{settings.media_base_path.strip('/')}"
        user.banner_url = f"{public_base_url.rstrip('/')}{media_base_path}/banners/{file_name}"

        await self.repository.commit()
        await self.repository.session.refresh(user)
        return await self._build_profile_read(user)

    async def update_my_privacy(self, user: User, payload: PrivacyUpdateRequest) -> ProfileRead:
        current = _merge_privacy_settings(user.privacy_settings)
        updates = payload.model_dump(exclude_unset=True)
        for key, value in updates.items():
            if key in current and value is not None:
                current[key] = bool(value)
        user.privacy_settings = current
        await self.repository.commit()
        await self.repository.session.refresh(user)
        return await self._build_profile_read(user)

    async def list_my_portfolio(self, user: User) -> list[PortfolioItem]:
        return await self.repository.list_portfolio_items_for_user(user_id=user.id)

    async def create_my_portfolio_item(
        self, user: User, payload: PortfolioItemCreate
    ) -> PortfolioItem:
        explicit_publish_status = "publish_status" in payload.model_fields_set
        data = payload.model_dump()
        data["status"] = _status_from_portfolio_input(
            data.get("portfolio_status") or data.get("status"), data.get("timeframe")
        )
        data["portfolio_status"] = data["status"]
        data["publish_status"] = _publish_status_from_input(data.get("publish_status"))
        data.pop("timeframe", None)
        data["visibility"] = _visibility_from_input(data.get("visibility"), data.get("is_public"))
        data["is_public"] = _is_public_from_visibility(data.get("visibility"), data.get("is_public"))
        data["links"] = _clean_str_list(data.get("links")) or []
        data["tags"] = _clean_str_list(data.get("tags")) or []
        data["contribution_tags"] = _normalize_unique_list(data.get("contribution_tags"))
        data["tools"] = _clean_str_list(data.get("tools")) or []
        data["content_niches"] = _normalize_unique_list(data.get("content_niches"))[:12]
        data["content_genres"] = _normalize_unique_list(data.get("content_genres"))[:12]
        data["platforms"] = _normalize_unique_list(data.get("platforms"))[:12]
        data["formats"] = _normalize_unique_list(data.get("formats"))[:12]
        data["results"] = _normalize_unique_list(data.get("results"))[:10]
        data["contribution_highlights"] = _normalize_unique_list(data.get("contribution_highlights"))[:8]
        data["timestamp_notes"] = _clean_portfolio_timestamp_notes(data.get("timestamp_notes"))
        data["thumbnail_options"] = _clean_thumbnail_options(data.get("thumbnail_options"))
        data["role_name"] = _clean_optional_text(data.get("role_name")) or _clean_optional_text(data.get("role")) or _clean_optional_text(data.get("user_role_in_project"))
        data["role"] = data["role_name"]
        data["user_role_in_project"] = data["role_name"]
        data["what_i_did"] = _clean_optional_text(data.get("what_i_did")) or _clean_optional_text(data.get("contribution_summary")) or _clean_optional_text(data.get("description"))
        data["contribution_summary"] = _clean_optional_text(data.get("contribution_summary")) or data["what_i_did"]
        data["description"] = _clean_optional_text(data.get("description")) or data["what_i_did"]
        data["source_type"] = (data.get("source_type") or ("youtube" if data.get("youtube_url") else "custom")).strip().lower()
        data["source_url"] = _clean_optional_text(data.get("source_url")) or _clean_optional_text(data.get("youtube_url")) or _clean_optional_text(data.get("media_url")) or (data["links"][0] if data["links"] else None)
        data["media_url"] = _clean_optional_text(data.get("media_url")) or data["source_url"]
        if data["source_type"] == "youtube":
            data["youtube_url"] = _clean_optional_text(data.get("youtube_url")) or data["source_url"]
            data["verification_status"] = data.get("verification_status") or "youtube_metadata_verified"
        else:
            data["verification_status"] = data.get("verification_status") or "manual"
        if not data["source_url"] and not data["description"]:
            raise ProfileValidationError("Add either a media URL or a contribution summary.")
        data["public_metrics"] = _clean_metrics(data.get("public_metrics"), manual=False)
        if data.get("views") is not None and "views" not in data["public_metrics"]:
            data["public_metrics"]["views"] = _clean_metric_number(data.get("views"), field="views", minimum=0)
        if data.get("duration") and "duration" not in data["public_metrics"]:
            data["public_metrics"]["duration"] = data.get("duration")
        manual_metrics = dict(data.get("manual_metrics") or {})
        if data.get("retention_percent") is not None:
            manual_metrics["retention_percent"] = data.get("retention_percent")
        data["manual_metrics"] = _clean_metrics(manual_metrics, manual=True)
        data["retention_percent"] = data["manual_metrics"].get("retention_percent")
        data["views"] = data["public_metrics"].get("views") if isinstance(data["public_metrics"].get("views"), int) else data.get("views")
        data["published_date"] = data.get("published_date") or data.get("published_at")
        data["published_at"] = data.get("published_at") or data.get("published_date")
        if explicit_publish_status:
            _validate_publishable_portfolio_item(data)
        row = await self.repository.create_portfolio_item(user_id=user.id, data=data)
        await self.repository.commit()
        return row

    async def update_my_portfolio_item(
        self,
        user: User,
        *,
        item_id: UUID,
        payload: PortfolioItemUpdate,
    ) -> PortfolioItem:
        row = await self.repository.get_portfolio_item_for_user(user_id=user.id, item_id=item_id)
        if row is None:
            raise PortfolioItemNotFoundError("Portfolio item not found")

        updates = payload.model_dump(exclude_unset=True)
        explicit_publish_status = "publish_status" in payload.model_fields_set
        if "publish_status" in updates:
            updates["publish_status"] = _publish_status_from_input(updates.get("publish_status"))
        status_candidate = (
            updates.get("portfolio_status") or updates.get("status")
            if "status" in updates or "portfolio_status" in updates
            else None
        )
        next_status = _status_from_portfolio_input(
            status_candidate,
            updates.get("timeframe") if "timeframe" in updates else None,
        )
        if "status" in updates or "portfolio_status" in updates or "timeframe" in updates:
            updates["status"] = next_status
            updates["portfolio_status"] = next_status
        updates.pop("timeframe", None)
        if "visibility" in updates or "is_public" in updates:
            updates["visibility"] = _visibility_from_input(updates.get("visibility"), updates.get("is_public"))
            updates["is_public"] = _is_public_from_visibility(updates.get("visibility"), updates.get("is_public"))
        if "links" in updates:
            updates["links"] = _clean_str_list(updates.get("links")) or []
        if "tags" in updates:
            updates["tags"] = _clean_str_list(updates.get("tags")) or []
        if "contribution_tags" in updates:
            updates["contribution_tags"] = _normalize_unique_list(updates.get("contribution_tags"))
        if "tools" in updates:
            updates["tools"] = _clean_str_list(updates.get("tools")) or []
        if "content_niches" in updates:
            updates["content_niches"] = _normalize_unique_list(updates.get("content_niches"))[:12]
        if "content_genres" in updates:
            updates["content_genres"] = _normalize_unique_list(updates.get("content_genres"))[:12]
        if "platforms" in updates:
            updates["platforms"] = _normalize_unique_list(updates.get("platforms"))[:12]
        if "formats" in updates:
            updates["formats"] = _normalize_unique_list(updates.get("formats"))[:12]
        if "results" in updates:
            updates["results"] = _normalize_unique_list(updates.get("results"))[:10]
        if "contribution_highlights" in updates:
            updates["contribution_highlights"] = _normalize_unique_list(updates.get("contribution_highlights"))[:8]
        if "timestamp_notes" in updates:
            updates["timestamp_notes"] = _clean_portfolio_timestamp_notes(updates.get("timestamp_notes"))
        if "thumbnail_options" in updates:
            updates["thumbnail_options"] = _clean_thumbnail_options(updates.get("thumbnail_options"))
        if any(key in updates for key in ("role_name", "role", "user_role_in_project")):
            role_name = _clean_optional_text(updates.get("role_name")) or _clean_optional_text(updates.get("role")) or _clean_optional_text(updates.get("user_role_in_project"))
            updates["role_name"] = role_name
            updates["role"] = role_name
            updates["user_role_in_project"] = role_name
        if "what_i_did" in updates or "contribution_summary" in updates or "description" in updates:
            summary = (
                _clean_optional_text(updates.get("what_i_did"))
                or _clean_optional_text(updates.get("contribution_summary"))
                or _clean_optional_text(updates.get("description"))
            )
            updates["what_i_did"] = summary
            updates["contribution_summary"] = summary
            updates["description"] = _clean_optional_text(updates.get("description")) or summary
        if any(key in updates for key in ("source_url", "youtube_url", "media_url", "links", "source_type")):
            source_url = _clean_optional_text(updates.get("source_url")) or _clean_optional_text(updates.get("youtube_url")) or _clean_optional_text(updates.get("media_url")) or (updates.get("links") or [None])[0]
            if source_url:
                updates["source_url"] = source_url
                updates["media_url"] = _clean_optional_text(updates.get("media_url")) or source_url
            if updates.get("source_type") == "youtube":
                updates["youtube_url"] = _clean_optional_text(updates.get("youtube_url")) or source_url
        if "verification_status" not in updates and updates.get("source_type") == "youtube":
            updates["verification_status"] = "youtube_metadata_verified"
        if "public_metrics" in updates:
            updates["public_metrics"] = _clean_metrics(updates.get("public_metrics"), manual=False)
        if "manual_metrics" in updates or "retention_percent" in updates:
            manual_metrics = dict(updates.get("manual_metrics") or {})
            if updates.get("retention_percent") is not None:
                manual_metrics["retention_percent"] = updates.get("retention_percent")
            updates["manual_metrics"] = _clean_metrics(manual_metrics, manual=True)
            updates["retention_percent"] = updates["manual_metrics"].get("retention_percent")
        if "published_at" in updates and "published_date" not in updates:
            updates["published_date"] = updates.get("published_at")
        if "published_date" in updates and "published_at" not in updates:
            updates["published_at"] = updates.get("published_date")

        if explicit_publish_status and updates.get("publish_status") == "published":
            merged = {
                "title": row.title,
                "thumbnail_url": row.thumbnail_url,
                "role_name": row.role_name,
                "visibility": row.visibility,
                "source_url": row.source_url,
                "description": row.description,
                "publish_status": row.publish_status,
            }
            merged.update(updates)
            _validate_publishable_portfolio_item(merged)

        self.repository.update_values(row, **updates)
        await self.repository.session.flush()
        await self.repository.session.refresh(row)
        await self.repository.commit()
        return row

    async def delete_my_portfolio_item(self, user: User, *, item_id: UUID) -> None:
        deleted = await self.repository.delete_portfolio_item_for_user(user_id=user.id, item_id=item_id)
        if not deleted:
            raise PortfolioItemNotFoundError("Portfolio item not found")
        await self.repository.commit()

    async def _resolve_user_for_public_lookup(
        self, username: str
    ) -> tuple[User | None, str | None, str]:
        normalized_username = normalize_username(username)
        if not validate_username_format(normalized_username):
            raise ProfileNotFoundError("Profile not found")

        user = await self.repository.get_user_by_username(normalized_username)
        if user is not None:
            return user, None, normalized_username

        history = await self.repository.get_username_history(normalized_username)
        if history is None:
            raise ProfileNotFoundError("Profile not found")
        moved_user = await self.repository.get_user_by_id(history.user_id)
        if moved_user is None or not moved_user.username:
            raise ProfileNotFoundError("Profile not found")
        return moved_user, moved_user.username, normalized_username

    @staticmethod
    def _split_public_jobs(jobs: list[object]) -> tuple[list[PublicJobItem], list[PublicJobItem]]:
        jobs_active: list[PublicJobItem] = []
        jobs_past: list[PublicJobItem] = []
        for job in jobs:
            row = PublicJobItem(
                id=job.id,
                title=job.title,
                category=job.category,
                location=job.location,
                status=job.status,
                created_at=job.created_at,
                channel_name=job.channel_name,
            )
            if job.deleted_at is not None or (job.status or "").lower() in PAST_JOB_STATUSES:
                jobs_past.append(row)
            else:
                jobs_active.append(row)
        return jobs_active, jobs_past

    @staticmethod
    def _public_talent_listing_item(listing: object) -> PublicTalentListingItem:
        return PublicTalentListingItem(
            id=listing.id,
            title=listing.title,
            primary_role=listing.primary_role,
            location=listing.location,
            timezone=listing.timezone,
            status=listing.status,
            is_featured=bool(listing.is_featured),
            created_at=listing.created_at,
        )

    @staticmethod
    def _public_represented_channels(
        hiring_identities: list[HiringIdentity],
    ) -> list[PublicRepresentedChannel]:
        return [
            PublicRepresentedChannel(
                id=identity.id,
                name=identity.display_name,
                avatar_url=identity.avatar_url,
                url=identity.url,
                platform=identity.platform.lower(),
                authorization_status="verified",
                is_self=False,
            )
            for identity in hiring_identities
            if identity.is_agency_represented and identity.verification_status == "VERIFIED"
        ]

    async def get_public_profile(self, username: str) -> PublicProfileResponse:
        user, moved_to_username, normalized_username = await self._resolve_user_for_public_lookup(username)
        if user is None:
            raise ProfileNotFoundError("Profile not found")

        if moved_to_username:
            return PublicProfileResponse(
                username=normalized_username,
                display_name=normalized_username,
                moved_to_username=moved_to_username,
            )

        privacy = _merge_privacy_settings(user.privacy_settings)
        channels = await self.repository.list_user_youtube_channels(user_id=user.id)
        avatar_url = await self._resolve_avatar_url(user=user, channels=channels)

        social_connections = self._build_social_connections(
            user=user,
            channels=channels,
            show_youtube=privacy["show_youtube_badge"],
        )

        badge: PublicYouTubeBadge | None = None
        if privacy["show_youtube_badge"] and channels:
            first = channels[0]
            badge = PublicYouTubeBadge(
                channel_id=first.channel_id,
                title=first.title,
                thumbnail_url=first.thumbnail_url,
            )

        jobs = await self.repository.list_jobs_for_user_public(user_id=user.id)
        jobs_active, jobs_past = self._split_public_jobs(jobs)
        selected_roles = await self._load_selected_roles_for_user(user_id=user.id)
        role_answers_summary = await self._build_role_answer_summary(user_id=user.id)
        content_style = await self._resolve_content_style_for_user(user_id=user.id)
        hiring_identities = await self.repository.list_hiring_identities_for_user(user_id=user.id)

        portfolio_rows = await self.repository.list_public_portfolio_items_for_user(user_id=user.id)
        portfolio_metadata = self._portfolio_metadata(portfolio_rows)
        content_style = self._content_style_with_portfolio_metadata(content_style, portfolio_metadata)
        talent_listing_rows = await self.repository.list_talent_listings_for_user_public(user_id=user.id)
        talent_listings_active = [
            self._public_talent_listing_item(listing) for listing in talent_listing_rows
        ]
        portfolio_now = [
            self._portfolio_to_read(item)
            for item in portfolio_rows
            if (item.status or "now") == "now"
        ]
        portfolio_past = [
            self._portfolio_to_read(item)
            for item in portfolio_rows
            if (item.status or "now") == "past"
        ]

        jobs_preview = (jobs_active + jobs_past)[:2]
        portfolio_preview = (portfolio_now + portfolio_past)[:2]
        talent_listings_preview = talent_listings_active[:2]

        return PublicProfileResponse(
            username=user.username or normalized_username,
            display_name=user.display_name or (user.username or normalized_username),
            headline=user.headline,
            bio=user.bio if privacy["show_bio"] else None,
            avatar_url=avatar_url,
            avatar_mode="youtube_channel" if user.avatar_mode == "youtube_channel" else "generic",
            banner_url=user.banner_url,
            skills=_normalize_unique_list([*(user.skills or []), *portfolio_metadata["tools"]]),
            public_links=list(user.public_links or []) if privacy["show_links"] else [],
            experience=_normalize_profile_experience(user.profile_experience),
            availability_status=(
                user.availability_status
                if user.availability_status in {"available", "selective", "unavailable"}
                else "selective"
            ),
            location=user.location,
            timezone=user.timezone,
            social_connections=social_connections,
            stats=self._build_stats(jobs=jobs, projects_count=len(portfolio_rows)),
            reviews=ReviewsSummary(avg_rating=0.0, review_count=0),
            collaboration_preferences=self._build_collaboration_preferences(user),
            hiring_info=self._build_hiring_info(user),
            creator_platforms=_normalize_unique_list([*(user.creator_platforms or []), *portfolio_metadata["platforms"]]),
            roles=selected_roles,
            role_answers_summary=role_answers_summary,
            content_style=content_style,
            youtube_badge=badge,
            represented_channels=self._public_represented_channels(hiring_identities),
            jobs_active=jobs_active,
            jobs_past=jobs_past,
            portfolio_now=portfolio_now,
            portfolio_past=portfolio_past,
            jobs_preview=jobs_preview,
            portfolio_preview=portfolio_preview,
            talent_listings_active=talent_listings_active,
            talent_listings_preview=talent_listings_preview,
            moved_to_username=None,
        )

    async def list_public_jobs(self, username: str, tab: str) -> PublicJobsListResponse:
        user, _, _ = await self._resolve_user_for_public_lookup(username)
        if user is None:
            raise ProfileNotFoundError("Profile not found")

        normalized_tab = (tab or "active").lower()
        if normalized_tab not in {"active", "past"}:
            raise ProfileValidationError("tab must be active or past")

        jobs = await self.repository.list_jobs_for_user_public(user_id=user.id)
        jobs_active, jobs_past = self._split_public_jobs(jobs)
        return PublicJobsListResponse(
            username=user.username or normalize_username(username),
            tab="active" if normalized_tab == "active" else "past",
            items=jobs_active if normalized_tab == "active" else jobs_past,
        )

    async def list_public_portfolio(self, username: str, tab: str) -> PublicPortfolioListResponse:
        user, _, _ = await self._resolve_user_for_public_lookup(username)
        if user is None:
            raise ProfileNotFoundError("Profile not found")

        normalized_tab = (tab or "now").lower()
        if normalized_tab not in {"now", "past"}:
            raise ProfileValidationError("tab must be now or past")

        portfolio_rows = await self.repository.list_public_portfolio_items_for_user(user_id=user.id)
        items = [
            self._portfolio_to_read(item)
            for item in portfolio_rows
            if (item.status or "now") == normalized_tab
        ]

        return PublicPortfolioListResponse(
            username=user.username or normalize_username(username),
            tab="now" if normalized_tab == "now" else "past",
            items=items,
        )
