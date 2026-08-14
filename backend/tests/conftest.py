from __future__ import annotations

import base64
import binascii
import json
import os
import sys
import time
from collections.abc import AsyncGenerator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.api.deps import get_db, get_google_identity_verifier
from app.db.base import Base
from app.db.session import enable_sqlite_foreign_keys
from app.main import app
from app.models import Role
from app.services.email_service import clear_dev_auth_emails
from app.services.google_identity import (
    GoogleIdentityVerificationError,
    VerifiedGoogleIdentity,
)

TEST_DATABASE_URL = "sqlite+aiosqlite:///./test_creatorjobs_backend.db"
TEST_GOOGLE_CLIENT_ID = "creatorjobs-tests.apps.googleusercontent.com"


def google_id_token_for_test(
    *,
    email: str,
    subject: str,
    display_name: str | None = None,
    email_verified: bool = True,
    audience: str = TEST_GOOGLE_CLIENT_ID,
    issuer: str = "https://accounts.google.com",
    expires_at: int | None = None,
) -> str:
    """Create a deterministic credential understood only by the test verifier."""

    claims = {
        "iss": issuer,
        "aud": audience,
        "exp": expires_at if expires_at is not None else int(time.time()) + 3600,
        "sub": subject,
        "email": email,
        "email_verified": email_verified,
        "name": display_name,
    }
    encoded = base64.urlsafe_b64encode(
        json.dumps(claims, separators=(",", ":"), sort_keys=True).encode()
    ).decode().rstrip("=")
    return f"test-google-id.{encoded}.test-signature"


class FakeGoogleIdentityVerifier:
    """Test-only verifier; production tests exercise the Google-backed verifier directly."""

    async def verify(self, raw_id_token: str) -> VerifiedGoogleIdentity:
        try:
            prefix, encoded, signature = raw_id_token.split(".", 2)
            if prefix != "test-google-id" or signature != "test-signature":
                raise ValueError
            padding = "=" * (-len(encoded) % 4)
            claims = json.loads(base64.urlsafe_b64decode(encoded + padding))
            if not isinstance(claims, dict):
                raise ValueError
        except (
            ValueError,
            TypeError,
            UnicodeDecodeError,
            binascii.Error,
            json.JSONDecodeError,
        ) as exc:
            raise GoogleIdentityVerificationError("Invalid Google identity token") from exc

        if claims.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}:
            raise GoogleIdentityVerificationError("Invalid Google identity token")
        if claims.get("aud") != TEST_GOOGLE_CLIENT_ID:
            raise GoogleIdentityVerificationError("Invalid Google identity token")
        if not isinstance(claims.get("exp"), int) or claims["exp"] <= time.time():
            raise GoogleIdentityVerificationError("Invalid Google identity token")
        if claims.get("email_verified") is not True:
            raise GoogleIdentityVerificationError("Invalid Google identity token")
        subject = claims.get("sub")
        email = claims.get("email")
        if not isinstance(subject, str) or not subject or not isinstance(email, str) or not email:
            raise GoogleIdentityVerificationError("Invalid Google identity token")
        display_name = claims.get("name")
        return VerifiedGoogleIdentity(
            subject=subject,
            email=email.strip().lower(),
            display_name=display_name if isinstance(display_name, str) else None,
        )


def override_get_google_identity_verifier() -> FakeGoogleIdentityVerifier:
    return FakeGoogleIdentityVerifier()


test_engine = create_async_engine(TEST_DATABASE_URL, future=True)
enable_sqlite_foreign_keys(test_engine)
TestSessionLocal = async_sessionmaker(
    bind=test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with TestSessionLocal() as session:
        yield session


async def active_test_role_id(name: str = "Video Editor") -> str:
    """Return an active role for tests that exercise the current publication flow."""

    async with TestSessionLocal() as session:
        role = (await session.execute(select(Role).where(Role.name == name))).scalar_one_or_none()
        if role is None:
            role = Role(name=name, category="Production", is_active=True)
            session.add(role)
            await session.commit()
            await session.refresh(role)
        else:
            assert role.is_active, f"Test publication role {name!r} must remain active"
        return str(role.id)


async def valid_published_job_payload(**overrides: object) -> dict[str, object]:
    """Build the smallest ordinary job payload that satisfies the P0 publish contract."""

    payload: dict[str, object] = {
        "title": "Retention-focused video editor",
        "primary_role_id": await active_test_role_id(),
        "engagement_type": "one_time_project",
        "platforms": ["youtube"],
        "work_mode": "remote",
        "about_channel": "A creator-led channel publishing useful videos every week.",
        "responsibilities": ["Edit one polished creator video"],
        "requirements": ["Strong pacing and narrative judgment"],
        "start_timeframe": "ASAP",
        "application_mode": "internal",
        "compensation_mode": "range",
        "budget_amount": 1000,
        "budget_max": 1500,
        "budget_currency": "USD",
        "budget_unit": "per video",
        "deliverables": [
            {"type": "long_form_video", "quantity": 1, "frequency": "per_week"}
        ],
        "turnaround_value": 5,
        "turnaround_unit": "business_days",
        "turnaround_basis": "first_draft",
        "status": "published",
    }
    payload.update(overrides)
    return payload


async def create_valid_published_job(
    client: AsyncClient,
    owner_token: str,
    **overrides: object,
):
    """Create a published job through the API so publication validation is exercised."""

    return await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_token}"},
        json=await valid_published_job_payload(**overrides),
    )


@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_test_db() -> AsyncGenerator[None, None]:
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_google_identity_verifier] = (
        override_get_google_identity_verifier
    )
    yield

    app.dependency_overrides.clear()
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture()
async def client() -> AsyncGenerator[AsyncClient, None]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as test_client:
        yield test_client


@pytest_asyncio.fixture()
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Direct isolated-test DB access for domain-state setup assertions."""

    async with TestSessionLocal() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture(autouse=True)
async def clear_dev_auth_email_outbox() -> AsyncGenerator[None, None]:
    clear_dev_auth_emails()
    yield
    clear_dev_auth_emails()
