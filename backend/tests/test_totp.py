from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.core.totp import (
    TotpSecretError,
    hotp_code,
    matching_totp_step,
    totp_code_at,
    totp_provisioning_uri,
    totp_time_step,
)

RFC_6238_SHA1_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"


@pytest.mark.parametrize(
    ("timestamp", "expected"),
    [
        (59, "94287082"),
        (1_111_111_109, "07081804"),
        (1_111_111_111, "14050471"),
        (1_234_567_890, "89005924"),
        (2_000_000_000, "69279037"),
        (20_000_000_000, "65353130"),
    ],
)
def test_totp_matches_rfc_6238_sha1_vectors(timestamp: int, expected: str) -> None:
    instant = datetime.fromtimestamp(timestamp, tz=UTC)

    assert totp_code_at(RFC_6238_SHA1_SECRET, instant, digits=8) == expected


def test_totp_matching_is_bounded_and_returns_the_authoritative_step() -> None:
    now = datetime(2026, 8, 14, 12, 0, 15, tzinfo=UTC)
    current_step = totp_time_step(now)
    previous = hotp_code(RFC_6238_SHA1_SECRET, current_step - 1)
    future = hotp_code(RFC_6238_SHA1_SECRET, current_step + 1)
    too_old = hotp_code(RFC_6238_SHA1_SECRET, current_step - 2)

    assert (
        matching_totp_step(
            secret=RFC_6238_SHA1_SECRET,
            code=previous,
            at=now,
        )
        == current_step - 1
    )
    assert (
        matching_totp_step(
            secret=RFC_6238_SHA1_SECRET,
            code=future,
            at=now,
        )
        == current_step + 1
    )
    assert (
        matching_totp_step(
            secret=RFC_6238_SHA1_SECRET,
            code=too_old,
            at=now,
        )
        is None
    )
    assert (
        matching_totp_step(
            secret=RFC_6238_SHA1_SECRET,
            code="12345x",
            at=now,
        )
        is None
    )


def test_totp_rejects_bad_secrets_and_unsafe_parameters() -> None:
    with pytest.raises(TotpSecretError):
        hotp_code("not valid base32!", 0)
    with pytest.raises(ValueError, match="non-negative"):
        hotp_code(RFC_6238_SHA1_SECRET, -1)
    with pytest.raises(ValueError, match="between 6 and 8"):
        hotp_code(RFC_6238_SHA1_SECRET, 0, digits=5)
    with pytest.raises(ValueError, match="between zero and two"):
        matching_totp_step(
            secret=RFC_6238_SHA1_SECRET,
            code="123456",
            allowed_drift_steps=3,
        )


def test_provisioning_uri_is_standard_and_escapes_the_account_label() -> None:
    uri = totp_provisioning_uri(
        secret=RFC_6238_SHA1_SECRET,
        account_name="admin+ops@example.com",
    )

    assert uri.startswith("otpauth://totp/CreatorJobs%3Aadmin%2Bops%40example.com?")
    assert f"secret={RFC_6238_SHA1_SECRET}" in uri
    assert "issuer=CreatorJobs" in uri
    assert "algorithm=SHA1" in uri
    assert "digits=6" in uri
    assert "period=30" in uri


def test_naive_datetime_is_treated_as_utc() -> None:
    aware = datetime(2026, 8, 14, 12, 0, tzinfo=UTC)
    naive = aware.replace(tzinfo=None)

    assert totp_code_at(RFC_6238_SHA1_SECRET, aware) == totp_code_at(
        RFC_6238_SHA1_SECRET,
        naive,
    )
    assert totp_time_step(aware + timedelta(seconds=30)) == totp_time_step(aware) + 1
