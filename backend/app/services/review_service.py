"""Trusted engagement lifecycle and blind two-sided review rules."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.account_state import account_is_blocked
from app.models import (
    Conversation,
    Engagement,
    EngagementReview,
    Job,
    JobApplication,
    Message,
    Notification,
    TalentInterest,
    TalentListing,
    User,
)
from app.notifications import dispatch_notification
from app.schemas.reviews import (
    EngagementSummary,
    MyReviewRead,
    ProfileReviewCollection,
    PublicReviewItem,
    ReviewOpportunity,
    ReviewsByMode,
    ReviewSummary,
    ReviewWorkspaceResponse,
)
from app.services import messaging_service

START_CONFIRMATION_DAYS = 7
COMPLETION_CONFIRMATION_DAYS = 7
REVIEW_WINDOW_DAYS = 14

TERMINAL_REVIEWABLE = {"completed", "ended_after_start"}
TERMINAL_STATES = {*TERMINAL_REVIEWABLE, "cancelled_before_start"}

TALENT_DIMENSIONS = {"quality_of_work", "communication", "reliability"}
HIRING_DIMENSIONS = {"brief_clarity", "communication", "professionalism"}


class ReviewDomainError(Exception):
    pass


class EngagementNotFound(ReviewDomainError):
    pass


class EngagementForbidden(ReviewDomainError):
    pass


class InvalidEngagementTransition(ReviewDomainError):
    pass


class ReviewUnavailable(ReviewDomainError):
    pass


def utcnow() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _clean_text(value: str | None, *, max_length: int) -> str | None:
    cleaned = (value or "").replace("\x00", "").strip()
    return cleaned[:max_length] or None


def _context_label(engagement: Engagement) -> str:
    return str((engagement.context_snapshot or {}).get("context_label") or "CreatorJobs engagement")


def _participant_ids(engagement: Engagement) -> tuple[UUID | None, UUID | None]:
    return engagement.recruiter_user_id, engagement.talent_user_id


def _require_participant(engagement: Engagement, user_id: UUID) -> None:
    if user_id not in _participant_ids(engagement):
        raise EngagementForbidden("You are not a participant in this engagement.")


def _other_participant(engagement: Engagement, user_id: UUID) -> UUID | None:
    _require_participant(engagement, user_id)
    return (
        engagement.talent_user_id
        if user_id == engagement.recruiter_user_id
        else engagement.recruiter_user_id
    )


def _direction_for(engagement: Engagement, reviewer_id: UUID) -> tuple[str, UUID | None, str]:
    _require_participant(engagement, reviewer_id)
    if reviewer_id == engagement.recruiter_user_id:
        return "recruiter_to_talent", engagement.talent_user_id, "hiring"
    return "talent_to_recruiter", engagement.recruiter_user_id, "talent"


async def _conversation_for_engagement(
    session: AsyncSession, engagement: Engagement
) -> Conversation | None:
    if engagement.application_id:
        application = await session.get(JobApplication, engagement.application_id)
        if application:
            return await messaging_service.get_or_create_conversation_for_application(session, application)
    if engagement.talent_interest_id:
        interest = await session.get(TalentInterest, engagement.talent_interest_id)
        if interest:
            return await messaging_service.get_or_create_conversation_for_interest(session, interest)
    return None


async def _timeline_event(
    session: AsyncSession,
    engagement: Engagement,
    actor_user_id: UUID,
    body: str,
) -> None:
    conversation = await _conversation_for_engagement(session, engagement)
    if conversation is None:
        return
    message = Message(
        conversation_id=conversation.id,
        sender_user_id=actor_user_id,
        body=body,
        metadata_json={"kind": "engagement_update", "engagement_id": str(engagement.id)},
        created_at=utcnow(),
    )
    session.add(message)
    await session.flush()
    conversation.last_message_at = message.created_at or utcnow()


def _action_url(engagement: Engagement, viewer_id: UUID) -> str:
    mode = "recruiter" if viewer_id == engagement.recruiter_user_id else "talent"
    return f"/applications?view=inbox&mode={mode}&thread={engagement.source_record_id}"


async def _notify_other(
    session: AsyncSession,
    engagement: Engagement,
    actor_user_id: UUID,
    *,
    event_key: str,
    title: str,
    body: str,
) -> None:
    recipient_user_id = _other_participant(engagement, actor_user_id)
    if recipient_user_id is None:
        return
    await dispatch_notification(
        session,
        event_key=event_key,
        recipient_user_id=recipient_user_id,
        actor_user_id=actor_user_id,
        title=title,
        body=body,
        category="activity",
        resource_type="engagement",
        resource_id=str(engagement.id),
        action_url=_action_url(engagement, recipient_user_id),
        payload={"engagement_id": str(engagement.id), "context_label": _context_label(engagement)},
    )


async def _notify_both_review_available(
    session: AsyncSession, engagement: Engagement, actor_user_id: UUID | None
) -> None:
    for user_id in _participant_ids(engagement):
        if user_id is None:
            continue
        await dispatch_notification(
            session,
            event_key="review_available",
            recipient_user_id=user_id,
            actor_user_id=actor_user_id if actor_user_id != user_id else None,
            title="Feedback is now available",
            body=f"Share feedback about {_context_label(engagement)} within 14 days.",
            category="activity",
            resource_type="engagement",
            resource_id=str(engagement.id),
            action_url="/you?tab=reviews",
            payload={"engagement_id": str(engagement.id)},
        )


async def _finalize(
    session: AsyncSession,
    engagement: Engagement,
    *,
    outcome: str,
    actor_user_id: UUID | None,
    now: datetime,
) -> None:
    engagement.status = outcome
    engagement.finalized_at = now
    engagement.review_window_ends_at = now + timedelta(days=REVIEW_WINDOW_DAYS)
    engagement.completion_response_due_at = None
    outcome_label = "completed" if outcome == "completed" else "ended after work began"
    for user_id in _participant_ids(engagement):
        if user_id is None:
            continue
        await dispatch_notification(
            session,
            event_key="engagement_completed",
            recipient_user_id=user_id,
            actor_user_id=actor_user_id if actor_user_id != user_id else None,
            title="Engagement outcome confirmed",
            body=f"{_context_label(engagement)} has {outcome_label}.",
            category="activity",
            resource_type="engagement",
            resource_id=str(engagement.id),
            action_url=_action_url(engagement, user_id),
            payload={"engagement_id": str(engagement.id), "outcome": outcome},
        )
    await _notify_both_review_available(session, engagement, actor_user_id)
    timeline_actor = actor_user_id or engagement.completion_requested_by_user_id
    if timeline_actor:
        label = "Engagement completed." if outcome == "completed" else "Engagement ended after work began."
        await _timeline_event(session, engagement, timeline_actor, label)


async def reconcile_engagement(
    session: AsyncSession,
    engagement: Engagement,
    *,
    now: datetime | None = None,
    loaded_reviews: list[EngagementReview] | None = None,
) -> bool:
    """Apply deadline-driven transitions once, on any relevant read or action."""
    current = now or utcnow()
    changed = False
    start_due = _aware(engagement.start_response_due_at)
    completion_due = _aware(engagement.completion_response_due_at)
    if engagement.status == "start_pending" and start_due and start_due <= current:
        timeline_actor = engagement.start_requested_by_user_id
        engagement.status = "ready_to_start"
        engagement.start_requested_by_user_id = None
        engagement.start_requested_at = None
        engagement.start_response_due_at = None
        if timeline_actor:
            await _timeline_event(session, engagement, timeline_actor, "Start confirmation expired. Ready to start again.")
        changed = True
    elif engagement.status == "completion_pending" and completion_due and completion_due <= current:
        await _finalize(
            session,
            engagement,
            outcome=engagement.requested_outcome or "completed",
            actor_user_id=engagement.completion_requested_by_user_id,
            now=current,
        )
        changed = True
    if changed:
        await session.flush()
    await reconcile_review_publication(
        session,
        engagement,
        now=current,
        loaded_reviews=loaded_reviews,
    )
    return changed


async def reconcile_review_publication(
    session: AsyncSession,
    engagement: Engagement,
    *,
    now: datetime | None = None,
    loaded_reviews: list[EngagementReview] | None = None,
) -> bool:
    current = now or utcnow()
    if engagement.status not in TERMINAL_REVIEWABLE or engagement.started_at is None:
        return False
    reviews = loaded_reviews
    if reviews is None:
        reviews = list(
            (
                await session.execute(
                    select(EngagementReview).where(
                        EngagementReview.engagement_id == engagement.id
                    )
                )
            )
            .scalars()
            .all()
        )
    submitted = [review for review in reviews if review.status == "submitted"]
    both_submitted = len({review.direction for review in submitted}) == 2
    window_ended = bool(
        _aware(engagement.review_window_ends_at)
        and _aware(engagement.review_window_ends_at) <= current
    )
    if not submitted or not (both_submitted or window_ended):
        return False
    changed = False
    for review in submitted:
        review.status = "published"
        review.published_at = current
        changed = True
    if changed:
        for user_id in _participant_ids(engagement):
            if user_id is None:
                continue
            await dispatch_notification(
                session,
                event_key="review_published",
                recipient_user_id=user_id,
                title="Engagement feedback published",
                body=f"Feedback for {_context_label(engagement)} is now visible.",
                category="profile",
                resource_type="engagement",
                resource_id=str(engagement.id),
                action_url="/you?tab=reviews",
                payload={"engagement_id": str(engagement.id)},
            )
        await session.flush()
    return changed


async def engagement_for_application(
    session: AsyncSession, application_id: UUID
) -> Engagement | None:
    return (
        await session.execute(select(Engagement).where(Engagement.application_id == application_id))
    ).scalar_one_or_none()


async def engagement_for_interest(
    session: AsyncSession, interest_id: UUID
) -> Engagement | None:
    return (
        await session.execute(
            select(Engagement).where(Engagement.talent_interest_id == interest_id)
        )
    ).scalar_one_or_none()


async def ensure_for_application(
    session: AsyncSession, application: JobApplication
) -> Engagement:
    # Lock the immutable source row so two retries cannot both pass the
    # existence check. Database uniqueness remains the final guard.
    await session.execute(
        select(JobApplication.id).where(JobApplication.id == application.id).with_for_update()
    )
    existing = await engagement_for_application(session, application.id)
    if existing:
        return existing
    if application.status != "hired" or application.job_owner_user_id is None:
        raise InvalidEngagementTransition("The application must be hired before work can start.")
    job = await session.get(Job, application.job_id)
    recruiter = await session.get(User, application.job_owner_user_id)
    talent = await session.get(User, application.applicant_user_id)
    engagement = Engagement(
        source_type="job_application",
        source_record_id=application.id,
        application_id=application.id,
        recruiter_user_id=application.job_owner_user_id,
        talent_user_id=application.applicant_user_id,
        context_snapshot={
            "context_label": job.title if job else "Job engagement",
            "recruiter_name": (recruiter.display_name or recruiter.username) if recruiter else "Hiring team",
            "talent_name": (talent.display_name or talent.username) if talent else "Talent",
        },
    )
    session.add(engagement)
    await session.flush()
    return engagement


async def ensure_for_interest(session: AsyncSession, interest: TalentInterest) -> Engagement:
    await session.execute(
        select(TalentInterest.id).where(TalentInterest.id == interest.id).with_for_update()
    )
    existing = await engagement_for_interest(session, interest.id)
    if existing:
        return existing
    if interest.status not in {"accepted", "contacted"}:
        raise InvalidEngagementTransition("The hiring request must be accepted before work can start.")
    listing = await session.get(TalentListing, interest.talent_listing_id)
    recruiter = await session.get(User, interest.recruiter_user_id)
    talent = await session.get(User, interest.owner_user_id)
    engagement = Engagement(
        source_type="talent_interest",
        source_record_id=interest.id,
        talent_interest_id=interest.id,
        recruiter_user_id=interest.recruiter_user_id,
        talent_user_id=interest.owner_user_id,
        context_snapshot={
            "context_label": listing.title if listing else "Talent engagement",
            "recruiter_name": (recruiter.display_name or recruiter.username) if recruiter else "Hiring team",
            "talent_name": (talent.display_name or talent.username) if talent else "Talent",
        },
    )
    session.add(engagement)
    await session.flush()
    return engagement


async def _locked_engagement(session: AsyncSession, engagement_id: UUID) -> Engagement:
    engagement = (
        await session.execute(
            select(Engagement).where(Engagement.id == engagement_id).with_for_update()
        )
    ).scalar_one_or_none()
    if engagement is None:
        raise EngagementNotFound("Engagement not found.")
    await reconcile_engagement(session, engagement)
    return engagement


async def request_start(
    session: AsyncSession, engagement: Engagement, actor: User
) -> Engagement:
    _require_participant(engagement, actor.id)
    await reconcile_engagement(session, engagement)
    if engagement.status == "start_pending" and engagement.start_requested_by_user_id == actor.id:
        return engagement
    if engagement.status != "ready_to_start":
        raise InvalidEngagementTransition("Work can only be started from Ready to start.")
    now = utcnow()
    engagement.status = "start_pending"
    engagement.start_requested_by_user_id = actor.id
    engagement.start_requested_at = now
    engagement.start_response_due_at = now + timedelta(days=START_CONFIRMATION_DAYS)
    await _timeline_event(session, engagement, actor.id, "Work start confirmation requested.")
    await _notify_other(
        session,
        engagement,
        actor.id,
        event_key="engagement_start_requested",
        title="Confirm that work has started",
        body=f"Confirm the start of {_context_label(engagement)}.",
    )
    await session.flush()
    return engagement


async def start_response(
    session: AsyncSession, engagement_id: UUID, actor: User, decision: str
) -> Engagement:
    engagement = await _locked_engagement(session, engagement_id)
    _require_participant(engagement, actor.id)
    if engagement.status != "start_pending":
        raise InvalidEngagementTransition("There is no start request awaiting confirmation.")
    if engagement.start_requested_by_user_id == actor.id:
        raise InvalidEngagementTransition("The other participant must confirm the start request.")
    now = utcnow()
    if decision == "confirm":
        engagement.status = "active"
        engagement.started_at = now
        engagement.start_response_due_at = None
        await _timeline_event(session, engagement, actor.id, "Work started.")
        await _notify_other(
            session,
            engagement,
            actor.id,
            event_key="engagement_started",
            title="Work has started",
            body=f"{_context_label(engagement)} is now in progress.",
        )
    else:
        engagement.status = "cancelled_before_start"
        engagement.finalized_at = now
        engagement.start_response_due_at = None
        await _timeline_event(session, engagement, actor.id, "Engagement closed before work started.")
        await _notify_other(
            session,
            engagement,
            actor.id,
            event_key="engagement_cancelled",
            title="Work did not start",
            body=f"{_context_label(engagement)} was closed before work started.",
        )
    await session.flush()
    return engagement


async def cancel_before_start(
    session: AsyncSession, engagement_id: UUID, actor: User
) -> Engagement:
    engagement = await _locked_engagement(session, engagement_id)
    _require_participant(engagement, actor.id)
    if engagement.status not in {"ready_to_start", "start_pending"}:
        raise InvalidEngagementTransition("This engagement can no longer be cancelled before start.")
    engagement.status = "cancelled_before_start"
    engagement.finalized_at = utcnow()
    engagement.start_response_due_at = None
    await _timeline_event(session, engagement, actor.id, "Engagement cancelled before work started.")
    await _notify_other(
        session,
        engagement,
        actor.id,
        event_key="engagement_cancelled",
        title="Engagement cancelled",
        body=f"{_context_label(engagement)} was cancelled before work started.",
    )
    await session.flush()
    return engagement


async def request_completion(
    session: AsyncSession,
    engagement_id: UUID,
    actor: User,
    *,
    outcome: str,
    note: str | None,
) -> Engagement:
    engagement = await _locked_engagement(session, engagement_id)
    _require_participant(engagement, actor.id)
    if engagement.status != "active":
        raise InvalidEngagementTransition("Only active work can be marked complete or ended.")
    now = utcnow()
    engagement.status = "completion_pending"
    engagement.completion_requested_by_user_id = actor.id
    engagement.completion_requested_at = now
    engagement.completion_response_due_at = now + timedelta(days=COMPLETION_CONFIRMATION_DAYS)
    engagement.requested_outcome = outcome
    engagement.completion_note = _clean_text(note, max_length=500)
    label = "Completion confirmation requested." if outcome == "completed" else "End confirmation requested."
    await _timeline_event(session, engagement, actor.id, label)
    await _notify_other(
        session,
        engagement,
        actor.id,
        event_key="engagement_completion_requested",
        title="Confirm the engagement outcome",
        body=f"Review the update for {_context_label(engagement)}.",
    )
    await session.flush()
    return engagement


async def completion_response(
    session: AsyncSession,
    engagement_id: UUID,
    actor: User,
    *,
    decision: str,
    note: str | None,
) -> Engagement:
    engagement = await _locked_engagement(session, engagement_id)
    _require_participant(engagement, actor.id)
    if engagement.status != "completion_pending":
        raise InvalidEngagementTransition("There is no completion request awaiting confirmation.")
    if engagement.completion_requested_by_user_id == actor.id:
        raise InvalidEngagementTransition("The other participant must confirm the outcome.")
    if decision == "confirm":
        await _finalize(
            session,
            engagement,
            outcome=engagement.requested_outcome or "completed",
            actor_user_id=actor.id,
            now=utcnow(),
        )
    else:
        engagement.status = "active"
        engagement.latest_issue_by_user_id = actor.id
        engagement.latest_issue_note = _clean_text(note, max_length=1000)
        engagement.latest_issue_at = utcnow()
        engagement.completion_response_due_at = None
        engagement.completion_requested_by_user_id = None
        engagement.completion_requested_at = None
        engagement.requested_outcome = None
        engagement.completion_note = None
        await _timeline_event(session, engagement, actor.id, "Completion needs attention. Work remains active.")
        await _notify_other(
            session,
            engagement,
            actor.id,
            event_key="engagement_completion_needs_attention",
            title="Completion needs attention",
            body=f"Continue the conversation about {_context_label(engagement)}.",
        )
    await session.flush()
    return engagement


async def _review_for_direction(
    session: AsyncSession, engagement_id: UUID, direction: str
) -> EngagementReview | None:
    return (
        await session.execute(
            select(EngagementReview).where(
                EngagementReview.engagement_id == engagement_id,
                EngagementReview.direction == direction,
            )
        )
    ).scalar_one_or_none()


def _my_review_read(review: EngagementReview, engagement: Engagement) -> MyReviewRead:
    return MyReviewRead(
        id=review.id,
        engagement_id=review.engagement_id,
        direction=review.direction,
        overall_rating=review.overall_rating,
        dimension_ratings=review.dimension_ratings or {},
        public_feedback=review.public_feedback,
        status=review.status,
        submitted_at=review.submitted_at,
        published_at=review.published_at,
        editable=review.status == "submitted" and bool(
            _aware(engagement.review_window_ends_at)
            and _aware(engagement.review_window_ends_at) > utcnow()
        ),
    )


async def review_state_for(
    session: AsyncSession,
    engagement: Engagement,
    viewer_id: UUID,
    *,
    loaded_reviews: list[EngagementReview] | None = None,
) -> str:
    direction, _, _ = _direction_for(engagement, viewer_id)
    if loaded_reviews is None:
        review = await _review_for_direction(session, engagement.id, direction)
    else:
        review = next(
            (item for item in loaded_reviews if item.direction == direction),
            None,
        )
    if review:
        return "submitted" if review.status == "submitted" else "published"
    if engagement.status not in TERMINAL_REVIEWABLE or engagement.started_at is None:
        return "not_eligible"
    window_end = _aware(engagement.review_window_ends_at)
    if not window_end or window_end <= utcnow():
        return "expired"
    return "available"


def _engagement_summary_read(
    engagement: Engagement,
    viewer_id: UUID,
    state: str,
) -> EngagementSummary:
    actions: list[str] = []
    if engagement.status == "ready_to_start":
        actions = ["request_start", "cancel_before_start"]
    elif engagement.status == "start_pending":
        if engagement.start_requested_by_user_id != viewer_id:
            actions = ["confirm_start", "decline_start"]
        else:
            actions = ["cancel_before_start"]
    elif engagement.status == "active":
        actions = ["request_completion"]
    elif (
        engagement.status == "completion_pending"
        and engagement.completion_requested_by_user_id != viewer_id
    ):
        actions = ["confirm_completion", "flag_completion_issue"]
    elif state == "available":
        actions = ["write_review"]
    elif state == "submitted":
        actions = ["edit_review"]
    snapshot = engagement.context_snapshot or {}
    counterpart_key = (
        "talent_name"
        if viewer_id == engagement.recruiter_user_id
        else "recruiter_name"
    )
    response_due = (
        engagement.start_response_due_at
        if engagement.status == "start_pending"
        else engagement.completion_response_due_at
    )
    return EngagementSummary(
        id=engagement.id,
        # Payment is passed through untouched: it is read from the record, never
        # derived from the engagement's status, and never used to decide one.
        payment_state=engagement.payment_state,
        payment_state_updated_at=engagement.payment_state_updated_at,
        payment_note=engagement.payment_note,
        source_type=engagement.source_type,
        source_record_id=engagement.source_record_id,
        status=engagement.status,
        context_label=_context_label(engagement),
        counterpart_name=str(snapshot.get(counterpart_key) or "Collaborator"),
        started_at=engagement.started_at,
        response_due_at=response_due,
        finalized_at=engagement.finalized_at,
        review_window_ends_at=engagement.review_window_ends_at,
        available_actions=actions,
        review_state=state,
    )


async def engagement_summaries(
    session: AsyncSession,
    engagements: list[Engagement],
    viewer_id: UUID,
    *,
    rows_locked: bool = False,
) -> dict[UUID, EngagementSummary]:
    """Summarize a list with a bounded set of ordinary-read queries.

    Deadline reconciliation remains a write path and may perform the messages
    and notifications required by each transition. The stable read path locks
    all rows together and loads review state once, rather than issuing three
    queries for every visible interaction.
    """
    by_id = {engagement.id: engagement for engagement in engagements}
    if not by_id:
        return {}
    if not rows_locked:
        locked_rows = list(
            (
                await session.execute(
                    select(Engagement)
                    .where(Engagement.id.in_(by_id))
                    .order_by(Engagement.id)
                    .with_for_update()
                )
            )
            .scalars()
            .all()
        )
        by_id.update({engagement.id: engagement for engagement in locked_rows})

    review_rows = list(
        (
            await session.execute(
                select(EngagementReview).where(
                    EngagementReview.engagement_id.in_(by_id)
                )
            )
        )
        .scalars()
        .all()
    )
    reviews_by_engagement: dict[UUID, list[EngagementReview]] = {
        engagement_id: [] for engagement_id in by_id
    }
    for review in review_rows:
        reviews_by_engagement[review.engagement_id].append(review)

    result: dict[UUID, EngagementSummary] = {}
    for engagement in by_id.values():
        _require_participant(engagement, viewer_id)
        loaded_reviews = reviews_by_engagement[engagement.id]
        await reconcile_engagement(
            session,
            engagement,
            loaded_reviews=loaded_reviews,
        )
        state = await review_state_for(
            session,
            engagement,
            viewer_id,
            loaded_reviews=loaded_reviews,
        )
        result[engagement.id] = _engagement_summary_read(
            engagement,
            viewer_id,
            state,
        )
    return result


async def engagement_summary(
    session: AsyncSession,
    engagement: Engagement,
    viewer_id: UUID,
) -> EngagementSummary:
    summaries = await engagement_summaries(session, [engagement], viewer_id)
    return summaries[engagement.id]


async def upsert_review(
    session: AsyncSession,
    engagement_id: UUID,
    actor: User,
    *,
    overall_rating: int,
    dimension_ratings: dict[str, int],
    public_feedback: str | None,
) -> MyReviewRead:
    engagement = await _locked_engagement(session, engagement_id)
    _require_participant(engagement, actor.id)
    if engagement.status not in TERMINAL_REVIEWABLE or engagement.started_at is None:
        raise ReviewUnavailable("Feedback is available only after confirmed work ends.")
    window_end = _aware(engagement.review_window_ends_at)
    if not window_end or window_end <= utcnow():
        raise ReviewUnavailable("The feedback window has closed.")
    direction, reviewee_id, actor_mode = _direction_for(engagement, actor.id)
    allowed_dimensions = TALENT_DIMENSIONS if direction == "recruiter_to_talent" else HIRING_DIMENSIONS
    unknown = set(dimension_ratings) - allowed_dimensions
    if unknown:
        raise ReviewUnavailable(f"Unsupported rating dimensions: {', '.join(sorted(unknown))}")
    review = await _review_for_direction(session, engagement.id, direction)
    if review and review.status != "submitted":
        raise ReviewUnavailable("Published feedback can no longer be edited.")
    now = utcnow()
    snapshot = {
        "display_name": actor.display_name or actor.username or "Collaborator",
        "username": actor.username,
        "avatar_url": actor.avatar_url,
        "role": "Hiring team" if actor_mode == "hiring" else "Creator talent",
    }
    if review is None:
        review = EngagementReview(
            engagement_id=engagement.id,
            reviewer_user_id=actor.id,
            reviewee_user_id=reviewee_id,
            direction=direction,
            reviewer_snapshot=snapshot,
            overall_rating=overall_rating,
            dimension_ratings=dimension_ratings,
            public_feedback=_clean_text(public_feedback, max_length=1000),
            status="submitted",
            submitted_at=now,
        )
        session.add(review)
    else:
        review.reviewer_snapshot = snapshot
        review.overall_rating = overall_rating
        review.dimension_ratings = dimension_ratings
        review.public_feedback = _clean_text(public_feedback, max_length=1000)
        review.submitted_at = now
    await session.flush()
    await reconcile_review_publication(session, engagement, now=now)
    await session.flush()
    return _my_review_read(review, engagement)


async def _published_collection(
    session: AsyncSession, user_id: UUID, mode: str
) -> ProfileReviewCollection:
    direction = "recruiter_to_talent" if mode == "talent" else "talent_to_recruiter"
    rows = (
        await session.execute(
            select(EngagementReview, User)
            .join(Engagement, Engagement.id == EngagementReview.engagement_id)
            .outerjoin(User, User.id == EngagementReview.reviewer_user_id)
            .where(
                EngagementReview.reviewee_user_id == user_id,
                EngagementReview.direction == direction,
                EngagementReview.status == "published",
                Engagement.started_at.is_not(None),
                Engagement.status.in_(TERMINAL_REVIEWABLE),
            )
            .order_by(EngagementReview.published_at.desc(), EngagementReview.created_at.desc())
        )
    ).all()
    items: list[PublicReviewItem] = []
    for review, reviewer in rows:
        snapshot = review.reviewer_snapshot or {}
        anonymized = reviewer is None or account_is_blocked(reviewer)
        items.append(
            PublicReviewItem(
                id=review.id,
                reviewer_name="Former collaborator" if anonymized else str(
                    reviewer.display_name or reviewer.username or snapshot.get("display_name") or "Collaborator"
                ),
                reviewer_avatar_url=None if anonymized else reviewer.avatar_url,
                reviewer_role=str(snapshot.get("role") or "Collaborator"),
                rating=review.overall_rating,
                body=review.public_feedback or "",
                created_at=review.published_at or review.submitted_at,
            )
        )
    average = round(sum(item.rating for item in items) / len(items), 1) if items else 0.0
    return ProfileReviewCollection(
        summary=ReviewSummary(avg_rating=average, review_count=len(items)),
        items=items,
    )


async def reconcile_due_reviews_for_user(session: AsyncSession, user_id: UUID) -> None:
    engagements = (
        await session.execute(
            select(Engagement).where(
                or_(Engagement.recruiter_user_id == user_id, Engagement.talent_user_id == user_id),
                Engagement.status.in_(TERMINAL_REVIEWABLE),
            ).with_for_update()
        )
    ).scalars().all()
    for engagement in engagements:
        await reconcile_review_publication(session, engagement)


async def profile_reviews_by_mode(session: AsyncSession, user_id: UUID) -> ReviewsByMode:
    await reconcile_due_reviews_for_user(session, user_id)
    return ReviewsByMode(
        talent=await _published_collection(session, user_id, "talent"),
        hiring=await _published_collection(session, user_id, "hiring"),
    )


async def review_workspace(
    session: AsyncSession, user: User, mode: str
) -> ReviewWorkspaceResponse:
    await reconcile_due_reviews_for_user(session, user.id)
    received = await _published_collection(session, user.id, mode)
    participant_filter = (
        Engagement.talent_user_id == user.id if mode == "talent" else Engagement.recruiter_user_id == user.id
    )
    engagements = (
        await session.execute(
            select(Engagement)
            .where(participant_filter, Engagement.status.in_(TERMINAL_REVIEWABLE))
            .order_by(Engagement.finalized_at.desc())
        )
    ).scalars().all()
    opportunities: list[ReviewOpportunity] = []
    written: list[ReviewOpportunity] = []
    for engagement in engagements:
        summary = await engagement_summary(session, engagement, user.id)
        direction, _, _ = _direction_for(engagement, user.id)
        review = await _review_for_direction(session, engagement.id, direction)
        opportunity = ReviewOpportunity(
            engagement=summary,
            direction=direction,
            my_review=_my_review_read(review, engagement) if review else None,
        )
        if review:
            written.append(opportunity)
        elif summary.review_state in {"available", "expired"}:
            opportunities.append(opportunity)
            window_end = _aware(engagement.review_window_ends_at)
            if summary.review_state == "available" and window_end and window_end <= utcnow() + timedelta(days=2):
                already_notified = (
                    await session.execute(
                        select(Notification.id).where(
                            Notification.user_id == user.id,
                            Notification.type == "review_window_expiring",
                            Notification.resource_type == "engagement",
                            Notification.resource_id == str(engagement.id),
                        )
                    )
                ).scalar_one_or_none()
                if already_notified is None:
                    await dispatch_notification(
                        session,
                        event_key="review_window_expiring",
                        recipient_user_id=user.id,
                        title="Feedback window closing soon",
                        body=f"Feedback for {_context_label(engagement)} closes in less than two days.",
                        category="activity",
                        resource_type="engagement",
                        resource_id=str(engagement.id),
                        action_url="/you?tab=reviews",
                        payload={"engagement_id": str(engagement.id)},
                    )
    return ReviewWorkspaceResponse(
        mode=mode,
        received=received,
        opportunities=opportunities,
        written=written,
    )
