from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from app.models import HiringIdentity, Job
from app.notifications import dispatch_notification
from app.repositories.job_repository import JobRepository
from app.schemas import JobCreate, JobUpdate

logger = logging.getLogger(__name__)


class JobNotFoundError(Exception):
    pass


class JobValidationError(Exception):
    pass


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
    def _apply_hiring_identity_snapshot(data: dict[str, Any], identity: HiringIdentity) -> None:
        data["hiring_identity_id"] = identity.id
        data["hiring_display_name_snapshot"] = identity.display_name
        data["hiring_platform_snapshot"] = identity.platform
        data["hiring_verification_status_snapshot"] = identity.verification_status
        data["hiring_external_url_snapshot"] = identity.url
        data["managed_by_agency_name_snapshot"] = (
            identity.managed_by_agency_name if identity.is_agency_represented else None
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

    async def list_jobs(
        self,
        *,
        limit: int,
        offset: int,
        q: str | None,
        platform: str | None,
        location: str | None,
        start_timeframe: str | None,
        status: str | None,
    ) -> tuple[list[Job], int]:
        return await self.repository.list_jobs(
            limit=limit,
            offset=offset,
            q=q,
            platform=platform,
            location=location,
            start_timeframe=start_timeframe,
            status=status,
        )

    async def get_job(self, job_id: UUID) -> Job:
        job = await self.repository.get_by_id(job_id)
        if not job:
            raise JobNotFoundError("Job not found")
        return job

    async def create_job(self, payload: JobCreate, *, actor_user_id: UUID | None = None) -> Job:
        data = self._to_payload(payload.model_dump())
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

        if actor_user_id is not None:
            actor_user = await self.repository.get_user_by_id(actor_user_id)
            if actor_user is not None and actor_user.username:
                if selected_identity is not None and selected_identity.is_agency_represented:
                    data["agency_profile_slug"] = data.get("agency_profile_slug") or actor_user.username
                elif not data.get("channel_profile_slug"):
                    data["channel_profile_slug"] = actor_user.username

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
        await self.repository.session.commit()
        return job

    async def update_job(self, job_id: UUID, payload: JobUpdate) -> Job:
        job = await self.get_job(job_id)
        return await self.update_job_record(job, payload)

    async def update_job_record(
        self, job: Job, payload: JobUpdate, *, actor_user_id: UUID | None = None
    ) -> Job:
        updates = self._to_payload(payload.model_dump(exclude_unset=True))
        # Same rule as create_job: the badge only ever comes from an identity
        # snapshot or an audited admin decision, never from the client payload.
        updates.pop("is_verified", None)
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
                self._apply_hiring_identity_snapshot(updates, selected_identity)
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
            self._apply_hiring_identity_snapshot(updates, selected_identity)

        if updates:
            job = await self.repository.update(job, updates)
            await self.repository.session.commit()
        return job

    async def delete_job(self, job_id: UUID) -> Job:
        job = await self.get_job(job_id)
        return await self.delete_job_record(job)

    async def delete_job_record(self, job: Job) -> Job:
        job = await self.repository.soft_delete(job)
        await self.repository.session.commit()
        return job
