from __future__ import annotations

import time
from datetime import UTC, datetime

import pytest
from conftest import (
    TEST_GOOGLE_CLIENT_ID,
    TestSessionLocal,
    google_id_token_for_test,
)
from google.auth import exceptions as google_auth_exceptions
from httpx import AsyncClient
from sqlalchemy import select

from app.models import OAuthAccount, User
from app.services import google_identity as google_identity_module
from app.services.google_identity import (
    GoogleIdentityConfigurationError,
    GoogleIdentityProviderUnavailableError,
    GoogleIdentityVerificationError,
    GoogleIdentityVerifier,
    google_access_token_matches_identity,
    google_oidc_access_token_hash,
)


def _verified_claims(**overrides: object) -> dict[str, object]:
    claims: dict[str, object] = {
        "iss": "https://accounts.google.com",
        "aud": TEST_GOOGLE_CLIENT_ID,
        "exp": int(time.time()) + 3600,
        "sub": "google-subject-verified",
        "email": "Verified.User@example.com",
        "email_verified": True,
        "name": "Verified Creator",
    }
    claims.update(overrides)
    return claims


async def test_google_verifier_uses_google_library_and_derives_trusted_claims(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed: dict[str, object] = {}

    def fake_verify(raw_token, request, audience):  # noqa: ANN001
        observed.update(raw_token=raw_token, request=request, audience=audience)
        return _verified_claims()

    monkeypatch.setattr(
        google_identity_module.google_id_token,
        "verify_oauth2_token",
        fake_verify,
    )

    identity = await GoogleIdentityVerifier(TEST_GOOGLE_CLIENT_ID).verify("signed-google-id-token")

    assert observed["raw_token"] == "signed-google-id-token"
    assert observed["audience"] == TEST_GOOGLE_CLIENT_ID
    assert identity.subject == "google-subject-verified"
    assert identity.email == "verified.user@example.com"
    assert identity.display_name == "Verified Creator"


async def test_google_verifier_preserves_signed_access_token_binding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    access_token = "access-token-from-the-same-google-response"

    def fake_verify(_raw_token, _request, _audience):  # noqa: ANN001
        return _verified_claims(
            at_hash=google_oidc_access_token_hash(access_token)
        )

    monkeypatch.setattr(
        google_identity_module.google_id_token,
        "verify_oauth2_token",
        fake_verify,
    )
    identity = await GoogleIdentityVerifier(TEST_GOOGLE_CLIENT_ID).verify("signed-id-token")

    assert google_access_token_matches_identity(identity, access_token) is True
    assert google_access_token_matches_identity(identity, "different-token") is False


@pytest.mark.parametrize(
    ("claim_overrides", "library_error"),
    [
        ({"iss": "https://attacker.example"}, None),
        ({"aud": "wrong-client.apps.googleusercontent.com"}, None),
        ({"exp": int(time.time()) - 1}, None),
        ({"sub": ""}, None),
        ({"email_verified": False}, None),
        ({"email": "not-an-email"}, None),
        ({"at_hash": 123}, None),
        ({"at_hash": "not-a-valid-google-access-token-hash"}, None),
        ({}, ValueError("invalid signature")),
    ],
)
async def test_google_verifier_rejects_invalid_signature_and_identity_claims(
    monkeypatch: pytest.MonkeyPatch,
    claim_overrides: dict[str, object],
    library_error: Exception | None,
) -> None:
    def fake_verify(_raw_token, _request, _audience):  # noqa: ANN001
        if library_error is not None:
            raise library_error
        return _verified_claims(**claim_overrides)

    monkeypatch.setattr(
        google_identity_module.google_id_token,
        "verify_oauth2_token",
        fake_verify,
    )

    with pytest.raises(GoogleIdentityVerificationError):
        await GoogleIdentityVerifier(TEST_GOOGLE_CLIENT_ID).verify("untrusted-google-id-token")


async def test_google_verifier_fails_closed_for_missing_config_and_provider_outage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(GoogleIdentityConfigurationError):
        await GoogleIdentityVerifier(None).verify("unused")

    def provider_unavailable(*_args, **_kwargs):
        raise google_auth_exceptions.TransportError("certificate endpoint unavailable")

    monkeypatch.setattr(
        google_identity_module.google_id_token,
        "verify_oauth2_token",
        provider_unavailable,
    )
    with pytest.raises(GoogleIdentityProviderUnavailableError):
        await GoogleIdentityVerifier(TEST_GOOGLE_CLIENT_ID).verify("signed-token")


@pytest.mark.parametrize(
    "id_token",
    [
        "forged-token-without-a-valid-test-signature" * 2,
        google_id_token_for_test(
            email="unverified@example.com",
            subject="unverified-subject",
            email_verified=False,
        ),
        google_id_token_for_test(
            email="audience@example.com",
            subject="wrong-audience-subject",
            audience="wrong-client.apps.googleusercontent.com",
        ),
        google_id_token_for_test(
            email="expired@example.com",
            subject="expired-subject",
            expires_at=int(time.time()) - 60,
        ),
    ],
)
async def test_google_exchange_rejects_forged_or_invalid_identity(
    client: AsyncClient,
    id_token: str,
) -> None:
    response = await client.post(
        "/api/v1/auth/oauth/google",
        json={"id_token": id_token},
    )

    assert response.status_code == 401
    assert response.json()["error"]["message"] == "Invalid Google identity token"


async def test_google_exchange_rejects_caller_supplied_email_and_subject(
    client: AsyncClient,
) -> None:
    response = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "id_token": google_id_token_for_test(
                email="trusted@example.com",
                subject="trusted-google-subject",
            ),
            "email": "victim@example.com",
            "provider_account_id": "victim-google-subject",
        },
    )

    assert response.status_code == 422


async def test_google_exchange_uses_verified_claims_and_never_returns_provider_tokens(
    client: AsyncClient,
) -> None:
    id_token = google_id_token_for_test(
        email="trusted-claims@example.com",
        subject="trusted-claims-subject",
        display_name="Trusted Claims",
    )
    response = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "id_token": id_token,
            "access_token": "provider-access-secret",
            "refresh_token": "provider-refresh-secret",
            "scope": "openid email profile",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["user"]["email"] == "trusted-claims@example.com"
    assert body["user"]["display_name"] == "Trusted Claims"
    serialized = response.text
    assert id_token not in serialized
    assert "provider-access-secret" not in serialized
    assert "provider-refresh-secret" not in serialized


async def test_existing_google_subject_cannot_be_reassigned_by_email_collision(
    client: AsyncClient,
) -> None:
    async with TestSessionLocal() as session:
        original_user = User(
            email="original-google-owner@example.com",
            username="original_google",
            email_verified_at=datetime.now(UTC),
        )
        colliding_email_user = User(
            email="colliding-google-email@example.com",
            username="colliding_google",
            email_verified_at=datetime.now(UTC),
        )
        session.add_all([original_user, colliding_email_user])
        await session.flush()
        oauth = OAuthAccount(
            user_id=original_user.id,
            provider="google",
            provider_account_id="non-reassignable-subject",
        )
        session.add(oauth)
        await session.commit()
        original_user_id = original_user.id

    response = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "id_token": google_id_token_for_test(
                email="colliding-google-email@example.com",
                subject="non-reassignable-subject",
            )
        },
    )

    assert response.status_code == 409
    async with TestSessionLocal() as session:
        linked = (
            await session.execute(
                select(OAuthAccount).where(
                    OAuthAccount.provider == "google",
                    OAuthAccount.provider_account_id == "non-reassignable-subject",
                )
            )
        ).scalar_one()
        assert linked.user_id == original_user_id


async def test_existing_email_with_google_link_rejects_a_different_subject(
    client: AsyncClient,
) -> None:
    first = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "id_token": google_id_token_for_test(
                email="stable-link@example.com",
                subject="stable-link-subject",
            )
        },
    )
    assert first.status_code == 200, first.text

    second = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "id_token": google_id_token_for_test(
                email="stable-link@example.com",
                subject="replacement-link-subject",
            )
        },
    )

    assert second.status_code == 409


async def test_authenticated_user_cannot_upload_unverified_provider_credentials(
    client: AsyncClient,
) -> None:
    register = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "credentials-only@example.com",
            "password": "supersecure123",
            "username": "credentials_only",
        },
    )
    assert register.status_code == 200
    async with TestSessionLocal() as session:
        user = (
            await session.execute(select(User).where(User.email == "credentials-only@example.com"))
        ).scalar_one()
        user.email_verified_at = datetime.now(UTC)
        await session.commit()

    login = await client.post(
        "/api/v1/auth/login",
        json={
            "email": "credentials-only@example.com",
            "password": "supersecure123",
        },
    )
    assert login.status_code == 200
    bearer = login.json()["access_token"]

    update = await client.post(
        "/api/v1/me/oauth/google/upsert",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"access_token": "unverified-provider-token"},
    )
    # Credentials are accepted only alongside a provider-signed ID token at the
    # verified exchange. The old bearer-authenticated mutation is intentionally
    # absent rather than retaining a caller-controlled subject/token path.
    assert update.status_code == 404

    altered_subject = await client.post(
        "/api/v1/me/oauth/google/upsert",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "provider_account_id": "attacker-selected-subject",
            "access_token": "unverified-provider-token",
        },
    )
    assert altered_subject.status_code == 404
