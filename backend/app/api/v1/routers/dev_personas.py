from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_job_import_service
from app.core.config import settings
from app.db import seed
from app.db import seed_data_personas as personas
from app.db.seed_data_job_import import (
    DEVELOPMENT_IMPORT_SCENARIOS,
    IN_FLIGHT_IMPORT_SCENARIOS,
    MULTI_CRAFT_SOURCE_TEXT,
    MULTI_CRAFT_STRUCTURED_CONTEXT,
    SHINE_SCHOOL_EDITOR_SOURCE_TEXT,
    SHINE_SCHOOL_EDITOR_STRUCTURED_CONTEXT,
    processed_review_fixture,
)
from app.db.seed_data_job_import_ceiling import (
    CEILING_ONLY_PAY_SOURCE_TEXT,
    CEILING_ONLY_PAY_STRUCTURED_CONTEXT,
)
from app.db.seed_data_job_import_labelled import (
    LABELLED_PAY_SOURCE_TEXT,
    LABELLED_PAY_STRUCTURED_CONTEXT,
)
from app.models import Job, JobApplication, Notification, TalentListing, User
from app.schemas.job_import import (
    JobImportDraftInitialize,
    JobImportDraftRead,
    JobImportFieldReviewRequest,
    JobImportProviderMetadata,
    JobImportSourceCreate,
)
from app.services.job_import_service import JobImportService

router = APIRouter(prefix="/dev", tags=["dev"])


def _ensure_dev_only() -> None:
    """Hard gate: the persona/seed tooling is unreachable outside dev/test."""

    if settings.app_env not in {"development", "test"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


# Scenario name -> idempotent seeder. Mirrors the dev panel's seed buttons.
_SEED_SCENARIOS = {
    "marketplace": seed.seed_marketplace_demo_data_if_missing,
    "personas": seed.seed_personas_if_missing,
    "applications": seed.seed_applications_workspace,
    "drafts": seed.seed_drafts,
    "notifications": seed.seed_notifications_scenario,
    "saved": seed.seed_saved_items,
    "verification": seed.seed_verification_states,
    "reports": seed.seed_reports_scenario,
    "full_demo": seed.seed_full_demo,
}


class Persona(BaseModel):
    key: str
    label: str
    email: str
    accountType: str
    description: str


class PersonaListResponse(BaseModel):
    personas: list[Persona]
    password: str


class DevStatusResponse(BaseModel):
    env: str
    personaCount: int
    users: int
    jobs: int
    talentListings: int
    applications: int
    notifications: int


class SeedRequest(BaseModel):
    scenario: str = "full_demo"


class SeedResponse(BaseModel):
    status: str
    scenario: str
    result: dict


class ResetRequest(BaseModel):
    confirm: bool = False


class ResetResponse(BaseModel):
    status: str
    result: dict


class DevJobImportFixtureResponse(BaseModel):
    draft: JobImportDraftRead
    created: bool


@router.get("/personas", response_model=PersonaListResponse)
async def list_personas() -> PersonaListResponse:
    _ensure_dev_only()
    return PersonaListResponse(
        personas=[Persona(**item) for item in personas.persona_public_catalog()],
        password=personas.DEV_PERSONA_PASSWORD,
    )


@router.get("/status", response_model=DevStatusResponse)
async def dev_status(session: AsyncSession = Depends(get_db)) -> DevStatusResponse:
    _ensure_dev_only()

    async def _count(model: type) -> int:
        result = await session.execute(select(func.count()).select_from(model))
        return int(result.scalar_one())

    persona_emails = [personas.persona_email(key) for key in personas.PERSONA_KEYS]
    persona_count_result = await session.execute(
        select(func.count()).select_from(User).where(User.email.in_(persona_emails))
    )

    return DevStatusResponse(
        env=settings.app_env,
        personaCount=int(persona_count_result.scalar_one()),
        users=await _count(User),
        jobs=await _count(Job),
        talentListings=await _count(TalentListing),
        applications=await _count(JobApplication),
        notifications=await _count(Notification),
    )


@router.post("/seed", response_model=SeedResponse)
async def seed_scenario(
    payload: SeedRequest, session: AsyncSession = Depends(get_db)
) -> SeedResponse:
    _ensure_dev_only()
    seeder = _SEED_SCENARIOS.get(payload.scenario)
    if seeder is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown scenario '{payload.scenario}'. Valid: {sorted(_SEED_SCENARIOS)}.",
        )
    result = await seeder(session)
    return SeedResponse(status="ok", scenario=payload.scenario, result=result)


@router.post("/reset", response_model=ResetResponse)
async def reset_dev_data(
    payload: ResetRequest, session: AsyncSession = Depends(get_db)
) -> ResetResponse:
    _ensure_dev_only()
    if not payload.confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reset requires confirm=true.",
        )
    result = await seed.reset_dev_seed_data(session)
    return ResetResponse(status="ok", result=result)


@router.post(
    "/job-import-review",
    response_model=DevJobImportFixtureResponse,
    summary="Create an owned processed job-import review fixture",
)
async def create_job_import_review_fixture(
    scenario: str = Query(default="strong-decisions"),
    fresh: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    service: JobImportService = Depends(get_job_import_service),
) -> DevJobImportFixtureResponse:
    _ensure_dev_only()
    if scenario not in DEVELOPMENT_IMPORT_SCENARIOS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unknown development import scenario.",
        )
    if scenario == "processing-failure":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "JOB_IMPORT_PROCESSING_FAILED",
                "message": "The local fixture could not prepare this draft.",
            },
        )
    await seed.seed_roles_if_missing(service.repository.session)
    source_titles = {
        "strong-decisions": "Finance video editor job post",
        "thumbnail-designer": "Science thumbnail designer job post",
        "scriptwriter": "History scriptwriter job post",
        "clean-import": "Education content strategist job post",
        "shine-school-editor": "Video Editor",
        "multi-craft": "Visual Content Creator - Video Editing, VFX & Animation",
        "labelled-pay-conflict": "(Paid) Content Creator & Social Media Manager",
        "ceiling-only-pay": "Freelance Video Editor",
        "checkpoint-currency": "Finance video editor job post",
        "checkpoint-trial": "Gaming thumbnail designer job post",
        "delayed-processing": "Public job post being read",
        "refresh-resume": "Public job post being read",
        "answer-precedence": "Weekly review channel job post",
    }
    fixture_run = uuid4().hex[:8] if fresh else "stable"
    url_fixtures = {
        "shine-school-editor": (
            SHINE_SCHOOL_EDITOR_SOURCE_TEXT,
            SHINE_SCHOOL_EDITOR_STRUCTURED_CONTEXT,
        ),
        "multi-craft": (
            MULTI_CRAFT_SOURCE_TEXT,
            MULTI_CRAFT_STRUCTURED_CONTEXT,
        ),
        # Markup that contradicts the employer's own labelled copy. Exposed to
        # the browser deliberately: the defect it reproduces was reported
        # against what a recruiter saw, so a fixture only the backend suite can
        # reach would prove the reconciliation and nothing about the screen.
        "labelled-pay-conflict": (
            LABELLED_PAY_SOURCE_TEXT,
            LABELLED_PAY_STRUCTURED_CONTEXT,
        ),
        # Pay as a bare line with a qualifier and no label anywhere — the shape
        # the label reader could not see and the schema could not hold.
        "ceiling-only-pay": (
            CEILING_ONLY_PAY_SOURCE_TEXT,
            CEILING_ONLY_PAY_STRUCTURED_CONTEXT,
        ),
    }
    url_fixture = url_fixtures.get(scenario)
    source = await service.create_source(
        JobImportSourceCreate(
            source_type="public_url" if url_fixture else "rough_description",
            source_title=source_titles[scenario],
            original_text=(
                url_fixture[0]
                if url_fixture
                else (
                    f"Development-only {scenario} private source used to inspect the guided "
                    "recruiter experience without a provider call."
                )
            ),
            source_url=(
                f"https://example.invalid/development/{scenario}"
                if url_fixture
                else None
            ),
            idempotency_key=f"ds-{scenario}-{current_user.id}-{fixture_run}",
        ),
        owner_user_id=current_user.id,
    )
    if url_fixture:
        source.final_source_url = source.source_url
        source.retrieved_at = datetime.now(UTC)
        source.retrieval_metadata = {
            "development_fixture": True,
            "json_ld_job_posting": True,
            "structured_context": url_fixture[1],
        }
        await service.repository.session.commit()
        await service.repository.session.refresh(source)
    draft = await service.initialize_draft(
        source.id,
        JobImportDraftInitialize(
            idempotency_key=f"dd-{scenario}-{current_user.id}-{fixture_run}",
        ),
        owner_user_id=current_user.id,
    )
    created = draft.processing_status == "awaiting_processing"

    if scenario in IN_FLIGHT_IMPORT_SCENARIOS:
        # Leave the draft genuinely mid-processing. The assistant's staged
        # behaviour is only worth inspecting against the real state machine, so
        # these scenarios claim the draft exactly as a provider run would and
        # then stop, rather than faking a status.
        if created:
            await service.begin_processing(
                draft.id,
                owner_user_id=current_user.id,
                processing_attempt_id=uuid4(),
            )
        # No recruiter question is inserted here. The fixture is intentionally
        # source-first: processing must finish before any missing detail can be
        # presented as a question.
        draft = await service.get_draft(draft.id, owner_user_id=current_user.id)
        return DevJobImportFixtureResponse(
            draft=await service.draft_read(draft),
            created=created,
        )

    if created:
        draft = await service.record_extraction_result(
            draft.id,
            processed_review_fixture(scenario),
            owner_user_id=current_user.id,
            provider_metadata=JobImportProviderMetadata(
                provider_name="development_fixture",
                instruction_version="dev-guidance-v1",
                metadata={"fixture": True, "scenario": scenario},
            ),
        )
        if scenario in {"clean-import", "thumbnail-designer"}:
            draft = await service.review_field(
                draft.id,
                "source_inputs",
                JobImportFieldReviewRequest(action="accept"),
                owner_user_id=current_user.id,
            )
    return DevJobImportFixtureResponse(
        draft=await service.draft_read(draft),
        created=created,
    )
