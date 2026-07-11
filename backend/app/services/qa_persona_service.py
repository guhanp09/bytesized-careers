from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.qa_personas import (
    ensure_qa_persona_feature_enabled,
    is_qa_controller_email,
    parse_qa_token_claims,
    qa_session_is_revoked,
)
from app.core.security import TokenError, create_access_token, decode_access_token, get_token_expires_at
from app.db import qa_scenarios
from app.db import seed_data_personas as personas
from app.models import (
    Engagement,
    EngagementReview,
    HiringIdentity,
    Job,
    JobApplication,
    Notification,
    PortfolioItem,
    Report,
    SavedJob,
    SavedTalentListing,
    TalentInterest,
    TalentListing,
    User,
)
from app.schemas.auth import AuthUserRead
from app.schemas.qa import QaPersonaItem, QaSessionResponse
from app.services.audit_service import record_admin_action


@dataclass(frozen=True)
class QaControllerContext:
    controller: User
    token_payload: dict[str, object]
    active_persona_key: str | None
    qa_session_id: UUID | None


PERSONA_EXPERIENCE: dict[str, dict[str, object]] = {
    "new-empty": {
        "coverage": ["Onboarding", "Empty states", "Permissions", "Profile completion"],
        "startRoute": "/you",
    },
    "talent-complete": {
        "coverage": ["Talent profile", "Portfolio", "Applications", "Saved jobs"],
        "startRoute": "/you",
    },
    "talent-incomplete": {
        "coverage": ["Validation", "Incomplete profile", "Drafts", "Engagement edge states"],
        "startRoute": "/you",
    },
    "recruiter-active": {
        "coverage": ["Live jobs", "Applicants", "Pipeline", "Hiring requests", "Private notes"],
        "startRoute": "/applications?view=pipeline&mode=recruiter",
    },
    "recruiter-drafts": {
        "coverage": ["Agency identities", "Verification states", "Job drafts", "Represented channels"],
        "startRoute": "/drafts",
    },
    "both-sides": {
        "coverage": ["Talent/Recruiter modes", "Applications", "Hiring", "Engagements"],
        "startRoute": "/you",
    },
    "notifications": {
        "coverage": ["Notifications", "Hiring requests", "Reviews", "Archived states"],
        "startRoute": "/notifications",
    },
    "admin": {
        "coverage": ["Reports", "Moderation", "Verification", "Audit", "Suspension"],
        "startRoute": "/admin",
        "caution": "High privilege: actions affect deterministic QA records.",
    },
}


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


async def resolve_qa_controller(
    session: AsyncSession, raw_access_token: str
) -> QaControllerContext:
    ensure_qa_persona_feature_enabled()
    try:
        payload = decode_access_token(raw_access_token)
    except TokenError as exc:
        raise _not_found() from exc

    claims = parse_qa_token_claims(payload)
    raw_controller_id = claims.controller_user_id if claims is not None else payload.get("sub")
    try:
        controller_id = UUID(str(raw_controller_id))
    except (TypeError, ValueError) as exc:
        raise _not_found() from exc

    controller = (
        await session.execute(select(User).where(User.id == controller_id))
    ).scalar_one_or_none()
    if (
        controller is None
        or controller.suspended_at is not None
        or not is_qa_controller_email(controller.email)
    ):
        raise _not_found()

    if claims is not None:
        if (
            claims.persona_key not in personas.PERSONA_KEYS
            or personas.persona_user_id(claims.persona_key) != claims.persona_user_id
            or await qa_session_is_revoked(session, claims.session_id)
        ):
            raise _not_found()
    return QaControllerContext(
        controller=controller,
        token_payload=payload,
        active_persona_key=claims.persona_key if claims is not None else None,
        qa_session_id=claims.session_id if claims is not None else None,
    )


class QaPersonaService:
    def __init__(self, session: AsyncSession, context: QaControllerContext):
        self.session = session
        self.context = context

    async def list_personas(self) -> list[QaPersonaItem]:
        rows = (
            await self.session.execute(
                select(User).where(User.id.in_(personas.all_persona_user_ids()))
            )
        ).scalars().all()
        by_id = {row.id: row for row in rows}
        items: list[QaPersonaItem] = []
        for definition in personas.PERSONA_DEFS:
            key = str(definition["key"])
            row = by_id.get(personas.persona_user_id(key))
            if row is None:
                continue
            metadata = PERSONA_EXPERIENCE[key]
            account_type = str(definition["account_type"])
            modes = (
                ["Talent", "Recruiter"]
                if account_type == "BOTH"
                else ["Admin"]
                if account_type == "ADMIN"
                else ["Recruiter"]
                if account_type == "EMPLOYER"
                else ["Talent"]
            )
            items.append(
                QaPersonaItem(
                    key=key,
                    label=str(definition["label"]),
                    displayName=row.display_name or row.username or key,
                    accountType=account_type,
                    modes=modes,
                    description=str(definition["description"]),
                    coverage=list(metadata["coverage"]),
                    startRoute=str(metadata["startRoute"]),
                    caution=str(metadata["caution"]) if metadata.get("caution") else None,
                )
            )
        return items

    async def issue_session(
        self,
        persona_key: str,
        *,
        session_id: UUID | None = None,
        audit_action: str = "qa.persona.switch",
    ) -> QaSessionResponse:
        if persona_key not in personas.PERSONA_KEYS:
            raise _not_found()
        if session_id is not None and await qa_session_is_revoked(self.session, session_id):
            raise _not_found()
        persona_id = personas.persona_user_id(persona_key)
        persona = (
            await self.session.execute(select(User).where(User.id == persona_id))
        ).scalar_one_or_none()
        if persona is None or persona.suspended_at is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="QA persona is unavailable. Restore the relevant QA scenario first.",
            )

        qa_session_id = session_id or uuid4()
        access_token = create_access_token(
            subject=str(persona.id),
            expires_delta=timedelta(minutes=settings.qa_persona_access_token_minutes),
            additional_claims={
                "qa": True,
                "act": str(self.context.controller.id),
                "qa_session_id": str(qa_session_id),
                "qa_persona_key": persona_key,
            },
        )
        record_admin_action(
            self.session,
            actor=self.context.controller,
            action=audit_action,
            target_type="qa_persona",
            target_id=persona.id,
            target_label=persona_key,
            after={"qa_session_id": str(qa_session_id), "persona_user_id": str(persona.id)},
        )
        await self.session.commit()
        return QaSessionResponse(
            access_token=access_token,
            access_token_expires_at=get_token_expires_at(access_token),
            qa_session_id=qa_session_id,
            persona_key=persona_key,
            user=AuthUserRead.model_validate(persona),
        )

    async def exit_session(self, qa_session_id: UUID, persona_key: str) -> None:
        if persona_key not in personas.PERSONA_KEYS:
            raise _not_found()
        if self.context.active_persona_key is not None and (
            self.context.active_persona_key != persona_key
            or self.context.qa_session_id != qa_session_id
        ):
            raise _not_found()
        record_admin_action(
            self.session,
            actor=self.context.controller,
            action="qa.persona.exit",
            target_type="qa_session",
            target_id=qa_session_id,
            target_label=persona_key,
        )
        await self.session.commit()

    async def status(self) -> dict[str, object]:
        async def count_ids(model, ids: list[UUID]) -> int:
            return int(
                (
                    await self.session.execute(
                        select(func.count()).select_from(model).where(model.id.in_(ids))
                    )
                ).scalar_one()
            )

        count = await count_ids(User, personas.all_persona_user_ids())
        fixture_groups = (
            (User, personas.all_qa_seed_user_ids()),
            (HiringIdentity, personas.all_persona_hiring_identity_ids()),
            (TalentListing, personas.all_persona_talent_listing_ids()),
            (Job, personas.all_persona_job_ids()),
            (PortfolioItem, personas.all_persona_portfolio_item_ids()),
            (JobApplication, personas.all_persona_application_ids()),
            (TalentInterest, personas.all_persona_interest_ids()),
            (Engagement, personas.all_review_engagement_ids()),
            (
                EngagementReview,
                [UUID(str(item["id"])) for item in personas.build_persona_engagement_reviews()],
            ),
            (SavedJob, personas.all_persona_saved_job_ids()),
            (SavedTalentListing, personas.all_persona_saved_talent_ids()),
            (Notification, personas.all_persona_notification_ids()),
            (Report, personas.all_persona_report_ids()),
        )
        fixtures_healthy = True
        for model, ids in fixture_groups:
            if await count_ids(model, ids) != len(ids):
                fixtures_healthy = False
                break
        return {
            "enabled": True,
            "environment": settings.app_env,
            "controllerEmail": self.context.controller.email,
            "activePersonaKey": self.context.active_persona_key,
            "qaSessionId": self.context.qa_session_id,
            "personaCount": count,
            "scenarioCount": len(qa_scenarios.SCENARIOS),
            "fixturesHealthy": fixtures_healthy,
        }

    async def restore_scenario(self, key: str, confirmation: str) -> dict[str, object]:
        scenario = qa_scenarios.SCENARIO_BY_KEY.get(key)
        if scenario is None:
            raise _not_found()
        expected = str(scenario["confirmation"])
        if confirmation.strip() != expected:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Type {expected} to restore this scenario.",
            )
        result = await qa_scenarios.restore_scenario(self.session, key)
        record_admin_action(
            self.session,
            actor=self.context.controller,
            action="qa.scenario.restore",
            target_type="qa_scenario",
            target_id=key,
            target_label=str(scenario["title"]),
            after={"qa_session_id": str(self.context.qa_session_id or ""), "result": result},
            justification="Controller-confirmed deterministic QA scenario restore",
        )
        await self.session.commit()
        return result
