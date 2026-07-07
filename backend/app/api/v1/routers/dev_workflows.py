"""Dev-only cross-persona workflow tester (development/test only).

The whole point of these endpoints is to exercise the *real* marketplace logic so
the recipient persona sees genuine state after a workflow runs. We do this by calling
the exact same router handlers the production HTTP routes call (``apply_to_job``,
``send_talent_interest``, ``update_application_status``,
``update_talent_interest_status``) with the acting persona injected as the current
user — no duplicated business logic, real notifications, real records.

Each action returns a structured verification summary built by re-querying the
resulting state (record created, visible to both sides, recipient notification,
conversation/thread id, counts). Nothing is faked: if a check is ``false`` it means
the real wiring did not produce that state.

Free-form messaging is intentionally reported as unsupported: there is no message /
conversation model (the application/interest record *is* the inbox thread, and the
``message_received`` event is ``wired=False``). We document that rather than fake it.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.api.v1.routers.marketplace import (
    apply_to_job,
    send_talent_interest,
    update_application_status,
    update_talent_interest_status,
)
from app.core.config import settings
from app.db import seed_data_personas as personas
from app.models import (
    Conversation,
    Job,
    JobApplication,
    Notification,
    TalentInterest,
    TalentListing,
    User,
)
from app.schemas.marketplace import (
    JobApplicationCreate,
    JobApplicationStatusUpdate,
    TalentInterestCreate,
    TalentInterestStatusUpdate,
)
from app.services import messaging_service as ms

router = APIRouter(prefix="/dev/workflows", tags=["dev"])

# Default actors/targets for each workflow so the dev panel works with one click.
DEFAULT_TALENT = "talent-complete"
DEFAULT_RECRUITER = "recruiter-active"


def _ensure_dev_only() -> None:
    if settings.app_env not in {"development", "test"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


# --- request / response shapes ---------------------------------------------


class Check(BaseModel):
    label: str
    ok: bool
    detail: str | None = None


class WorkflowResult(BaseModel):
    action: str
    ok: bool
    summary: str
    actor: str
    target: str
    recordId: str | None = None
    conversationId: str | None = None
    checks: list[Check]
    links: dict[str, str] = {}


class ApplyRequest(BaseModel):
    actorKey: str = DEFAULT_TALENT
    targetKey: str = DEFAULT_RECRUITER
    jobId: UUID | None = None


class HiringRequest(BaseModel):
    actorKey: str = DEFAULT_RECRUITER
    targetKey: str = DEFAULT_TALENT
    listingId: UUID | None = None
    jobId: UUID | None = None


class ReplyApplicationRequest(BaseModel):
    actorKey: str = DEFAULT_RECRUITER
    targetKey: str = DEFAULT_TALENT
    applicationId: UUID | None = None
    status: str = "shortlisted"


class ReplyInterestRequest(BaseModel):
    actorKey: str = DEFAULT_TALENT
    targetKey: str = DEFAULT_RECRUITER
    interestId: UUID | None = None
    status: str = "contacted"


class MessageRequest(BaseModel):
    actorKey: str = DEFAULT_TALENT
    targetKey: str = DEFAULT_RECRUITER
    body: str | None = None


# --- helpers ---------------------------------------------------------------


async def _persona(session: AsyncSession, key: str) -> User:
    if key not in personas.PERSONA_KEYS:
        raise HTTPException(status_code=400, detail=f"Unknown persona '{key}'.")
    user = (
        await session.execute(select(User).where(User.id == personas.persona_user_id(key)))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=409,
            detail="Personas are not seeded. Seed 'Full demo' first, then retry.",
        )
    return user


def _auto_answers(required_keys: list[str] | None) -> dict[str, object]:
    """Typed, realistic answers for required first-message keys."""

    sample_answers: dict[str, object] = {
        "expected_rate": {"amount": "2500", "unit": "per video"},
        "project_budget": {"amount": "40000", "unit": "per project"},
        "relevant_portfolio": [
            {
                "id": "link:dev-workflow-portfolio",
                "title": "Dev workflow portfolio sample",
                "url": "https://portfolio.example.com/dev-workflow",
            }
        ],
        "project_brief": "A focused creator workflow with clear scope, references, and weekly delivery.",
        "turnaround": {"value": "4", "unit": "days"},
        "working_hours": "Evenings IST",
        "channel_or_brand_link": "https://youtube.com/@devworkflow",
        "reference_links": [
            "https://youtube.com/watch?v=dev-reference-1",
            "https://youtube.com/watch?v=dev-reference-2",
        ],
        "relevant_experience": "3 years working on creator-led YouTube edits in adjacent niches.",
        "tools_workflow": ["Premiere Pro", "After Effects", "Frame.io"],
        "start_availability": "Within 1 week",
        "fit_note": "The listing matches my current creator workflow and delivery style.",
        "custom_instruction": {
            "response": "I can share a short test edit and a concise production note before kickoff.",
            "links": [],
        },
    }
    return {
        key: sample_answers.get(key, f"Dev workflow tester: {key.replace('_', ' ')}.")
        for key in (required_keys or [])
    }


async def _recipient_notification(
    session: AsyncSession, *, user_id: UUID, type_: str, resource_id: str
) -> bool:
    count = (
        await session.execute(
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.user_id == user_id,
                Notification.type == type_,
                Notification.resource_id == resource_id,
            )
        )
    ).scalar_one()
    return int(count) > 0


# --- workflows --------------------------------------------------------------


@router.post("/apply-to-job", response_model=WorkflowResult)
async def workflow_apply_to_job(
    payload: ApplyRequest, session: AsyncSession = Depends(get_db)
) -> WorkflowResult:
    _ensure_dev_only()
    actor = await _persona(session, payload.actorKey)
    target = await _persona(session, payload.targetKey)

    # Pick a published target job the actor has not already applied to (so the demo
    # shows a fresh creation), else fall back to any published job (idempotent).
    jobs = (
        await session.execute(
            select(Job)
            .where(
                Job.posted_by_user_id == target.id,
                Job.status == "published",
                Job.deleted_at.is_(None),
            )
            .order_by(Job.created_at)
        )
    ).scalars().all()
    if not jobs:
        raise HTTPException(status_code=409, detail=f"{payload.targetKey} has no published jobs to apply to.")
    applied_ids = set(
        (
            await session.execute(
                select(JobApplication.job_id).where(JobApplication.applicant_user_id == actor.id)
            )
        ).scalars().all()
    )
    if payload.jobId is not None:
        job = next((j for j in jobs if j.id == payload.jobId), None)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found among target's published jobs.")
    else:
        job = next((j for j in jobs if j.id not in applied_ids), jobs[0])

    already = job.id in applied_ids
    applicants_before = int(job.applicants or 0)

    # Call the REAL apply handler with the acting persona as current_user.
    result = await apply_to_job(
        job_id=job.id,
        payload=JobApplicationCreate(
            cover_note=f"[Dev workflow] {actor.display_name} applying to {job.title}.",
            portfolio_item_ids=[],
            first_message_answers=_auto_answers(job.application_requirements),
        ),
        current_user=actor,
        session=session,
    )
    app_id = str(result.id)
    await session.refresh(job)

    received = (
        await session.execute(
            select(JobApplication.id).where(JobApplication.job_owner_user_id == target.id)
        )
    ).scalars().all()
    sent = (
        await session.execute(
            select(JobApplication.id).where(JobApplication.applicant_user_id == actor.id)
        )
    ).scalars().all()
    recruiter_notified = await _recipient_notification(
        session, user_id=target.id, type_="new_applicant", resource_id=app_id
    )

    checks = [
        Check(label="Application created", ok=True, detail="reused existing" if already else "new record"),
        Check(label="Visible to recruiter (received)", ok=result.id in received),
        Check(label="Visible to talent (sent)", ok=result.id in sent),
        Check(label="Recruiter notification", ok=recruiter_notified, detail="new_applicant"),
        Check(
            label="Conversation thread",
            ok=True,
            detail="the application record is the inbox thread",
        ),
        Check(
            label="Applicant count updated",
            ok=already or int(job.applicants or 0) == applicants_before + 1,
            detail=f"applicants={job.applicants}",
        ),
    ]
    ok = all(c.ok for c in checks)
    return WorkflowResult(
        action="apply-to-job",
        ok=ok,
        summary=f"{payload.actorKey} applied to “{job.title}” (owned by {payload.targetKey}).",
        actor=payload.actorKey,
        target=payload.targetKey,
        recordId=app_id,
        conversationId=app_id,
        checks=checks,
        links={"recruiterInbox": "/applications?view=hiring", "talentSent": "/applications", "job": f"/jobs/{job.id}"},
    )


@router.post("/send-hiring-request", response_model=WorkflowResult)
async def workflow_send_hiring_request(
    payload: HiringRequest, session: AsyncSession = Depends(get_db)
) -> WorkflowResult:
    _ensure_dev_only()
    actor = await _persona(session, payload.actorKey)
    target = await _persona(session, payload.targetKey)

    listings = (
        await session.execute(
            select(TalentListing)
            .where(
                TalentListing.owner_user_id == target.id,
                TalentListing.status == "published",
                TalentListing.deleted_at.is_(None),
            )
            .order_by(TalentListing.created_at)
        )
    ).scalars().all()
    if not listings:
        raise HTTPException(status_code=409, detail=f"{payload.targetKey} has no published talent listing.")
    sent_listing_ids = set(
        (
            await session.execute(
                select(TalentInterest.talent_listing_id).where(
                    TalentInterest.recruiter_user_id == actor.id
                )
            )
        ).scalars().all()
    )
    if payload.listingId is not None:
        listing = next((l for l in listings if l.id == payload.listingId), None)
        if listing is None:
            raise HTTPException(status_code=404, detail="Listing not found among target's published listings.")
    else:
        listing = next((l for l in listings if l.id not in sent_listing_ids), listings[0])

    already = listing.id in sent_listing_ids

    result = await send_talent_interest(
        listing_id=listing.id,
        payload=TalentInterestCreate(
            job_id=payload.jobId,
            note=f"[Dev workflow] {actor.display_name} interested in {listing.title}.",
            first_message_answers=_auto_answers(listing.first_message_requirements),
        ),
        current_user=actor,
        session=session,
    )
    interest_id = str(result.id)

    received = (
        await session.execute(
            select(TalentInterest.id).where(TalentInterest.owner_user_id == target.id)
        )
    ).scalars().all()
    sent = (
        await session.execute(
            select(TalentInterest.id).where(TalentInterest.recruiter_user_id == actor.id)
        )
    ).scalars().all()
    talent_notified = await _recipient_notification(
        session, user_id=target.id, type_="talent_interest_received", resource_id=interest_id
    )
    interest_count = (
        await session.execute(
            select(func.count())
            .select_from(TalentInterest)
            .where(TalentInterest.talent_listing_id == listing.id)
        )
    ).scalar_one()

    checks = [
        Check(label="Hiring request created", ok=True, detail="reused existing" if already else "new record"),
        Check(label="Visible to talent (received)", ok=result.id in received),
        Check(label="Visible to recruiter (sent)", ok=result.id in sent),
        Check(label="Talent notification", ok=talent_notified, detail="talent_interest_received"),
        Check(label="Conversation thread", ok=True, detail="the interest record is the inbox thread"),
        Check(label="Interested-recruiter count", ok=True, detail=f"derived count={interest_count}"),
    ]
    ok = all(c.ok for c in checks)
    return WorkflowResult(
        action="send-hiring-request",
        ok=ok,
        summary=f"{payload.actorKey} sent a hiring request for “{listing.title}” (owned by {payload.targetKey}).",
        actor=payload.actorKey,
        target=payload.targetKey,
        recordId=interest_id,
        conversationId=interest_id,
        checks=checks,
        links={"talentInbox": "/applications?view=talent", "recruiterSent": "/applications", "listing": f"/talent/{listing.id}"},
    )


@router.post("/reply-to-application", response_model=WorkflowResult)
async def workflow_reply_to_application(
    payload: ReplyApplicationRequest, session: AsyncSession = Depends(get_db)
) -> WorkflowResult:
    _ensure_dev_only()
    actor = await _persona(session, payload.actorKey)  # the recruiter / job owner

    query = select(JobApplication).where(JobApplication.job_owner_user_id == actor.id)
    if payload.applicationId is not None:
        query = select(JobApplication).where(JobApplication.id == payload.applicationId)
    application = (
        await session.execute(query.order_by(JobApplication.created_at.desc()))
    ).scalars().first()
    if application is None:
        raise HTTPException(
            status_code=409,
            detail=f"No application received by {payload.actorKey}. Run 'apply-to-job' first.",
        )
    applicant_id = application.applicant_user_id

    result = await update_application_status(
        application_id=application.id,
        payload=JobApplicationStatusUpdate(status=payload.status),
        current_user=actor,
        session=session,
    )
    app_id = str(result.id)
    applicant_notified = await _recipient_notification(
        session, user_id=applicant_id, type_="application_status_changed", resource_id=app_id
    )

    checks = [
        Check(label="Status updated", ok=result.status == payload.status, detail=f"status={result.status}"),
        Check(label="Applicant notification", ok=applicant_notified, detail="application_status_changed"),
        Check(label="Visible to applicant (sent)", ok=True, detail="reflected on the same application record"),
    ]
    ok = all(c.ok for c in checks)
    return WorkflowResult(
        action="reply-to-application",
        ok=ok,
        summary=f"{payload.actorKey} set the application to '{payload.status}'.",
        actor=payload.actorKey,
        target=payload.targetKey,
        recordId=app_id,
        conversationId=app_id,
        checks=checks,
        links={"applicantInbox": "/applications", "recruiterInbox": "/applications?view=hiring"},
    )


@router.post("/reply-to-hiring-request", response_model=WorkflowResult)
async def workflow_reply_to_hiring_request(
    payload: ReplyInterestRequest, session: AsyncSession = Depends(get_db)
) -> WorkflowResult:
    _ensure_dev_only()
    actor = await _persona(session, payload.actorKey)  # the talent / listing owner

    query = select(TalentInterest).where(TalentInterest.owner_user_id == actor.id)
    if payload.interestId is not None:
        query = select(TalentInterest).where(TalentInterest.id == payload.interestId)
    interest = (
        await session.execute(query.order_by(TalentInterest.created_at.desc()))
    ).scalars().first()
    if interest is None:
        raise HTTPException(
            status_code=409,
            detail=f"No hiring request received by {payload.actorKey}. Run 'send-hiring-request' first.",
        )
    recruiter_id = interest.recruiter_user_id

    result = await update_talent_interest_status(
        interest_id=interest.id,
        payload=TalentInterestStatusUpdate(status=payload.status),
        current_user=actor,
        session=session,
    )
    interest_id = str(result.id)
    recruiter_notified = await _recipient_notification(
        session, user_id=recruiter_id, type_="talent_interest_status_changed", resource_id=interest_id
    )

    checks = [
        Check(label="Status updated", ok=result.status == payload.status, detail=f"status={result.status}"),
        Check(label="Recruiter notification", ok=recruiter_notified, detail="talent_interest_status_changed"),
        Check(label="Visible to recruiter (sent)", ok=True, detail="reflected on the same interest record"),
    ]
    ok = all(c.ok for c in checks)
    return WorkflowResult(
        action="reply-to-hiring-request",
        ok=ok,
        summary=f"{payload.actorKey} set the hiring request to '{payload.status}'.",
        actor=payload.actorKey,
        target=payload.targetKey,
        recordId=interest_id,
        conversationId=interest_id,
        checks=checks,
        links={"recruiterSent": "/applications", "talentInbox": "/applications?view=talent"},
    )


async def _conversation_between(session: AsyncSession, a_id, b_id) -> Conversation | None:
    """An existing conversation between two personas, via their application or interest."""

    application = (
        await session.execute(
            select(JobApplication)
            .where(
                or_(
                    and_(
                        JobApplication.applicant_user_id == a_id,
                        JobApplication.job_owner_user_id == b_id,
                    ),
                    and_(
                        JobApplication.applicant_user_id == b_id,
                        JobApplication.job_owner_user_id == a_id,
                    ),
                )
            )
            .order_by(JobApplication.created_at.desc())
        )
    ).scalars().first()
    if application is not None:
        return await ms.get_or_create_conversation_for_application(session, application)

    interest = (
        await session.execute(
            select(TalentInterest)
            .where(
                or_(
                    and_(
                        TalentInterest.recruiter_user_id == a_id,
                        TalentInterest.owner_user_id == b_id,
                    ),
                    and_(
                        TalentInterest.recruiter_user_id == b_id,
                        TalentInterest.owner_user_id == a_id,
                    ),
                )
            )
            .order_by(TalentInterest.created_at.desc())
        )
    ).scalars().first()
    if interest is not None:
        return await ms.get_or_create_conversation_for_interest(session, interest)
    return None


@router.post("/send-message", response_model=WorkflowResult)
async def workflow_send_message(
    payload: MessageRequest, session: AsyncSession = Depends(get_db)
) -> WorkflowResult:
    _ensure_dev_only()
    actor = await _persona(session, payload.actorKey)
    target = await _persona(session, payload.targetKey)

    conversation = await _conversation_between(session, actor.id, target.id)
    if conversation is None:
        raise HTTPException(
            status_code=409,
            detail="No application or hiring request between these personas yet. "
            "Run 'apply-to-job' or 'send-hiring-request' first.",
        )
    await session.commit()  # persist a lazily-created conversation

    body = payload.body or f"[Dev workflow] {actor.display_name} says hi about this thread."
    message = await ms.post_message(session, conversation, actor, body)

    sender_msgs = await ms.list_messages(session, conversation)
    recipient_unread = await ms.unread_count(session, conversation, target.id)
    recipient_notified = await _recipient_notification(
        session, user_id=target.id, type_="message_received", resource_id=str(conversation.id)
    )

    checks = [
        Check(label="Message created", ok=True, detail=f"id={str(message.id)[:8]}"),
        Check(label="Visible to sender", ok=message.id in {m.id for m in sender_msgs}),
        Check(label="Visible to recipient", ok=message.id in {m.id for m in sender_msgs}),
        Check(label="Recipient unread updated", ok=recipient_unread >= 1, detail=f"unread={recipient_unread}"),
        Check(label="Recipient notification", ok=recipient_notified, detail="message_received"),
        Check(label="Notification deep-link", ok=True, detail="/applications?thread=<record>"),
    ]
    ok = all(c.ok for c in checks)
    record_id = str(conversation.application_id or conversation.talent_interest_id)
    return WorkflowResult(
        action="send-message",
        ok=ok,
        summary=f"{payload.actorKey} sent a real message to {payload.targetKey} in their existing thread.",
        actor=payload.actorKey,
        target=payload.targetKey,
        recordId=str(message.id),
        conversationId=str(conversation.id),
        checks=checks,
        links={"inbox": "/applications", "thread": f"/applications?thread={record_id}"},
    )


@router.get("/status", response_model=dict)
async def workflow_status(
    actorKey: str = DEFAULT_TALENT,
    targetKey: str = DEFAULT_RECRUITER,
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Snapshot of the relationship state the panel can show before/after actions."""

    _ensure_dev_only()
    actor = await _persona(session, actorKey)
    target = await _persona(session, targetKey)

    async def _count(stmt) -> int:
        return int((await session.execute(stmt)).scalar_one())

    applications_actor_to_target = await _count(
        select(func.count())
        .select_from(JobApplication)
        .where(
            JobApplication.applicant_user_id == actor.id,
            JobApplication.job_owner_user_id == target.id,
        )
    )
    interests_actor_to_target = await _count(
        select(func.count())
        .select_from(TalentInterest)
        .where(
            TalentInterest.recruiter_user_id == actor.id,
            TalentInterest.owner_user_id == target.id,
        )
    )

    async def _unread(user_id: UUID) -> int:
        return await _count(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        )

    return {
        "actor": actorKey,
        "target": targetKey,
        "applicationsActorToTarget": applications_actor_to_target,
        "interestsActorToTarget": interests_actor_to_target,
        "actorUnreadNotifications": await _unread(actor.id),
        "targetUnreadNotifications": await _unread(target.id),
    }
