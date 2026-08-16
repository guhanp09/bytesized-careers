from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.account_types import isAdmin
from app.core.auth_assurance import has_fresh_strong_auth
from app.core.config import settings
from app.core.job_import_readiness_check import require_allowed_model
from app.core.qa_personas import (
    is_qa_controller_email,
    parse_qa_token_claims,
    qa_persona_feature_enabled,
    qa_session_is_revoked,
)
from app.core.security import SESSION_ID_CLAIM, TokenError, decode_access_token
from app.core.strong_auth_secrets import (
    StrongAuthSecretConfigurationError,
    build_strong_auth_secret_cipher,
)
from app.db import seed_data_personas as qa_personas
from app.db.session import get_db_session
from app.integrations.openai.job_import_adapter import (
    OpenAIJobImportAdapter,
    OpenAIJobImportConfig,
)
from app.models import AuthSession, Job, User
from app.repositories.auth_repository import AuthRepository
from app.repositories.job_import_repository import JobImportRepository
from app.repositories.job_repository import JobRepository
from app.repositories.search_repository import SearchRepository
from app.schemas.profile_capabilities import ProfileCapabilities
from app.services.auth_service import AuthService
from app.services.google_identity import GoogleIdentityVerifier
from app.services.job_import_conversation_service import JobImportConversationService
from app.services.job_import_processing_service import JobImportProcessingService
from app.services.job_import_provider import JobImportExtractionProvider
from app.services.job_import_service import JobImportService
from app.services.job_import_url_service import JobImportUrlService
from app.services.job_service import JobNotFoundError, JobService
from app.services.job_url_fetcher import PublicJobUrlFetcher
from app.services.me_service import MeService
from app.services.oauth_credential_storage import OAuthCredentialStorage
from app.services.profile_service import ProfileService
from app.services.search_service import SearchService
from app.services.strong_auth_service import StrongAuthService

logger = logging.getLogger(__name__)

bearer_scheme = HTTPBearer(auto_error=False)


async def get_db(session: AsyncSession = Depends(get_db_session)) -> AsyncSession:
    return session


async def get_job_service(session: AsyncSession = Depends(get_db)) -> JobService:
    repository = JobRepository(session)
    return JobService(repository)


async def get_search_service(session: AsyncSession = Depends(get_db)) -> SearchService:
    return SearchService(SearchRepository(session))


async def get_job_import_service(
    session: AsyncSession = Depends(get_db),
) -> JobImportService:
    return JobImportService(
        JobImportRepository(session),
        JobService(JobRepository(session)),
    )


#: The shortest extraction timeout that can actually succeed.
#:
#: Measured against a real 16k-character public job page: extraction takes about
#: 33 seconds. A deployment configured at 30 seconds therefore killed every real
#: import roughly three seconds before its answer arrived, and the recruiter met
#: an assistant asking about everything the page already stated.
#:
#: Enforced here rather than in the settings bounds so an existing deployment
#: keeps booting — but never silently, because silence is how this survived.
MIN_VIABLE_EXTRACTION_TIMEOUT_SECONDS = 45.0


def _viable_timeout_seconds(configured: float) -> float:
    """Never run an extraction with a timeout that cannot finish one."""

    if configured >= MIN_VIABLE_EXTRACTION_TIMEOUT_SECONDS:
        return configured
    logger.warning(
        "job_import_extraction_timeout_too_low",
        extra={
            "configured_seconds": configured,
            "applied_seconds": MIN_VIABLE_EXTRACTION_TIMEOUT_SECONDS,
        },
    )
    return MIN_VIABLE_EXTRACTION_TIMEOUT_SECONDS


def get_job_import_provider() -> JobImportExtractionProvider:
    api_key = (
        settings.openai_api_key.get_secret_value()
        if settings.openai_api_key is not None
        else None
    )
    return OpenAIJobImportAdapter(
        OpenAIJobImportConfig(
            api_key=api_key,
            # Checked here, at the last point before a model name can become a
            # billed request. A probe reporting the problem is not enough:
            # nothing forces anyone to read a probe first.
            model=require_allowed_model(settings.openai_model),
            request_timeout_seconds=_viable_timeout_seconds(
                settings.openai_request_timeout_seconds
            ),
            max_retries=settings.openai_max_retries,
            instruction_version=settings.job_import_prompt_version,
        )
    )


async def get_job_import_processing_service(
    service: JobImportService = Depends(get_job_import_service),
    provider: JobImportExtractionProvider = Depends(get_job_import_provider),
) -> JobImportProcessingService:
    return JobImportProcessingService(service, provider)


async def get_job_import_conversation_service(
    service: JobImportService = Depends(get_job_import_service),
) -> JobImportConversationService:
    # No provider dependency by design: the conversation loop never calls one.
    return JobImportConversationService(service)


async def get_job_import_url_service(
    service: JobImportService = Depends(get_job_import_service),
) -> JobImportUrlService:
    return JobImportUrlService(service, PublicJobUrlFetcher())


async def get_auth_repository(session: AsyncSession = Depends(get_db)) -> AuthRepository:
    return AuthRepository(
        session,
        oauth_credential_storage=OAuthCredentialStorage.from_settings(settings),
    )


def get_google_identity_verifier() -> GoogleIdentityVerifier:
    return GoogleIdentityVerifier(settings.google_client_id)


async def get_auth_service(
    repository: AuthRepository = Depends(get_auth_repository),
    google_identity_verifier: GoogleIdentityVerifier = Depends(
        get_google_identity_verifier
    ),
) -> AuthService:
    return AuthService(repository, google_identity_verifier)


async def get_strong_auth_service(
    session: AsyncSession = Depends(get_db),
    google_identity_verifier: GoogleIdentityVerifier = Depends(
        get_google_identity_verifier
    ),
) -> StrongAuthService:
    keyring_json = (
        settings.strong_auth_secret_keys.get_secret_value()
        if settings.strong_auth_secret_keys is not None
        else None
    )
    try:
        cipher = build_strong_auth_secret_cipher(
            keyring_json=keyring_json,
            active_key_id=settings.strong_auth_secret_active_key_id,
        )
    except StrongAuthSecretConfigurationError as exc:
        logger.error("strong_auth_secret_configuration_invalid")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Strong authentication is temporarily unavailable",
        ) from exc
    return StrongAuthService(
        session,
        cipher=cipher,
        google_identity_verifier=google_identity_verifier,
    )


async def get_me_service(repository: AuthRepository = Depends(get_auth_repository)) -> MeService:
    return MeService(repository)


async def get_profile_service(
    repository: AuthRepository = Depends(get_auth_repository),
) -> ProfileService:
    return ProfileService(repository)


@dataclass(frozen=True)
class AuthenticatedAccessContext:
    user: User
    session_id: UUID | None
    strong_auth_method: str | None = None
    strong_auth_verified_at: datetime | None = None
    strong_auth_expires_at: datetime | None = None
    is_qa_persona: bool = False


async def resolve_access_token_context(
    *,
    session: AsyncSession,
    token: str,
    enforce_admin_strong_auth: bool = True,
) -> AuthenticatedAccessContext | None:
    """Resolve trusted identity and its authoritative durable session family."""
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

    is_qa_persona = "qa" in payload
    auth_session_id: UUID | None = None
    auth_session: AuthSession | None = None
    if is_qa_persona:
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
    else:
        session_claim = payload.get(SESSION_ID_CLAIM)
        if session_claim is None:
            if settings.auth_session_mode == "persistent":
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid or expired token",
                )
        else:
            if not isinstance(session_claim, str):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid or expired token",
                )
            try:
                auth_session_id = UUID(session_claim)
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid or expired token",
                ) from exc

            auth_session = (
                await session.execute(
                    select(AuthSession).where(AuthSession.id == auth_session_id)
                )
            ).scalar_one_or_none()
            now = datetime.now(UTC)
            absolute_expires_at = (
                auth_session.absolute_expires_at
                if auth_session is not None
                else None
            )
            if absolute_expires_at is not None and absolute_expires_at.tzinfo is None:
                absolute_expires_at = absolute_expires_at.replace(tzinfo=UTC)
            if (
                auth_session is None
                or auth_session.user_id != user_id
                or auth_session.revoked_at is not None
                or absolute_expires_at is None
                or absolute_expires_at <= now
            ):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid or expired token",
                )

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

    if (
        enforce_admin_strong_auth
        and settings.admin_strong_auth_required
        and isAdmin(user)
        and (
            is_qa_persona
            or auth_session is None
            or not has_fresh_strong_auth(
                method=auth_session.strong_auth_method,
                verified_at=auth_session.strong_auth_verified_at,
                expires_at=auth_session.strong_auth_expires_at,
                max_age_minutes=settings.admin_strong_auth_max_age_minutes,
            )
        )
    ):
        logger.warning(
            "admin_strong_auth_required",
            extra={
                "user_id": str(user.id),
                "session_id": str(auth_session_id) if auth_session_id else None,
                "qa_persona": is_qa_persona,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator strong authentication required",
            headers={
                "WWW-Authenticate": (
                    'Bearer error="insufficient_user_authentication"'
                )
            },
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
    return AuthenticatedAccessContext(
        user=user,
        session_id=auth_session_id,
        strong_auth_method=(
            auth_session.strong_auth_method if auth_session is not None else None
        ),
        strong_auth_verified_at=(
            auth_session.strong_auth_verified_at
            if auth_session is not None
            else None
        ),
        strong_auth_expires_at=(
            auth_session.strong_auth_expires_at
            if auth_session is not None
            else None
        ),
        is_qa_persona=is_qa_persona,
    )


async def resolve_access_token_user(
    *,
    session: AsyncSession,
    token: str,
) -> User | None:
    """Resolve the same trusted backend identity used by HTTP and WebSockets."""

    context = await resolve_access_token_context(session=session, token=token)
    return context.user if context is not None else None


async def _resolve_user_from_credentials(
    *,
    session: AsyncSession,
    credentials: HTTPAuthorizationCredentials,
) -> User | None:
    return await resolve_access_token_user(session=session, token=credentials.credentials)


async def get_current_access_context(
    session: AsyncSession = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AuthenticatedAccessContext:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    context = await resolve_access_token_context(
        session=session,
        token=credentials.credentials,
    )
    if context is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )
    return context


async def get_current_base_access_context(
    session: AsyncSession = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AuthenticatedAccessContext:
    """Resolve first-factor identity for logout and strong-auth ceremonies only.

    Ordinary product and administrator routes must use
    ``get_current_access_context`` so an administrator cannot bypass the
    assurance gate by choosing a weaker dependency.
    """

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )
    context = await resolve_access_token_context(
        session=session,
        token=credentials.credentials,
        enforce_admin_strong_auth=False,
    )
    if context is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )
    return context


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
AuthenticatedAccessDependency = Annotated[
    AuthenticatedAccessContext,
    Depends(get_current_access_context),
]
BaseAuthenticatedAccessDependency = Annotated[
    AuthenticatedAccessContext,
    Depends(get_current_base_access_context),
]


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
