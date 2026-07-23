from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.account_types import isAdmin
from app.core.security import TokenError, decode_access_token
from app.core.qa_personas import (
    is_qa_controller_email,
    parse_qa_token_claims,
    qa_persona_feature_enabled,
    qa_session_is_revoked,
)
from app.db.session import get_db_session
from app.db import seed_data_personas as qa_personas
from app.models import Job, User
from app.repositories.auth_repository import AuthRepository
from app.repositories.job_import_repository import JobImportRepository
from app.repositories.job_repository import JobRepository
from app.schemas.profile_capabilities import ProfileCapabilities
from app.services.auth_service import AuthService
from app.services.job_service import JobNotFoundError, JobService
from app.services.job_import_service import JobImportService
from app.services.me_service import MeService
from app.services.profile_service import ProfileService

bearer_scheme = HTTPBearer(auto_error=False)


async def get_db(session: AsyncSession = Depends(get_db_session)) -> AsyncSession:
    return session


async def get_job_service(session: AsyncSession = Depends(get_db)) -> JobService:
    repository = JobRepository(session)
    return JobService(repository)


async def get_job_import_service(
    session: AsyncSession = Depends(get_db),
) -> JobImportService:
    return JobImportService(
        JobImportRepository(session),
        JobService(JobRepository(session)),
    )


async def get_auth_repository(session: AsyncSession = Depends(get_db)) -> AuthRepository:
    return AuthRepository(session)


async def get_auth_service(repository: AuthRepository = Depends(get_auth_repository)) -> AuthService:
    return AuthService(repository)


async def get_me_service(repository: AuthRepository = Depends(get_auth_repository)) -> MeService:
    return MeService(repository)


async def get_profile_service(
    repository: AuthRepository = Depends(get_auth_repository),
) -> ProfileService:
    return ProfileService(repository)


async def resolve_access_token_user(
    *,
    session: AsyncSession,
    token: str,
) -> User | None:
    """Resolve the same trusted backend identity used by HTTP and WebSockets."""
    try:
        payload = decode_access_token(token)
    except TokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    subject = payload.get("sub")
    if not isinstance(subject, str):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")

    try:
        user_id = UUID(subject)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject") from exc

    if "qa" in payload:
        claims = parse_qa_token_claims(payload)
        if claims is None or not qa_persona_feature_enabled():
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid QA session")
        if (
            claims.persona_user_id != user_id
            or claims.persona_key not in qa_personas.PERSONA_KEYS
            or qa_personas.persona_user_id(claims.persona_key) != user_id
        ):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid QA persona")
        controller = (
            await session.execute(select(User).where(User.id == claims.controller_user_id))
        ).scalar_one_or_none()
        if (
            controller is None
            or controller.suspended_at is not None
            or not is_qa_controller_email(controller.email)
            or await qa_session_is_revoked(session, claims.session_id)
        ):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="QA session revoked")

    stmt = select(User).where(User.id == user_id)
    user = (await session.execute(stmt)).scalar_one_or_none()
    if user is None:
        return None

    # Suspended accounts are rejected at the door (admin panel enforcement —
    # docs/ADMIN_PANEL_PLAN.md §12). 403, not 401: the token is valid, the
    # account is locked.
    if user.suspended_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account suspended. Contact support for details.",
        )

    # Coarse activity signal for the admin directory: touch at most every 15
    # minutes so authenticated traffic doesn't turn into constant writes.
    # expire_on_commit=False on the session factory keeps `user` usable after
    # this commit; the request handler starts its own transaction afterwards.
    now = datetime.now(UTC)
    last_active = user.last_active_at
    if last_active is not None and last_active.tzinfo is None:
        # SQLite returns naive datetimes; normalize before comparing.
        last_active = last_active.replace(tzinfo=UTC)
    if last_active is None or (now - last_active) > timedelta(minutes=15):
        user.last_active_at = now
        try:
            await session.commit()
        except Exception:  # pragma: no cover - activity tracking must never block auth
            await session.rollback()
    return user


async def _resolve_user_from_credentials(
    *,
    session: AsyncSession,
    credentials: HTTPAuthorizationCredentials,
) -> User | None:
    return await resolve_access_token_user(session=session, token=credentials.credentials)


async def get_optional_current_user(
    session: AsyncSession = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> User | None:
    if credentials is None:
        return None
    user = await _resolve_user_from_credentials(session=session, credentials=credentials)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication credentials")
    return user


async def get_current_user(
    session: AsyncSession = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    user = await _resolve_user_from_credentials(session=session, credentials=credentials)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication credentials")
    return user


CurrentUserDependency = Annotated[User, Depends(get_current_user)]
AuthenticatedUserDependency = CurrentUserDependency


async def require_authenticated_user(current_user: CurrentUserDependency) -> User:
    return current_user


async def require_admin(current_user: CurrentUserDependency) -> User:
    if not isAdmin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin permission required")
    return current_user


async def get_profile_capabilities(
    current_user: CurrentUserDependency,
    service: ProfileService = Depends(get_profile_service),
) -> ProfileCapabilities:
    return await service.get_profile_capabilities(current_user)


async def require_profile_can_apply(
    current_user: CurrentUserDependency,
    service: ProfileService = Depends(get_profile_service),
) -> User:
    capabilities = await service.get_profile_capabilities(current_user)
    if not capabilities.can_apply_to_jobs:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "Profile is not complete enough to apply to jobs",
                "missing_sections": capabilities.apply_missing_sections,
            },
        )
    return current_user


async def require_profile_can_post_job(
    current_user: CurrentUserDependency,
    service: ProfileService = Depends(get_profile_service),
) -> User:
    capabilities = await service.get_profile_capabilities(current_user)
    if not capabilities.can_post_jobs:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "Profile is not complete enough to post jobs",
                "missing_sections": capabilities.post_missing_sections,
            },
        )
    return current_user


async def require_profile_owner(
    profile_user_id: UUID,
    current_user: CurrentUserDependency,
) -> User:
    if isAdmin(current_user) or current_user.id == profile_user_id:
        return current_user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Profile owner required")


async def require_job_owner(
    job_id: UUID,
    current_user: CurrentUserDependency,
    service: JobService = Depends(get_job_service),
) -> Job:
    try:
        job = await service.get_job_internal(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    if isAdmin(current_user):
        return job
    if job.posted_by_user_id is not None and job.posted_by_user_id == current_user.id:
        return job
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Job owner required")


async def require_application_participant(
    application,
    current_user: CurrentUserDependency,
) -> object:
    if isAdmin(current_user):
        return application
    applicant_user_id = getattr(application, "applicant_user_id", None)
    job_owner_user_id = getattr(application, "job_owner_user_id", None)
    job = getattr(application, "job", None)
    if job_owner_user_id is None and job is not None:
        job_owner_user_id = getattr(job, "posted_by_user_id", None)
    if applicant_user_id == current_user.id or job_owner_user_id == current_user.id:
        return application
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Application participant required")


async def require_talent_user(
    current_user: CurrentUserDependency,
    service: ProfileService = Depends(get_profile_service),
) -> User:
    capabilities = await service.get_profile_capabilities(current_user)
    if not capabilities.can_apply_to_jobs:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Profile is not complete enough to apply to jobs",
        )
    return current_user


async def require_employer_user(
    current_user: CurrentUserDependency,
    service: ProfileService = Depends(get_profile_service),
) -> User:
    capabilities = await service.get_profile_capabilities(current_user)
    if not capabilities.can_post_jobs:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Profile is not complete enough to post jobs",
        )
    return current_user


async def require_admin_user(current_user: CurrentUserDependency) -> User:
    return await require_admin(current_user)


requireAuthenticatedUser = require_authenticated_user
requireAdmin = require_admin
requireProfileOwner = require_profile_owner
requireJobOwner = require_job_owner
requireApplicationParticipant = require_application_participant
getProfileCapabilities = get_profile_capabilities
requireProfileCanApply = require_profile_can_apply
requireProfileCanPostJob = require_profile_can_post_job
