from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.config import settings
from app.db import seed
from app.db import seed_data_personas as personas
from app.models import Job, JobApplication, Notification, TalentListing, User

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
