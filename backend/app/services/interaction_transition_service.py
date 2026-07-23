"""Atomic, versioned application and hiring-request transitions."""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Conversation,
    Engagement,
    InteractionStatusEvent,
    InteractionTransitionRequest,
    Job,
    JobApplication,
    TalentInterest,
    TalentListing,
    User,
)
from app.notifications import dispatch_notification
from app.services import interaction_status, messaging_service, review_service

logger = logging.getLogger(__name__)

InteractionType = Literal["application", "hiring_request"]


class TransitionError(Exception):
    code = "transition_error"


class TransitionForbidden(TransitionError):
    code = "forbidden"


class InvalidTransition(TransitionError):
    code = "invalid_transition"


class StaleTransition(TransitionError):
    code = "stale_status"

    def __init__(self, current_status: str, current_version: int):
        super().__init__("Changed elsewhere — latest status loaded.")
        self.current_status = current_status
        self.current_version = current_version


class IdempotencyConflict(TransitionError):
    code = "idempotency_conflict"


class IntegrityViolation(TransitionError):
    code = "integrity_violation"


@dataclass
class TransitionResult:
    outcome: Literal["transitioned", "already_in_state"]
    interaction_type: InteractionType
    interaction: JobApplication | TalentInterest
    engagement: Engagement | None
    event: InteractionStatusEvent | None
    conversation: Conversation | None
    message_id: uuid.UUID | None
    notification_created: bool
    #: The manager's optional free-text note, written in the same transaction as
    #: the trusted status message. Distinct from ``message_id`` so callers can
    #: deliver both over realtime without conflating the platform's wording with
    #: the manager's own.
    note_message_id: uuid.UUID | None = None


def normalize_interest_status(value: str) -> str:
    return "accepted" if value == "contacted" else value


def _fingerprint(
    *, actor_id: uuid.UUID, interaction_type: str, interaction_id: uuid.UUID,
    status: str, expected_version: int, action: str,
) -> str:
    payload = {
        "actor": str(actor_id),
        "interaction_type": interaction_type,
        "interaction_id": str(interaction_id),
        "status": status,
        "expected_version": expected_version,
        "action": action,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _log(event: str, **fields: object) -> None:
    logger.info(event, extra={"transition": fields})


async def _idempotent_request(
    session: AsyncSession, *, key: str, fingerprint: str
) -> InteractionTransitionRequest | None:
    existing = (
        await session.execute(
            select(InteractionTransitionRequest).where(
                InteractionTransitionRequest.idempotency_key == key
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        return None
    if existing.request_fingerprint != fingerprint:
        raise IdempotencyConflict("This idempotency key belongs to a different request.")
    return existing


def _record_request(
    session: AsyncSession,
    *,
    key: str,
    fingerprint: str,
    interaction_type: InteractionType,
    interaction_id: uuid.UUID,
    actor_id: uuid.UUID,
    action: Literal["transition", "communicate"],
    requested_status: str,
    expected_version: int,
    outcome: dict,
    event: InteractionStatusEvent | None = None,
) -> InteractionTransitionRequest:
    request = InteractionTransitionRequest(
        idempotency_key=key,
        request_fingerprint=fingerprint,
        interaction_type=interaction_type,
        interaction_id=interaction_id,
        actor_user_id=actor_id,
        action=action,
        requested_status=requested_status,
        expected_version=expected_version,
        outcome_json=outcome,
        status_event_id=event.id if event else None,
    )
    session.add(request)
    return request


async def _assert_application_invariants(
    session: AsyncSession, application: JobApplication
) -> Engagement | None:
    engagement = await review_service.engagement_for_application(session, application.id)
    if application.status == "hired":
        if application.participant_status != "hired" or engagement is None:
            raise IntegrityViolation("Hired application is missing its shared state or engagement.")
        if (
            engagement.application_id != application.id
            or engagement.recruiter_user_id != application.job_owner_user_id
            or engagement.talent_user_id != application.applicant_user_id
        ):
            raise IntegrityViolation("Application engagement participants do not match.")
    elif application.participant_status == "hired":
        raise IntegrityViolation("Participant-visible Hired requires the matching manager outcome.")
    return engagement


async def _assert_interest_invariants(
    session: AsyncSession, interest: TalentInterest
) -> Engagement | None:
    engagement = await review_service.engagement_for_interest(session, interest.id)
    status = normalize_interest_status(interest.status)
    participant = normalize_interest_status(interest.participant_status)
    if status == "accepted":
        if participant != "accepted" or engagement is None:
            raise IntegrityViolation("Accepted hiring request is missing its shared state or engagement.")
        if (
            engagement.talent_interest_id != interest.id
            or engagement.recruiter_user_id != interest.recruiter_user_id
            or engagement.talent_user_id != interest.owner_user_id
        ):
            raise IntegrityViolation("Hiring-request engagement participants do not match.")
    elif participant == "accepted":
        raise IntegrityViolation("Participant-visible Accepted requires the matching manager outcome.")
    return engagement


async def _application_context(session: AsyncSession, application: JobApplication) -> tuple[str, Conversation]:
    title = (await session.execute(select(Job.title).where(Job.id == application.job_id))).scalar_one_or_none()
    conversation = await messaging_service.get_or_create_conversation_for_application(session, application)
    return title or "this job", conversation


async def _interest_context(session: AsyncSession, interest: TalentInterest) -> tuple[str, Conversation]:
    title = (
        await session.execute(select(TalentListing.title).where(TalentListing.id == interest.talent_listing_id))
    ).scalar_one_or_none()
    conversation = await messaging_service.get_or_create_conversation_for_interest(session, interest)
    return title or "this talent listing", conversation


def _clear_conversation_archive(conversation: Conversation, actor_id: uuid.UUID) -> None:
    """Return a deliberately resolved legacy interaction to the actor's workspace."""
    if conversation.participant_a_user_id == actor_id:
        conversation.participant_a_archived_at = None
    elif conversation.participant_b_user_id == actor_id:
        conversation.participant_b_archived_at = None


#: Upper bound on the manager's optional note. Long enough for a real
#: explanation, short enough that it stays a message rather than an essay.
STATUS_NOTE_MAX_LENGTH = 2000


async def _post_status_note(
    session: AsyncSession,
    *,
    conversation: Conversation,
    actor: User,
    note: str | None,
    event: InteractionStatusEvent,
    target: str,
) -> uuid.UUID | None:
    """Persist the manager's optional note beside the trusted status message.

    Written inside the caller's transaction (``commit=False``) so the note, the
    status change, the trusted event, the notification and the outbox intent
    either all land or none do — a decision must never reach the other side
    without the explanation that was promised alongside it.

    ``allow_closed`` is what makes ordering a non-issue: outcomes that close the
    thread (a shared rejection, a decline) flip ``participant_status`` in this
    same transaction, so by the time the note is written the conversation may
    already read as closed. Posting it as an ordinary message (``kind=None``)
    keeps it attributable to the manager rather than to the platform.

    The client id is derived from the status event, so replaying the same
    idempotent request resolves to the same row instead of a second note.
    """
    clean = (note or "").strip()
    if not clean:
        return None
    message = await messaging_service.post_message(
        session,
        conversation,
        actor,
        clean[:STATUS_NOTE_MAX_LENGTH],
        allow_closed=True,
        allow_blocked=True,
        notify_recipient=False,
        commit=False,
        client_message_id=uuid.uuid5(uuid.NAMESPACE_URL, f"creatorjobs:status-note:{event.id}"),
        metadata={"stage": target, "transition_id": str(event.id), "status_note": True},
    )
    return message.id


async def transition_application(
    session: AsyncSession,
    *,
    application_id: uuid.UUID,
    actor: User,
    requested_status: str,
    expected_version: int,
    idempotency_key: str,
) -> TransitionResult:
    target = requested_status
    fingerprint = _fingerprint(
        actor_id=actor.id, interaction_type="application", interaction_id=application_id,
        status=target, expected_version=expected_version, action="transition",
    )
    prior_request = await _idempotent_request(
        session, key=idempotency_key, fingerprint=fingerprint
    )
    application = (
        await session.execute(
            select(JobApplication).where(JobApplication.id == application_id).with_for_update()
        )
    ).scalar_one_or_none()
    if application is None:
        raise InvalidTransition("Application not found.")
    sender_withdrawal = target == "withdrawn"
    if sender_withdrawal:
        if application.applicant_user_id != actor.id and actor.account_type != "ADMIN":
            raise TransitionForbidden("Only the applicant can withdraw this application.")
    elif application.job_owner_user_id != actor.id and actor.account_type != "ADMIN":
        raise TransitionForbidden("Application owner required.")
    if prior_request is None:
        # A concurrent request may have committed while this transaction waited
        # for the interaction row lock. Re-read the ledger before any side effect.
        prior_request = await _idempotent_request(
            session, key=idempotency_key, fingerprint=fingerprint
        )
    if prior_request is not None:
        engagement = await _assert_application_invariants(session, application)
        prior_event = None
        if prior_request.status_event_id:
            prior_event = await session.get(InteractionStatusEvent, prior_request.status_event_id)
        _log(
            "interaction_transition_idempotent",
            transition_id=str(prior_event.id) if prior_event else None,
            interaction_type="application",
            interaction_id=str(application.id),
            actor_user_id=str(actor.id),
            new_status=target,
            status_version=application.status_version,
            idempotency_key=idempotency_key,
            final_outcome="already_in_state",
        )
        return TransitionResult("already_in_state", "application", application, engagement, prior_event, None, None, False)
    legacy_resolution = application.legacy_archive_resolution_required
    if application.status == target and not legacy_resolution:
        engagement = await _assert_application_invariants(session, application)
        _record_request(
            session,
            key=idempotency_key,
            fingerprint=fingerprint,
            interaction_type="application",
            interaction_id=application.id,
            actor_id=actor.id,
            action="transition",
            requested_status=target,
            expected_version=expected_version,
            outcome={
                "outcome": "already_in_state",
                "current_status": target,
                "status_version": application.status_version,
            },
        )
        await session.flush()
        _log(
            "interaction_transition_noop",
            interaction_type="application",
            interaction_id=str(application.id),
            actor_user_id=str(actor.id),
            new_status=target,
            status_version=application.status_version,
            idempotency_key=idempotency_key,
            final_outcome="already_in_state",
        )
        return TransitionResult("already_in_state", "application", application, engagement, None, None, None, False)
    if application.status_version != expected_version:
        raise StaleTransition(application.status, application.status_version)
    if (
        legacy_resolution
        and not sender_withdrawal
        and target not in interaction_status.LEGACY_APPLICATION_RESOLUTION_TARGETS
    ):
        raise InvalidTransition("Choose a valid current pipeline stage to restore this application.")
    if (
        application.participant_status in {"hired", "rejected", "withdrawn"}
        and target != application.participant_status
    ):
        raise InvalidTransition(
            "This shared lifecycle outcome cannot be replaced by a private pipeline stage."
        )
    withdrawal_allowed = sender_withdrawal and application.status in {
        "new", "reviewing", "shortlisted", "interviewing"
    }
    withdrawal_allowed = withdrawal_allowed or (sender_withdrawal and legacy_resolution)
    resolution_allowed = (
        legacy_resolution
        and not sender_withdrawal
        and target in interaction_status.LEGACY_APPLICATION_RESOLUTION_TARGETS
    )
    if (
        not withdrawal_allowed
        and not resolution_allowed
        and not interaction_status.application_transition_allowed(application.status, target)
    ):
        raise InvalidTransition(f"Application cannot move from {application.status} to {target}.")

    previous = application.status
    next_version = application.status_version + 1
    shared = sender_withdrawal or interaction_status.application_status_is_automatically_shared(target)
    application.status = target
    application.status_version = next_version
    if legacy_resolution:
        application.legacy_archive_resolution_required = False
    if shared:
        application.participant_status = target
    prior_engagement = await review_service.engagement_for_application(session, application.id)
    engagement = await review_service.ensure_for_application(session, application) if target == "hired" else None
    event = InteractionStatusEvent(
        interaction_type="application", interaction_id=application.id, actor_user_id=actor.id,
        previous_status=previous, new_status=target, status_version=next_version,
        event_kind="legacy_archive_resolved" if legacy_resolution else "transition",
        audience="participants" if shared else "manager_only",
        idempotency_key=idempotency_key, request_fingerprint=fingerprint,
        outcome_json={"outcome": "transitioned", "current_status": target, "status_version": next_version},
        metadata_json=(
            {
                "legacy_previous_stage_unknown": True,
                "resolution_target": target,
                "resolution_reason": "sender_withdrawal" if sender_withdrawal else "manager_selection",
            }
            if legacy_resolution
            else {}
        ),
    )
    session.add(event)
    await session.flush()
    _record_request(
        session,
        key=idempotency_key,
        fingerprint=fingerprint,
        interaction_type="application",
        interaction_id=application.id,
        actor_id=actor.id,
        action="transition",
        requested_status=target,
        expected_version=expected_version,
        outcome={"outcome": "transitioned", "current_status": target, "status_version": next_version},
        event=event,
    )
    conversation: Conversation | None = None
    message_id: uuid.UUID | None = None
    notification_created = False
    if shared:
        title, conversation = await _application_context(session, application)
        if legacy_resolution:
            _clear_conversation_archive(conversation, actor.id)
        label = {
            "interviewing": "Invited to interview",
            "hired": "Hired",
            "withdrawn": "Application withdrawn",
        }[target]
        body = f"{label} for “{title}”."
        message_key = uuid.uuid5(uuid.NAMESPACE_URL, f"creatorjobs:status:{event.id}")
        message = await messaging_service.post_message(
            session, conversation, actor, body, kind="status_update", allow_closed=True,
            allow_blocked=True, notify_recipient=False, commit=False,
            client_message_id=message_key, metadata={"stage": target, "transition_id": str(event.id)},
        )
        message_id = message.id
        recipient_id = (
            application.job_owner_user_id if sender_withdrawal else application.applicant_user_id
        )
        notification = await dispatch_notification(
            session,
            event_key="application_withdrawn" if sender_withdrawal else "application_status_changed",
            recipient_user_id=recipient_id,
            actor_user_id=actor.id,
            title="Application withdrawn" if sender_withdrawal else "Application status updated",
            body=body,
            category="application", resource_type="job_application", resource_id=str(application.id),
            action_url=f"/applications?view=inbox&mode=talent&thread={application.id}",
            payload={"status": target}, dedupe_key=f"application:{application.id}:v{next_version}:{target}",
            strict_outbox=True,
        )
        notification_created = notification is not None
    elif legacy_resolution:
        conversation = await messaging_service.get_or_create_conversation_for_application(
            session, application
        )
        _clear_conversation_archive(conversation, actor.id)
    await session.flush()
    engagement = await _assert_application_invariants(session, application)
    _log(
        "interaction_transition_committed", transition_id=str(event.id), interaction_type="application",
        interaction_id=str(application.id), actor_user_id=str(actor.id), previous_status=previous,
        new_status=target, status_version=next_version, engagement_created=engagement is not None,
        engagement_outcome=(
            "created" if engagement is not None and prior_engagement is None else
            "reused" if engagement is not None else "not_required"
        ),
        notification_outcome="created" if notification_created else "not_required",
        trusted_message_outcome="created" if message_id is not None else "not_required",
        external_delivery_intent=(
            "created" if shared and target in {"interviewing", "hired"} else "not_required"
        ),
        idempotency_key=idempotency_key,
        final_outcome="transitioned",
    )
    return TransitionResult("transitioned", "application", application, engagement, event, conversation, message_id, notification_created)


async def transition_interest(
    session: AsyncSession,
    *,
    interest_id: uuid.UUID,
    actor: User,
    requested_status: str,
    expected_version: int,
    idempotency_key: str,
    note: str | None = None,
) -> TransitionResult:
    target = normalize_interest_status(requested_status)
    fingerprint = _fingerprint(
        actor_id=actor.id, interaction_type="hiring_request", interaction_id=interest_id,
        status=target, expected_version=expected_version, action="transition",
    )
    prior_request = await _idempotent_request(
        session, key=idempotency_key, fingerprint=fingerprint
    )
    interest = (
        await session.execute(
            select(TalentInterest).where(TalentInterest.id == interest_id).with_for_update()
        )
    ).scalar_one_or_none()
    if interest is None:
        raise InvalidTransition("Hiring request not found.")
    interest.status = normalize_interest_status(interest.status)
    interest.participant_status = normalize_interest_status(interest.participant_status)
    sender_withdrawal = target == "withdrawn"
    if sender_withdrawal:
        if interest.recruiter_user_id != actor.id and actor.account_type != "ADMIN":
            raise TransitionForbidden("Only the sender can withdraw this hiring request.")
    elif interest.owner_user_id != actor.id and actor.account_type != "ADMIN":
        raise TransitionForbidden("Talent listing owner required.")
    if prior_request is None:
        prior_request = await _idempotent_request(
            session, key=idempotency_key, fingerprint=fingerprint
        )
    if prior_request is not None:
        engagement = await _assert_interest_invariants(session, interest)
        prior_event = None
        if prior_request.status_event_id:
            prior_event = await session.get(InteractionStatusEvent, prior_request.status_event_id)
        _log(
            "interaction_transition_idempotent",
            transition_id=str(prior_event.id) if prior_event else None,
            interaction_type="hiring_request",
            interaction_id=str(interest.id),
            actor_user_id=str(actor.id),
            new_status=target,
            status_version=interest.status_version,
            idempotency_key=idempotency_key,
            final_outcome="already_in_state",
        )
        return TransitionResult("already_in_state", "hiring_request", interest, engagement, prior_event, None, None, False)
    legacy_resolution = interest.legacy_archive_resolution_required
    if interest.status == target and not legacy_resolution:
        engagement = await _assert_interest_invariants(session, interest)
        _record_request(
            session,
            key=idempotency_key,
            fingerprint=fingerprint,
            interaction_type="hiring_request",
            interaction_id=interest.id,
            actor_id=actor.id,
            action="transition",
            requested_status=target,
            expected_version=expected_version,
            outcome={
                "outcome": "already_in_state",
                "current_status": target,
                "status_version": interest.status_version,
            },
        )
        await session.flush()
        _log(
            "interaction_transition_noop",
            interaction_type="hiring_request",
            interaction_id=str(interest.id),
            actor_user_id=str(actor.id),
            new_status=target,
            status_version=interest.status_version,
            idempotency_key=idempotency_key,
            final_outcome="already_in_state",
        )
        return TransitionResult("already_in_state", "hiring_request", interest, engagement, None, None, None, False)
    if interest.status_version != expected_version:
        raise StaleTransition(interest.status, interest.status_version)
    if (
        legacy_resolution
        and not sender_withdrawal
        and target not in interaction_status.LEGACY_INTEREST_RESOLUTION_TARGETS
    ):
        raise InvalidTransition("Choose a valid current pipeline stage to restore this hiring request.")
    if (
        interest.participant_status in {"accepted", "declined", "withdrawn"}
        and target != interest.participant_status
    ):
        raise InvalidTransition(
            "This shared lifecycle outcome cannot be replaced by a private pipeline stage."
        )
    withdrawal_allowed = sender_withdrawal and interest.status in {"new", "reviewing"}
    withdrawal_allowed = withdrawal_allowed or (sender_withdrawal and legacy_resolution)
    resolution_allowed = (
        legacy_resolution
        and not sender_withdrawal
        and target in interaction_status.LEGACY_INTEREST_RESOLUTION_TARGETS
    )
    if (
        not withdrawal_allowed
        and not resolution_allowed
        and not interaction_status.interest_transition_allowed(interest.status, target)
    ):
        raise InvalidTransition(f"Hiring request cannot move from {interest.status} to {target}.")

    previous = interest.status
    next_version = interest.status_version + 1
    shared = sender_withdrawal or interaction_status.interest_status_is_automatically_shared(target)
    interest.status = target
    interest.status_version = next_version
    if legacy_resolution:
        interest.legacy_archive_resolution_required = False
    if shared:
        interest.participant_status = target
    prior_engagement = await review_service.engagement_for_interest(session, interest.id)
    engagement = await review_service.ensure_for_interest(session, interest) if target == "accepted" else None
    event = InteractionStatusEvent(
        interaction_type="hiring_request", interaction_id=interest.id, actor_user_id=actor.id,
        previous_status=previous, new_status=target, status_version=next_version,
        event_kind="legacy_archive_resolved" if legacy_resolution else "transition",
        audience="participants" if shared else "manager_only",
        idempotency_key=idempotency_key, request_fingerprint=fingerprint,
        outcome_json={"outcome": "transitioned", "current_status": target, "status_version": next_version},
        metadata_json=(
            {
                "legacy_previous_stage_unknown": True,
                "resolution_target": target,
                "resolution_reason": "sender_withdrawal" if sender_withdrawal else "manager_selection",
            }
            if legacy_resolution
            else {}
        ),
    )
    session.add(event)
    await session.flush()
    _record_request(
        session,
        key=idempotency_key,
        fingerprint=fingerprint,
        interaction_type="hiring_request",
        interaction_id=interest.id,
        actor_id=actor.id,
        action="transition",
        requested_status=target,
        expected_version=expected_version,
        outcome={"outcome": "transitioned", "current_status": target, "status_version": next_version},
        event=event,
    )
    conversation: Conversation | None = None
    message_id: uuid.UUID | None = None
    note_message_id: uuid.UUID | None = None
    notification_created = False
    if shared:
        _, conversation = await _interest_context(session, interest)
        if legacy_resolution:
            _clear_conversation_archive(conversation, actor.id)
        body = {
            "accepted": "Hiring request accepted.",
            "declined": "Hiring request declined.",
            "withdrawn": "Hiring request withdrawn.",
        }[target]
        message_key = uuid.uuid5(uuid.NAMESPACE_URL, f"creatorjobs:status:{event.id}")
        message = await messaging_service.post_message(
            session, conversation, actor, body, kind="status_update", allow_closed=True,
            allow_blocked=True, notify_recipient=False, commit=False,
            client_message_id=message_key, metadata={"stage": target, "transition_id": str(event.id)},
        )
        message_id = message.id
        # Hiring-request outcomes share at the moment of transition, so this is
        # the only chance to attach the sender's explanation atomically.
        note_message_id = await _post_status_note(
            session, conversation=conversation, actor=actor, note=note, event=event, target=target,
        )
        recipient_id = interest.owner_user_id if sender_withdrawal else interest.recruiter_user_id
        notification = await dispatch_notification(
            session,
            event_key=(
                "talent_interest_withdrawn"
                if sender_withdrawal
                else "talent_interest_status_changed"
            ),
            recipient_user_id=recipient_id,
            actor_user_id=actor.id,
            title="Hiring request withdrawn" if sender_withdrawal else "Hiring request updated",
            body=body,
            category="talent", resource_type="talent_interest", resource_id=str(interest.id),
            action_url=f"/applications?view=inbox&mode=recruiter&thread={interest.id}",
            payload={"status": target}, dedupe_key=f"hiring-request:{interest.id}:v{next_version}:{target}",
            strict_outbox=True,
        )
        notification_created = notification is not None
    elif legacy_resolution:
        conversation = await messaging_service.get_or_create_conversation_for_interest(
            session, interest
        )
        _clear_conversation_archive(conversation, actor.id)
    await session.flush()
    engagement = await _assert_interest_invariants(session, interest)
    _log(
        "interaction_transition_committed", transition_id=str(event.id), interaction_type="hiring_request",
        interaction_id=str(interest.id), actor_user_id=str(actor.id), previous_status=previous,
        new_status=target, status_version=next_version,
        engagement_outcome=(
            "created" if engagement is not None and prior_engagement is None else
            "reused" if engagement is not None else "not_required"
        ),
        notification_outcome="created" if notification_created else "not_required",
        trusted_message_outcome="created" if message_id is not None else "not_required",
        external_delivery_intent="not_required",
        idempotency_key=idempotency_key,
        final_outcome="transitioned",
    )
    return TransitionResult("transitioned", "hiring_request", interest, engagement, event, conversation, message_id, notification_created, note_message_id)


async def share_application_status(
    session: AsyncSession,
    *,
    application_id: uuid.UUID,
    actor: User,
    requested_status: str,
    expected_version: int,
    idempotency_key: str,
    note: str | None = None,
) -> TransitionResult:
    application = (
        await session.execute(
            select(JobApplication).where(JobApplication.id == application_id).with_for_update()
        )
    ).scalar_one_or_none()
    if application is None:
        raise InvalidTransition("Application not found.")
    if application.job_owner_user_id != actor.id and actor.account_type != "ADMIN":
        raise TransitionForbidden("Application owner required.")
    target = requested_status
    if target not in interaction_status.APPLICATION_OPTIONAL_SHARED_STATUSES:
        raise InvalidTransition("This status cannot be shared separately.")
    fingerprint = _fingerprint(
        actor_id=actor.id, interaction_type="application", interaction_id=application_id,
        status=target, expected_version=expected_version, action="communicate",
    )
    prior = await _idempotent_request(session, key=idempotency_key, fingerprint=fingerprint)
    if prior is not None:
        event = await session.get(InteractionStatusEvent, prior.status_event_id) if prior.status_event_id else None
        _log(
            "interaction_communication_idempotent",
            transition_id=str(event.id) if event else None,
            interaction_type="application",
            interaction_id=str(application.id),
            actor_user_id=str(actor.id),
            new_status=target,
            status_version=application.status_version,
            idempotency_key=idempotency_key,
            final_outcome="already_in_state",
        )
        return TransitionResult("already_in_state", "application", application, None, event, None, None, False)
    if application.status != target:
        raise StaleTransition(application.status, application.status_version)
    if application.participant_status == target:
        _record_request(
            session,
            key=idempotency_key,
            fingerprint=fingerprint,
            interaction_type="application",
            interaction_id=application.id,
            actor_id=actor.id,
            action="communicate",
            requested_status=target,
            expected_version=expected_version,
            outcome={
                "outcome": "already_in_state",
                "current_status": target,
                "status_version": application.status_version,
            },
        )
        await session.flush()
        _log(
            "interaction_communication_noop",
            interaction_type="application",
            interaction_id=str(application.id),
            actor_user_id=str(actor.id),
            new_status=target,
            status_version=application.status_version,
            idempotency_key=idempotency_key,
            final_outcome="already_in_state",
        )
        return TransitionResult("already_in_state", "application", application, None, None, None, None, False)
    if application.status_version != expected_version:
        raise StaleTransition(application.status, application.status_version)
    previous_version = application.status_version
    next_version = previous_version + 1
    event = InteractionStatusEvent(
        interaction_type="application", interaction_id=application.id, actor_user_id=actor.id,
        previous_status=application.participant_status, new_status=target,
        status_version=next_version, event_kind="communicated", audience="participants",
        idempotency_key=idempotency_key, request_fingerprint=fingerprint,
        outcome_json={"outcome": "transitioned", "current_status": target, "status_version": next_version},
    )
    session.add(event)
    await session.flush()
    _record_request(
        session,
        key=idempotency_key,
        fingerprint=fingerprint,
        interaction_type="application",
        interaction_id=application.id,
        actor_id=actor.id,
        action="communicate",
        requested_status=target,
        expected_version=expected_version,
        outcome={
            "outcome": "transitioned",
            "current_status": target,
            "status_version": next_version,
        },
        event=event,
    )
    application.participant_status = target
    application.status_version = next_version
    title, conversation = await _application_context(session, application)
    label = "Shortlisted" if target == "shortlisted" else "Not moving forward"
    body = f"{label} for “{title}”."
    message = await messaging_service.post_message(
        session, conversation, actor, body, kind="status_update", allow_closed=True,
        allow_blocked=True, notify_recipient=False, commit=False,
        client_message_id=uuid.uuid5(uuid.NAMESPACE_URL, f"creatorjobs:status:{event.id}"),
        metadata={"stage": target, "transition_id": str(event.id)},
    )
    # An application's decision is saved privately first and only reaches the
    # applicant here, so the explanation belongs to this step rather than to the
    # earlier private transition.
    note_message_id = await _post_status_note(
        session, conversation=conversation, actor=actor, note=note, event=event, target=target,
    )
    await dispatch_notification(
        session, event_key="application_status_changed", recipient_user_id=application.applicant_user_id,
        actor_user_id=actor.id, title="Application status updated", body=body,
        category="application", resource_type="job_application", resource_id=str(application.id),
        action_url=f"/applications?view=inbox&mode=talent&thread={application.id}",
        payload={"status": target},
        dedupe_key=f"application:{application.id}:v{next_version}:{target}:communicated",
        strict_outbox=True,
    )
    await session.flush()
    _log(
        "interaction_communication_committed",
        transition_id=str(event.id),
        interaction_type="application",
        interaction_id=str(application.id),
        actor_user_id=str(actor.id),
        previous_status=event.previous_status,
        new_status=target,
        status_version=next_version,
        idempotency_key=idempotency_key,
        engagement_outcome="not_required",
        notification_outcome="created",
        trusted_message_outcome="created",
        external_delivery_intent="created",
        final_outcome="transitioned",
    )
    return TransitionResult("transitioned", "application", application, None, event, conversation, message.id, True, note_message_id)
